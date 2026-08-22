-- PortalFislab1 — initial schema
-- Tabel, view, trigger, RLS policy, dan bucket Storage.
-- Password TIDAK disimpan di tabel kita (urusan Supabase Auth / auth.users).

-- =============================================================================
-- TABEL
-- =============================================================================

-- profiles: metadata pengguna, 1:1 dengan auth.users.
-- Catatan: kolom `judul` (label modul aslab) sengaja tidak ada — diturunkan
-- dari v_aslab_meta, tidak disimpan statis (penyesuaian #1).
CREATE TABLE public.profiles (
  id                   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username             text UNIQUE NOT NULL,
  name                 text NOT NULL,
  role                 text NOT NULL CHECK (role IN ('praktikan','aslab','admin')),
  nrp                  text,
  kelompok             int,
  wa                   text,
  photo_path           text,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- modules: daftar modul praktikum.
CREATE TABLE public.modules (
  id        text PRIMARY KEY,
  kode      text,
  judul     text NOT NULL,
  ringkas   text,
  file_url  text,
  file_type text CHECK (file_type IN ('pdf','docs'))
);

-- rotasi: pemetaan modul x kelompok x minggu x aslab.
CREATE TABLE public.rotasi (
  id             serial PRIMARY KEY,
  module_id      text NOT NULL REFERENCES public.modules(id),
  kelompok       int NOT NULL,
  minggu         int NOT NULL,
  aslab_username text NOT NULL REFERENCES public.profiles(username),
  UNIQUE(module_id, kelompok)
);

-- schedules: jadwal praktikum per modul per kelompok.
CREATE TABLE public.schedules (
  id         serial PRIMARY KEY,
  module_id  text NOT NULL REFERENCES public.modules(id),
  kelompok   int NOT NULL,
  tanggal    date,
  sesi       text,
  set_by     text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(module_id, kelompok)
);

-- grades: 10 komponen nilai + 10 catatan + nilai_akhir (dihitung trigger).
-- Bobot dipertahankan 105% persis seperti KOMP di script.js (bukan bug):
--   prelab 10, inlab 10, abstrak 10, pendahuluan 10, metodologi 5,
--   analisis 20, pembahasan 25, kesimpulan 10, format 5, plagiasi 0.
CREATE TABLE public.grades (
  id               serial PRIMARY KEY,
  username         text NOT NULL REFERENCES public.profiles(username),
  module_id        text NOT NULL REFERENCES public.modules(id),
  prelab           numeric(5,2) CHECK (prelab           BETWEEN 0 AND 100),
  inlab            numeric(5,2) CHECK (inlab            BETWEEN 0 AND 100),
  abstrak          numeric(5,2) CHECK (abstrak          BETWEEN 0 AND 100),
  pendahuluan      numeric(5,2) CHECK (pendahuluan      BETWEEN 0 AND 100),
  metodologi       numeric(5,2) CHECK (metodologi       BETWEEN 0 AND 100),
  analisis         numeric(5,2) CHECK (analisis         BETWEEN 0 AND 100),
  pembahasan       numeric(5,2) CHECK (pembahasan       BETWEEN 0 AND 100),
  kesimpulan       numeric(5,2) CHECK (kesimpulan       BETWEEN 0 AND 100),
  format           numeric(5,2) CHECK (format           BETWEEN 0 AND 100),
  plagiasi         numeric(5,2) CHECK (plagiasi         BETWEEN 0 AND 100),
  cat_prelab       text,
  cat_inlab        text,
  cat_abstrak      text,
  cat_pendahuluan  text,
  cat_metodologi   text,
  cat_analisis     text,
  cat_pembahasan   text,
  cat_kesimpulan   text,
  cat_format       text,
  cat_plagiasi     text,
  nilai_akhir      numeric(5,2),  -- dihitung oleh trigger, nilai client diabaikan
  set_by           text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(username, module_id)
);

CREATE INDEX idx_grades_username  ON public.grades(username);
CREATE INDEX idx_grades_module_id ON public.grades(module_id);
CREATE INDEX idx_schedules_module ON public.schedules(module_id);
CREATE INDEX idx_rotasi_aslab     ON public.rotasi(aslab_username);

-- =============================================================================
-- VIEW & FUNGSI HELPER
-- =============================================================================

-- v_aslab_meta: kode & kelompok aslab diturunkan dari rotasi (bukan statis).
CREATE OR REPLACE VIEW public.v_aslab_meta AS
SELECT r.aslab_username AS username,
       array_agg(DISTINCT m.kode)     AS kode_arr,
       array_agg(DISTINCT r.kelompok) AS kelompok_arr
FROM public.rotasi r
JOIN public.modules m ON m.id = r.module_id
GROUP BY r.aslab_username;

-- app_current_role(): role user yang sedang login (SECURITY DEFINER -> bypass RLS).
CREATE OR REPLACE FUNCTION public.app_current_role() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- current_username(): username user yang sedang login.
CREATE OR REPLACE FUNCTION public.current_username() RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT username FROM public.profiles WHERE id = auth.uid();
$$;

-- public_aslab_count(): jumlah aslab, untuk landing page anon (getUsers tanpa login).
CREATE OR REPLACE FUNCTION public.public_aslab_count() RETURNS integer
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::integer FROM public.profiles WHERE role = 'aslab';
$$;

-- =============================================================================
-- TRIGGER
-- =============================================================================

-- handle_new_user: auto-buat baris profiles saat user sign up di auth.users.
-- Email sintetis {username}@portalfislab.local -> username = local-part.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_username text;
BEGIN
  v_username := lower(split_part(NEW.email, '@', 1));
  INSERT INTO public.profiles (id, username, name, role)
  VALUES (NEW.id, v_username, v_username, 'praktikan');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- recompute_nilai_akhir: hitung ulang nilai_akhir di server.
-- Nilai client diabaikan. Bobot 105% dipertahankan persis seperti KOMP/script.js.
CREATE OR REPLACE FUNCTION public.recompute_nilai_akhir() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.nilai_akhir := ROUND(CAST(
      COALESCE(NEW.prelab,0)      * 0.10 +
      COALESCE(NEW.inlab,0)       * 0.10 +
      COALESCE(NEW.abstrak,0)     * 0.10 +
      COALESCE(NEW.pendahuluan,0) * 0.10 +
      COALESCE(NEW.metodologi,0)  * 0.05 +
      COALESCE(NEW.analisis,0)    * 0.20 +
      COALESCE(NEW.pembahasan,0)  * 0.25 +
      COALESCE(NEW.kesimpulan,0)  * 0.10 +
      COALESCE(NEW.format,0)      * 0.05
    AS numeric(5,2)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_grades_nilai
  BEFORE INSERT OR UPDATE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.recompute_nilai_akhir();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotasi    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades    ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- modules: public read (landing page butuh daftar modul tanpa login).
-- -----------------------------------------------------------------------------
CREATE POLICY modules_read ON public.modules
  FOR SELECT USING (true);

-- -----------------------------------------------------------------------------
-- rotasi: authenticated read (praktikan & aslab butuh untuk jadwal/penilaian).
-- -----------------------------------------------------------------------------
CREATE POLICY rotasi_read ON public.rotasi
  FOR SELECT TO authenticated USING (true);

-- -----------------------------------------------------------------------------
-- schedules
-- -----------------------------------------------------------------------------
-- praktikan: SELECT jadwal untuk kelompok sendiri.
CREATE POLICY sched_p_select ON public.schedules
  FOR SELECT TO authenticated
  USING (app_current_role() = 'praktikan'
         AND kelompok = (SELECT kelompok FROM public.profiles WHERE id = auth.uid()));

-- aslab: ALL untuk modul yang dipegang (cek lewat rotasi).
CREATE POLICY sched_aslab_all ON public.schedules
  FOR ALL TO authenticated
  USING (app_current_role() = 'aslab'
         AND EXISTS (
           SELECT 1 FROM public.rotasi r
           WHERE r.module_id = schedules.module_id
             AND r.aslab_username = public.current_username()
         ))
  WITH CHECK (app_current_role() = 'aslab'
              AND EXISTS (
                SELECT 1 FROM public.rotasi r
                WHERE r.module_id = schedules.module_id
                  AND r.aslab_username = public.current_username()
              ));

-- admin: ALL semua jadwal.
CREATE POLICY sched_admin_all ON public.schedules
  FOR ALL TO authenticated
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

-- -----------------------------------------------------------------------------
-- grades
-- -----------------------------------------------------------------------------
-- praktikan: SELECT baris milik sendiri saja.
CREATE POLICY grades_p_select ON public.grades
  FOR SELECT TO authenticated
  USING (app_current_role() = 'praktikan'
         AND username = public.current_username());

-- aslab: ALL untuk modul yang dipegang (cek lewat rotasi).
CREATE POLICY grades_aslab_all ON public.grades
  FOR ALL TO authenticated
  USING (app_current_role() = 'aslab'
         AND EXISTS (
           SELECT 1 FROM public.rotasi r
           WHERE r.module_id = grades.module_id
             AND r.aslab_username = public.current_username()
         ))
  WITH CHECK (app_current_role() = 'aslab'
              AND EXISTS (
                SELECT 1 FROM public.rotasi r
                WHERE r.module_id = grades.module_id
                  AND r.aslab_username = public.current_username()
              ));

-- admin: SELECT semua grades (rekap nilai), tidak boleh menulis.
CREATE POLICY grades_admin_select ON public.grades
  FOR SELECT TO authenticated
  USING (app_current_role() = 'admin');

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
-- semua role: SELECT baris sendiri.
CREATE POLICY prof_self_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- praktikan: SELECT semua aslab (untuk halaman Kontak).
CREATE POLICY prof_p_select_aslab ON public.profiles
  FOR SELECT TO authenticated
  USING (app_current_role() = 'praktikan' AND role = 'aslab');

-- aslab: SELECT semua praktikan (penyesuaian #3 — tetap broad, bare minimum).
CREATE POLICY prof_a_select_p ON public.profiles
  FOR SELECT TO authenticated
  USING (app_current_role() = 'aslab' AND role = 'praktikan');

-- admin: SELECT semua profiles.
CREATE POLICY prof_admin_select ON public.profiles
  FOR SELECT TO authenticated
  USING (app_current_role() = 'admin');

-- semua role: UPDATE baris sendiri (ganti foto/password sendiri).
CREATE POLICY prof_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- admin: UPDATE semua profiles (penyesuaian #2 — kelola daftar pengguna).
CREATE POLICY prof_admin_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

-- =============================================================================
-- STORAGE — bucket avatars
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- read public ( foto avatar perlu tampil tanpa login di landing/kontak ).
CREATE POLICY avatars_read ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- insert: hanya ke folder {uid}/ sendiri.
CREATE POLICY avatars_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars'
              AND (storage.foldername(name))[1] = auth.uid()::text);

-- update: hanya folder {uid}/ sendiri.
CREATE POLICY avatars_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars'
              AND (storage.foldername(name))[1] = auth.uid()::text);

-- =============================================================================
-- GRANT EKSPLISIT
-- RLS policy hanya memfilter baris; tanpa GRANT pada tabel, role tidak bisa
-- menyentuh tabel sama sekali. Grant di bawah adalah union hak akses dari semua
-- policy per tabel. Insert/Delete pada profiles tidak diberikan ke client
-- (pembuatan akun lewat Edge Function + service_role yang bypass RLS).
-- =============================================================================

-- Skema public harus bisa dipakai oleh kedua role client.
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- modules: anon SELECT (landing tanpa login), authenticated SELECT.
GRANT SELECT ON public.modules TO anon, authenticated;

-- rotasi: authenticated SELECT saja (policy rotasi_read TO authenticated).
GRANT SELECT ON public.rotasi TO authenticated;

-- schedules: authenticated butuh ALL (policy aslab & admin FOR ALL).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedules TO authenticated;

-- grades: authenticated butuh ALL (policy aslab FOR ALL termasuk DELETE).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grades TO authenticated;

-- profiles: authenticated butuh SELECT & UPDATE saja.
-- (INSERT profile dilakukan trigger handle_new_user sebagai SECURITY DEFINER
--  pemilik tabel; DELETE akun dilakukan admin via service_role.)
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

-- Sequence untuk serial PK, dipakai otomatis saat INSERT schedules/grades/rotasi.
GRANT USAGE, SELECT ON SEQUENCE public.rotasi_id_seq    TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.schedules_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.grades_id_seq    TO authenticated;

-- Fungsi helper.
-- public_aslab_count: dipanggil anon di landing (stat aslab) + authenticated.
-- app_current_role / current_username: dipanggil authenticated di dalam policy.
-- Trigger functions (handle_new_user, recompute_nilai_akhir) dijalankan oleh
-- pemilik tabel saat trigger fire — tidak butuh grant ke role client.
GRANT EXECUTE ON FUNCTION public.public_aslab_count() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_current_role()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_username()   TO authenticated;

-- Storage schema & tabel objects (bucket avatars).
-- anon SELECT (foto avatar tampil tanpa login); authenticated SELECT/INSERT/UPDATE.
GRANT USAGE ON SCHEMA storage          TO anon, authenticated;
GRANT SELECT                          ON storage.objects TO anon;
GRANT SELECT, INSERT, UPDATE          ON storage.objects TO authenticated;
