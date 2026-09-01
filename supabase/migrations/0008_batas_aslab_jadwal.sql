-- 0008_batas_aslab_jadwal.sql
-- Batas maksimal 3 aslab per opsi jadwal (sesi) per tanggal + RPC katalog lintas-aslab.
--
-- === RINGKASAN INVESTIGASI (Task 0) ===
-- Tabel pilihan jadwal aslab: TIDAK ada tabel terpisah jadwal_aslab/pilihan_jadwal.
-- Yang dipakai adalah tabel `schedules` (lihat 0001_initial_schema.sql:46-55):
--   module_id text, kelompok int, tanggal date, sesi text, set_by text, updated_at,
--   UNIQUE(module_id, kelompok).
-- Pemetaan kolom (placeholder -> nama asli):
--   <KOLOM_OPSI>     = sesi    (slot waktu text, mis. '07.30-08.50'; opsi yang dipilih aslab)
--   <KOLOM_TANGGAL>  = tanggal (date KALENDER NYATA -- bukan cuma hari-dalam-minggu.
--                       logic Jumat vs Senin-Kamis di getSesiOptions/script.js:1019-1023
--                       hanya UX sisi client untuk memilih DAFTAR opsi; di DB tersimpan
--                       sebagai sesi text + tanggal date aktual.)
--   <KOLOM_ASLAB_ID> = set_by  (username aslab yang set jadwal, dikirim form sebagai ses.username)
-- Konfirmasi Kimak: "3 aslab" = maksimal 3 TOTAL per (sesi, tanggal), aslab ke-4 ditolak.
--
-- RLS schedules saat ini (0001:199-224): aslab hanya ALL untuk modul yang dipegang sendiri
-- (cek via rotasi). Aslab TIDAK bisa SELECT jadwal milik aslab lain -> untuk hitung terisi
-- (Task 1b) dan katalog (Task 2) butuh akses baca lintas-aslab. Diselesaikan via RPC
-- SECURITY DEFINER di bawah (least-privilege: hanya kolom tanggal/sesi/set_by/aslab_name),
-- bukan SELECT policy yang membuka seluruh baris schedules.

-- =============================================================================
-- 1a. TRIGGER: batas 3 aslab per (sesi, tanggal) — sumber kebenaran, anti race-condition
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cek_batas_aslab_jadwal()
RETURNS TRIGGER AS $$
DECLARE
  jumlah_terisi INT;
BEGIN
  -- Skip bila tanggal/sesi kosong: tidak ada slot konkret untuk dibatasi.
  IF NEW.tanggal IS NULL OR NEW.sesi IS NULL THEN
    RETURN NEW;
  END IF;

  -- Kunci transaksional berbasis kombinasi sesi+tanggal.
  -- Dilepas otomatis di akhir transaksi. Hash collision hanya menyebabkan serialisasi
  -- berlebih (false contention), TIDAK mengganggu kebenaran hitungan di bawah.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.sesi::text || NEW.tanggal::text));

  -- Hitung baris aslab LAIN di slot yang sama (exclude diri sendiri -> aman saat UPDATE
  -- dan saat aslab yang sama punya >1 kelompok). IS DISTINCT FROM = NULL-safe.
  SELECT COUNT(*) INTO jumlah_terisi
  FROM public.schedules
  WHERE sesi = NEW.sesi
    AND tanggal = NEW.tanggal
    AND set_by IS DISTINCT FROM NEW.set_by;

  -- jumlah_terisi = jumlah aslab lain yang sudah ambil slot ini.
  -- >= 3 berarti slot sudah ditempati 3 aslab lain -> diri kita jadi ke-4 -> tolak.
  -- (Max 3 TOTAL per (sesi, tanggal), sesuai konfirmasi Kimak.)
  IF jumlah_terisi >= 3 THEN
    RAISE EXCEPTION 'Jadwal ini sudah penuh (maksimal 3 aslab per tanggal)'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_batas_aslab_jadwal
  BEFORE INSERT OR UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.cek_batas_aslab_jadwal();

-- =============================================================================
-- 1c. RPC SECURITY DEFINER: katalog jadwal lintas-aslab (read-only, least-privilege)
-- Dipakai untuk: Task 1b (hitung terisi per slot -> indikator) & Task 2 (katalog).
-- Hanya mengekspos tanggal/sesi/set_by/aslab_name — bukan module_id/kelompok/updated_at.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.katalog_jadwal_aslab()
RETURNS TABLE (
  tanggal date,
  sesi    text,
  set_by  text,
  aslab_name text
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT s.tanggal,
         s.sesi,
         s.set_by,
         p.name AS aslab_name
  FROM public.schedules s
  LEFT JOIN public.profiles p ON p.username = s.set_by
  WHERE s.tanggal IS NOT NULL
    AND s.sesi IS NOT NULL
  ORDER BY s.tanggal DESC, s.sesi ASC;
$$;

-- Akses: hanya yang sudah login (katalog ada di nav aslab; data tidak sensitif:
-- hanya slot + nama aslab, sama seperti halaman Kontak yang sudah ada via prof_p_select_aslab).
GRANT EXECUTE ON FUNCTION public.katalog_jadwal_aslab() TO authenticated;
