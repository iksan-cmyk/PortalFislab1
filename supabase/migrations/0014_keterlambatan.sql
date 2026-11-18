-- Tambah unit penilaian `keterlambatan` — pengurang langsung, mekanisme sama
-- dengan `plagiasi` (0001, 0006). Tipe/constraint mengikuti `plagiasi`
-- (numeric(5,2) CHECK 0-100), tapi diberi NOT NULL DEFAULT 0 supaya semua baris
-- lama otomatis bernilai 0 dan nilai_akhir lama tidak berubah.
--
-- Pengurang ditambahkan di dalam GREATEST(0, ...) yang sama dengan plagiasi
-- (clamp bawah 0). Trigger tidak perlu di-drop: CREATE OR REPLACE FUNCTION
-- menggantikan definisi lama. Tidak ada UPDATE/DELETE data lama. RPC rekap
-- (0010) & RLS grades tidak perlu diubah.

-- 1. Tambah kolom keterlambatan + catatan keterlambatan
ALTER TABLE public.grades
  ADD COLUMN IF NOT EXISTS keterlambatan numeric(5,2)
    CHECK (keterlambatan BETWEEN 0 AND 100) NOT NULL DEFAULT 0;

ALTER TABLE public.grades
  ADD COLUMN IF NOT EXISTS cat_keterlambatan text;

-- 2. Perbarui recompute_nilai_akhir: kurangi plagiasi + keterlambatan.
--    Basis 0006, hanya baris pengurang yang diubah. Clamp GREATEST(0, ...) dipertahankan.
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

-- Verifikasi manual: gabungan nilai_akhir sebelum & sesudah apply harus identik,
-- karena keterlambatan baru = DEFAULT 0 untuk baris lama (pengurang tambahan = 0).
