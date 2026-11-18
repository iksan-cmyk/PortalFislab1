-- Audit log untuk schedules & grades.
--
-- Tujuan: setiap perubahan (UPDATE) dan penghapusan (DELETE) pada
-- public.schedules dan public.grades tercatat, sehingga kasus "jadwal
-- bergeser/terhapus" dan "nilai hilang" berikutnya bisa dilacak siapa yang
-- mengubah, kapan, dan dari/nilai menjadi apa.
--
-- Catatan desain:
--   1. Trigger AFTER UPDATE OR DELETE — tidak mengganggu trigger BEFORE yang
--      sudah ada (cek_batas_aslab_jadwal, recompute_nilai_akhir) yang berjalan
--      lebih dulu dalam urutan statement yang sama.
--   2. Fungsi trigger SECURITY DEFINER + SET search_path = public, supaya bisa
--      INSERT ke audit_log meski RLS audit_log tidak mengizinkan INSERT dari
--      role client, dan tidak tergantung pada search_path caller.
--   3. UPDATE tercatat HANYA bila isi row berubah setelah kolom `updated_at`
--      diabaikan (upsert yang "menyentuh" baris tanpa mengubah isi → bukan
--      noise). kolom lain yang bernilai sama persis juga di-abaikan via
--      perbandingan jsonb.
--   4. RLS: hanya role 'admin' yang boleh SELECT audit_log. Tidak ada policy
--      INSERT/UPDATE/DELETE untuk role client — jalur tulis murni lewat
--      trigger (pemilik tabel / SECURITY DEFINER), tidak bisa ditembus user.
--   5. Perubahan lewat RPC admin_hapus_jadwal (SECURITY DEFINER) dan lewat
--      service_role (skrip folder migration/) memicu trigger yang sama:
--      actor_uid akan NULL (tidak ada sesi user) dan actor_username NULL.
--      Berikut ini detailnya:
--       - perubahan via RPC admin_hapus_jadwal: aksi = DELETE pada schedules
--         dan grades; actor_uid = uid admin yang login; actor_role dari klaim
--         JWT (mis. 'authenticated'); db_user = session_user.
--       - perubahan via service_role (migrate.js / SQL Editor): actor_uid NULL,
--         actor_username NULL, actor_role NULL (tidak ada klaim JWT),
--         db_user = session_user (role koneksi DB yang sebenarnya).
--
--      Catatan db_user: fungsi trigger ini berjalan SECURITY DEFINER sehingga
--      current_user selalu = pemilik fungsi (biasanya 'postgres'). Supaya kolom
--      db_user menangkap role koneksi yang SEBENARNYA (mis. 'authenticated',
--      'service_role', atau user SQL Editor), kolom ini diisi dari
--      session_user, bukan current_user.
--
--      Catatan actor_role: diisi dari klaim JWT `request.jwt.claims
--      -> 'role'` bila ada. Untuk PostgREST / supabase-js, klaim ini biasanya
--      berisi 'authenticated' (bukan peran aplikasi aslab/admin — peran aplikasi
--      tersimpan di profiles.role). NULL ketika tidak ada sesi / dipanggil lewat
--      service_role atau SQL Editor.
--
-- 1. TABEL public.audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id             bigserial PRIMARY KEY,
  tabel          text NOT NULL CHECK (tabel IN ('schedules','grades')),
  aksi           text NOT NULL CHECK (aksi IN ('UPDATE','DELETE')),
  row_lama       jsonb,
  row_baru       jsonb,               -- NULL untuk DELETE
  actor_uid      uuid,                -- hasil auth.uid(), NULL untuk service_role/direct SQL
  actor_username text,                -- hasil public.current_username(), NULL bila tidak ada sesi
  actor_role     text,                -- role dari klaim JWT (request.jwt.claims -> 'role'), NULL bila tak ada
  db_user        text NOT NULL DEFAULT session_user,
  dibuat_pada    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_dibuat_pada ON public.audit_log(dibuat_pada);
CREATE INDEX IF NOT EXISTS idx_audit_log_tabel_aksi   ON public.audit_log(tabel, aksi);

-- 2. FUNGSI TRIGGER public.catat_audit()
CREATE OR REPLACE FUNCTION public.catat_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_lama jsonb;
  v_row_baru jsonb;
  v_actor_role text;
BEGIN
  -- actor_role dari klaim JWT bila tersedia, jika tidak NULL.
  v_actor_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';

  IF TG_OP = 'UPDATE' THEN
    -- Abaikan kolom updated_at: upsert yang tidak mengubah isi (mis. re-save
    -- form tanpa perubahan) tidak menghasilkan catatan baru.
    v_row_baru := to_jsonb(NEW) - 'updated_at';
    v_row_lama := to_jsonb(OLD) - 'updated_at';
    IF v_row_lama IS NOT DISTINCT FROM v_row_baru THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_row_lama := to_jsonb(OLD);
    v_row_baru := NULL;
  ELSE
    RETURN NEW; -- INSERT tidak dicatat
  END IF;

  INSERT INTO public.audit_log (tabel, aksi, row_lama, row_baru, actor_uid, actor_username, actor_role)
  VALUES (TG_TABLE_NAME, TG_OP, v_row_lama, v_row_baru, auth.uid(), public.current_username(), v_actor_role);

  RETURN NEW; -- nilai kembalian diabaikan untuk AFTER
END;
$$;

-- 3. TRIGGER AFTER UPDATE OR DELETE pada schedules & grades
DROP TRIGGER IF EXISTS trg_audit_schedules ON public.schedules;
CREATE TRIGGER trg_audit_schedules
  AFTER UPDATE OR DELETE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.catat_audit();

DROP TRIGGER IF EXISTS trg_audit_grades ON public.grades;
CREATE TRIGGER trg_audit_grades
  AFTER UPDATE OR DELETE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.catat_audit();

-- 4. RLS + GRANT: SELECT ke authenticated, RLS yang membatasi = hanya admin.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_admin_select ON public.audit_log;
CREATE POLICY audit_admin_select ON public.audit_log
  FOR SELECT TO authenticated
  USING (app_current_role() = 'admin');

-- Tidak ada policy INSERT/UPDATE/DELETE untuk authenticated: satu-satunya
-- jalur tulis lewat trigger (SECURITY DEFINER, pemilik tabel) — user mana pun
-- tidak bisa menambah/mengubah/menghapus baris audit sendiri.
REVOKE ALL ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

-- Sequence dipakai oleh trigger (berjalan sebagai pemilik/SECURITY DEFINER),
-- tidak perlu grant ke client. GRANT USAGE tidak diberikan supaya client
-- tidak bisa intervensi serial.
REVOKE ALL ON SEQUENCE public.audit_log_id_seq FROM anon, authenticated;

-- Verifikasi manual (dua sesi berbeda): UPDATE & DELETE jadwal/nilai menambah satu
-- baris audit (aksi=UPDATE/DELETE, actor terisi); re-save tanpa perubahan isi TIDAK
-- menambah baris; hanya role admin yang bisa SELECT isinya.
