-- wipe_all.sql — Reset total DB sebelum re-migrate dari CSV baru.
-- Jalankan di Supabase Studio -> SQL Editor sekali saja, SEBELUM `node migrate.js`.
--
-- Scope: full wipe — semua tabel publik + semua akun Auth.
-- Setelah ini profiles kosong -> migrate.js akan treat semua baris users.csv
-- sebagai akun BARU (createUser + set must_change_password=true).
--
-- Storage bucket `avatars` TIDAK ikut dihapus (foto lama jadi orphan, aman diabaikan).

BEGIN;

-- 1. Hapus semua data tabel publik (CASCADE urus FK, RESTART IDENTITY reset serial rotasi)
TRUNCATE TABLE
  public.grades,
  public.schedules,
  public.rotasi,
  public.modules,
  public.profiles
RESTART IDENTITY CASCADE;

-- 2. Hapus semua akun Auth (cascade ke auth.sessions, auth.refresh_tokens, auth.mfa_factors, dst)
DELETE FROM auth.users;

COMMIT;

-- Verifikasi (semua harus 0)
SELECT 'profiles' AS t, COUNT(*) FROM public.profiles
UNION ALL SELECT 'modules',    COUNT(*) FROM public.modules
UNION ALL SELECT 'rotasi',     COUNT(*) FROM public.rotasi
UNION ALL SELECT 'schedules',  COUNT(*) FROM public.schedules
UNION ALL SELECT 'grades',     COUNT(*) FROM public.grades
UNION ALL SELECT 'auth.users', COUNT(*) FROM auth.users;
