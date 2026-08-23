-- rotasi: aslab_username jadi nullable.
-- CSV rotasi asli punya banyak baris dengan aslab kosong (kelompok belum
-- punya aslab untuk modul tertentu). NOT NULL memaksa baris itu di-skip,
-- yang membuat data rotasi tidak lengkap. Frontend sudah handle null
-- (${r.aslab||'—'} di script.js).
ALTER TABLE public.rotasi ALTER COLUMN aslab_username DROP NOT NULL;
