-- 0018_ubah_judul_modul_e7.sql
-- Ubah judul modul E7 (id 7) dari:
--   "Gejala Transien pada Rangkaian Non-Linier Orde-1"
-- menjadi:
--   "Gejala Transien Pada Rangkaian Linear"
--
-- Judul hanya data di kolom modules.judul (bukan hardcoded di kode frontend),
-- jadi cukup UPDATE satu baris. id tetap 7 -> FK di rotasi/schedules/grades aman.

UPDATE public.modules
SET judul = 'Gejala Transien Pada Rangkaian Linear'
WHERE id = '7' AND kode = 'E7';

-- VERIFIKASI (manual, setelah apply):
--   SELECT id, kode, judul FROM public.modules WHERE id = '7';
--   -> id=7, kode=E7, judul='Gejala Transien Pada Rangkaian Linear'