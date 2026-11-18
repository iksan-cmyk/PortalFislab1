-- RPC read-only lintas-aslab untuk tampilan "Per Kelompok" di Katalog Jadwal.
-- Beda dengan katalog_jadwal_aslab (0009): RPC ini menambah expose module_id +
-- kelompok (sengaja disembunyikan di 0009) karena toggle "Per Kelompok" butuh
-- join jadwal ke modul+kelompok, bukan cuma slot waktu. Tidak menyentuh RPC
-- katalog_jadwal_aslab yang sudah ada supaya toggle "Per Tanggal" & indikator
-- slot terisi di halaman Jadwal tidak berubah.

CREATE OR REPLACE FUNCTION public.jadwal_kelompok_modul()
RETURNS TABLE (
  kelompok   int,
  module_id  text,
  tanggal    date,
  sesi       text,
  set_by     text,
  aslab_name text
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT s.kelompok,
         s.module_id,
         s.tanggal,
         s.sesi,
         s.set_by,
         p.name AS aslab_name
  FROM public.schedules s
  LEFT JOIN public.profiles p ON p.username = s.set_by
  WHERE s.tanggal IS NOT NULL
    AND s.sesi IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.jadwal_kelompok_modul() TO authenticated;
