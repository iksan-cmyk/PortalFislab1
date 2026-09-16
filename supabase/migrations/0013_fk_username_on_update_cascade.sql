-- 0013_fk_username_on_update_cascade.sql
-- Fitur 2 (RENCANA_PERUBAHAN_v8.md): dukung rename username praktikan.
--
-- profiles.username direferensikan oleh:
--   - grades.username      (REFERENCES profiles(username), 0001)
--   - rotasi.aslab_username (REFERENCES profiles(username), 0001)
-- Kedua FK ini tanpa klausa ON UPDATE -> default NO ACTION -> UPDATE profiles.username
-- akan GAGAL bila ada baris grades/rotasi yang mereferensi username lama.
--
-- Script rename_username.js hanya mengupdate profiles.username (+ email Auth);
-- agar tidak harus menyentuh grades/rotasi manual (di luar scope spec), ubah
-- kedua FK menjadi ON UPDATE CASCADE. Efek samping positif: rename username
-- aslab juga otomatis propagasi ke rotasi.aslab_username. Tidak ada perubahan
-- perilaku DELETE (tetap NO ACTION default) -> tidak menghapus nilai/jadwal
-- saat akun dihapus.
--
-- Idempotent: pakai DO block untuk drop FK berdasarkan nama yang ditemukan
-- dinamis (constraint name auto-generated oleh Postgres bisa berbeda per
-- environment), lalu CREATE ulang dengan ON UPDATE CASCADE.

DO $$
DECLARE
  fk_name text;
BEGIN
  -- grades.username -> profiles.username
  SELECT conname INTO fk_name
    FROM pg_constraint c
    JOIN pg_class t  ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class rt  ON rt.oid = c.confrelid
   WHERE t.relname = 'grades' AND n.nspname = 'public'
     AND c.contype = 'f' AND rt.relname = 'profiles';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.grades DROP CONSTRAINT %I', fk_name);
  END IF;

  -- rotasi.aslab_username -> profiles.username
  SELECT conname INTO fk_name
    FROM pg_constraint c
    JOIN pg_class t  ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class rt  ON rt.oid = c.confrelid
   WHERE t.relname = 'rotasi' AND n.nspname = 'public'
     AND c.contype = 'f' AND rt.relname = 'profiles';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.rotasi DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE public.grades
  ADD CONSTRAINT grades_username_fkey
  FOREIGN KEY (username) REFERENCES public.profiles(username)
  ON UPDATE CASCADE;

ALTER TABLE public.rotasi
  ADD CONSTRAINT rotasi_aslab_username_fkey
  FOREIGN KEY (aslab_username) REFERENCES public.profiles(username)
  ON UPDATE CASCADE;