-- Skema nilai v2: total bobot 100% + komponen baru "Diskusi dan Keaktifan" +
-- Plagiasi/AI jadi pengurang poin langsung (bukan komponen berbobot).
-- Data grades saat ini masih uji coba, aman diubah bebas.

ALTER TABLE public.grades
  ADD COLUMN diskusi_keaktifan numeric(5,2) CHECK (diskusi_keaktifan BETWEEN 0 AND 100),
  ADD COLUMN cat_diskusi_keaktifan text;

CREATE OR REPLACE FUNCTION public.recompute_nilai_akhir() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.nilai_akhir := GREATEST(0, ROUND(CAST(
      COALESCE(NEW.prelab,0)             * 0.10 +
      COALESCE(NEW.inlab,0)              * 0.10 +
      COALESCE(NEW.diskusi_keaktifan,0)  * 0.10 +
      COALESCE(NEW.abstrak,0)            * 0.05 +
      COALESCE(NEW.pendahuluan,0)        * 0.10 +
      COALESCE(NEW.metodologi,0)         * 0.05 +
      COALESCE(NEW.analisis,0)           * 0.15 +
      COALESCE(NEW.pembahasan,0)         * 0.20 +
      COALESCE(NEW.kesimpulan,0)         * 0.10 +
      COALESCE(NEW.format,0)             * 0.05
      - COALESCE(NEW.plagiasi,0)
    AS numeric(5,2))));
  RETURN NEW;
END;
$$;

-- Recompute semua baris grades lama yang sudah ada dengan formula baru.
UPDATE public.grades SET updated_at = now();