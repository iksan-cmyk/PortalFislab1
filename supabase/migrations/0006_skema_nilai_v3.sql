-- Skema nilai v3: in-lab dipecah 3 (Pengambilan Data 15%, Diskusi 10%, Kerapian 5%),
-- analisis dipecah 2 (Data 5%, Perhitungan & Grafik 10%),
-- Pendahuluan & Kesimpulan turun bobot 10% -> 5%. Total tetap 100%.
-- Data grades saat ini masih uji coba, aman diubah bebas (lihat 0005).

ALTER TABLE public.grades
  DROP COLUMN IF EXISTS inlab,
  DROP COLUMN IF EXISTS cat_inlab,
  DROP COLUMN IF EXISTS diskusi_keaktifan,
  DROP COLUMN IF EXISTS cat_diskusi_keaktifan,
  DROP COLUMN IF EXISTS analisis,
  DROP COLUMN IF EXISTS cat_analisis;

ALTER TABLE public.grades
  ADD COLUMN inlab_pengambilan_data          numeric(5,2) CHECK (inlab_pengambilan_data BETWEEN 0 AND 100),
  ADD COLUMN cat_inlab_pengambilan_data      text,
  ADD COLUMN inlab_diskusi                   numeric(5,2) CHECK (inlab_diskusi BETWEEN 0 AND 100),
  ADD COLUMN cat_inlab_diskusi               text,
  ADD COLUMN inlab_kerapian                  numeric(5,2) CHECK (inlab_kerapian BETWEEN 0 AND 100),
  ADD COLUMN cat_inlab_kerapian              text,
  ADD COLUMN analisis_data                   numeric(5,2) CHECK (analisis_data BETWEEN 0 AND 100),
  ADD COLUMN cat_analisis_data               text,
  ADD COLUMN analisis_perhitungan_grafik     numeric(5,2) CHECK (analisis_perhitungan_grafik BETWEEN 0 AND 100),
  ADD COLUMN cat_analisis_perhitungan_grafik text;

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
    AS numeric(5,2))));
  RETURN NEW;
END;
$$;

UPDATE public.grades SET updated_at = now();
