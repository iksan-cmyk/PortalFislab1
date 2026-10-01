-- 0014_keterlambatan.sql
-- Tambah unit penilaian `keterlambatan` — pengurang langsung, mekanisme persis
-- sama dengan `plagiasi` (0001:74, 0006:42). Poin diinput aslab langsung
-- dikurangkan dari nilai total. Tidak boleh merusak perhitungan nilai yang
-- sudah ada.
--
-- Tipe & constraint disamakan dengan `plagiasi`: numeric(5,2) CHECK BETWEEN 0
-- AND 100. Beda: keterlambatan diberi NOT NULL DEFAULT 0 (sesuai spec v9
-- Tugas 1) supaya semua baris lama otomatis bernilai 0 dan nilai_akhir lama
-- TIDAK berubah. `plagiasi` sendiri tetap nullable seperti 0001 — tidak diubah.
--
-- `nilai_akhir` dihitung di sisi DB oleh fungsi/trigger recompute_nilai_akhir
-- (0001:151-171, versi otoritatif terbaru di 0006:26-46). Rumus 0006 sudah
-- memakai GREATEST(0, ...) -> clamp bawah ke 0 (nilai_akhir tidak bisa negatif).
-- Keterlambatan ditambahkan ke pengurang di dalam GREATEST(0, ...) yang sama,
-- sehingga perlakuan batas bawah MENGIKUTI PERSIS perlakuan plagiasi yang sudah
-- ada (clamp ke 0). Tidak menambah clamp sendiri.
--
-- Trigger trg_grades_nilai (0001:169-171) tidak perlu di-drop/recreate —
-- CREATE OR REPLACE FUNCTION otomatis menggantikan definisi fungsi lama dan
-- trigger existing memanggil fungsi terbaru.
--
-- Tidak ada UPDATE/DELETE data lama di migrasi ini. DEFAULT 0 menjamin
-- keterlambatan semua baris lama = 0 -> rumus baru mengurangi 0 -> nilai_akhir
-- lama identik.
--
-- RPC rekap_nilai_aslab (0010) hanya ekspos `nilai_akhir` (tidak select kolom
-- komponen per satu), TIDAK perlu diubah. RLS grades (0001/0012) tidak punya
-- kebijakan per-kolom -> tidak perlu diubah.

-- =============================================================================
-- 1. Tambah kolom keterlambatan + catatan keterlambatan
-- =============================================================================
ALTER TABLE public.grades
  ADD COLUMN IF NOT EXISTS keterlambatan numeric(5,2)
    CHECK (keterlambatan BETWEEN 0 AND 100) NOT NULL DEFAULT 0;

ALTER TABLE public.grades
  ADD COLUMN IF NOT EXISTS cat_keterlambatan text;

-- =============================================================================
-- 2. Perbarui recompute_nilai_akhir: kurangi plagiasi + keterlambatan
--    Salin persis isi 0006_skema_nilai_v3.sql:26-46, ubah hanya baris
--    pengurang (- COALESCE(NEW.plagiasi,0) - COALESCE(NEW.keterlambatan,0)).
--    Clamp GREATEST(0, ...) dipertahankan (mengikuti perlakuan plagiasi).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.recompute_nilai_akhir() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.nilai_akhir := GREATEST(0, ROUND(CAST(
      COALESCE(NEW.prelab,0)                      * 0.10 +
      COALESCE(NEW.inlab_pengambilan_data,0)      * 0.15 +
      COALESCE(NEW.inlab_diskusi,0)               * 0.10 +
      COALESCE(NEW.inlab_kerapian,0)              * 0.05 +
      COALESCE(NEW.abstrak,0)                     * 0.05 +
      COALESCE(NEW.pendahuluan,0)                 * 0.05 +
      COALESCE(NEW.metodologi,0)                  * 0.05 +
      COALESCE(NEW.analisis_data,0)               * 0.05 +
      COALESCE(NEW.analisis_perhitungan_grafik,0) * 0.10 +
      COALESCE(NEW.pembahasan,0)                  * 0.20 +
      COALESCE(NEW.kesimpulan,0)                  * 0.05 +
      COALESCE(NEW.format,0)                      * 0.05
      - COALESCE(NEW.plagiasi,0)
      - COALESCE(NEW.keterlambatan,0)
    AS numeric(5,2))));
  RETURN NEW;
END;
$$;

-- =============================================================================
-- VERIFIKASI (jalankan manual sebelum & sesudah apply migrasi ini):
--   SELECT string_agg(username||'|'||module_id||'|'||nilai_akhir::text, ' '
--         ORDER BY username, module_id) FROM public.grades;
-- Hasil hash/gabungan HARUS identik sebelum vs sesudah migrasi, karena
-- keterlambatan baru = DEFAULT 0 untuk semua baris lama -> pengurang tambahan
-- = 0 -> nilai_akhir tidak berubah.
-- =============================================================================
