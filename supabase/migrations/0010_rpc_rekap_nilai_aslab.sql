-- 0010_rpc_rekap_nilai_aslab.sql
-- RPC read-only lintas-aslab untuk Rekap Nilai E1-E10 (Fitur 1, RENCANA_PERUBAHAN_v5.md Task A).
-- Least-privilege: HANYA expose username + module_id + nilai_akhir.
-- TIDAK expose 12 komponen nilai, catatan, set_by, atau updated_at.
-- Tidak mengubah RLS/GRANT tulis apa pun di tabel grades — murni tambahan baca.

CREATE OR REPLACE FUNCTION public.rekap_nilai_aslab()
RETURNS TABLE (
  username    text,
  module_id   text,
  nilai_akhir numeric(5,2)
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT g.username, g.module_id, g.nilai_akhir
  FROM public.grades g
  WHERE g.nilai_akhir IS NOT NULL;
$$;

-- Akses: sama pola dengan katalog_jadwal_aslab (0009) — grant ke authenticated,
-- bukan cuma role aslab, karena data yang diekspos (nilai akhir final, tanpa
-- breakdown) sudah dianggap tidak sensitif setingkat itu, dan praktikan/admin
-- tidak akan memakai RPC ini dari UI (mereka punya jalur select langsung sendiri).
GRANT EXECUTE ON FUNCTION public.rekap_nilai_aslab() TO authenticated;
