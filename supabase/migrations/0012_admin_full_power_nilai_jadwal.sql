-- 0012_admin_full_power_nilai_jadwal.sql
-- Fitur 1 (RENCANA_PERUBAHAN_v8.md): admin full-power atas nilai & jadwal.
--
-- Dua perubahan di sini:
-- 1. RLS grades: admin sebelumnya hanya SELECT (grades_admin_select, 0001).
--    Sekarang admin butuh INSERT/UPDATE/DELETE juga (input & hapus nilai untuk
--    kombinasi judul+kelompok+praktikan APA PUN). Ganti policy lama dengan
--    policy FOR ALL yang cek app_current_role() = 'admin'. RLS aslab TIDAK
--    diubah -- grades_aslab_all tetap membatasi aslab ke modul yang dipegang.
-- 2. RPC SECURITY DEFINER admin_hapus_jadwal: hapus satu baris jadwal
--    (module_id + kelompok) BERSAMAAN dengan nilai praktikan kelompok itu
--    untuk modul itu, dalam satu transaksi (fungsi = satu transaksi di
--    Postgres). Tidak ada FK grades->schedules, jadi cascade TIDAK bisa
--    pakai ON DELETE CASCADE; harus hapus eksplisit. SECURITY DEFINER supaya
--    bisa hapus grades lintas-praktikan tanpa terikat RLS baris-per-baris
--    (RLS grades_admin_all sebenarnya sudah mengizinkan, tapi RPC menjamin
--    atomicity kedua delete). Cek role admin di dalam fungsi (defense in
--    depth, bukan andalkan grant).
--
-- Trigger cek_batas_aslab_jadwal (0009) TETAP berlaku saat admin edit jadwal
-- (via upsert schedules) -- tidak di-bypass di sini.

-- =============================================================================
-- 1. RLS grades: admin full power
-- =============================================================================
DROP POLICY IF EXISTS grades_admin_select ON public.grades;

CREATE POLICY grades_admin_all ON public.grades
  FOR ALL TO authenticated
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

-- GRANT SELECT,INSERT,UPDATE,DELETE ON grades TO authenticated sudah ada di 0001,
-- tidak perlu grant tambahan.

-- =============================================================================
-- 2. RPC admin_hapus_jadwal (atomic delete jadwal + nilai terkait)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_hapus_jadwal(p_module_id text, p_kelompok int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Defense in depth: cek role di dalam fungsi, bukan andalkan grant/RLS saja.
  IF app_current_role() <> 'admin' THEN
    RAISE EXCEPTION 'Hanya admin yang boleh menghapus jadwal.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 1. Hapus nilai praktikan kelompok ini untuk modul ini.
  --    kelompok ada di profiles, bukan di grades -> join via subquery.
  DELETE FROM public.grades
   WHERE module_id = p_module_id
     AND username IN (
       SELECT username FROM public.profiles
        WHERE kelompok = p_kelompok AND role = 'praktikan'
     );

  -- 2. Hapus baris jadwal.
  DELETE FROM public.schedules
   WHERE module_id = p_module_id AND kelompok = p_kelompok;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_hapus_jadwal(text, int) TO authenticated;