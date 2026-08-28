-- 0007_modules_urutan.sql
-- Tambah kolom urutan (integer) di modules untuk pengurutan tampilan yang benar.
-- id TETAP text dan tidak diubah -> FK di rotasi/schedules/grades aman, tidak perlu disentuh.

ALTER TABLE public.modules ADD COLUMN urutan integer;

-- Backfill dari angka di kode (E1 -> 1, E10 -> 10, dst).
UPDATE public.modules
SET urutan = NULLIF(regexp_replace(kode, '\D', '', 'g'), '')::integer;

-- Kalau ada baris yang gagal ter-backfill (kode tidak mengandung angka), migration akan
-- gagal di NOT NULL constraint di bawah -- itu sengaja, supaya ketahuan sebelum production.
ALTER TABLE public.modules ALTER COLUMN urutan SET NOT NULL;
ALTER TABLE public.modules ADD CONSTRAINT modules_urutan_unique UNIQUE (urutan);
