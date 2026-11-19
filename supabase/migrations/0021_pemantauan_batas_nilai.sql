-- Pemantauan penilaian: daftar aslab yang belum (selesai) menilai kelompok yang diajarnya.
-- Perubahan 0021: "sudah dinilai" ditentukan dari nilai_akhir >= batas, bukan dari
-- minimal satu komponen terisi. Batas dipegang satu konstanta (v_batas) supaya mudah diubah.
-- Akses dibatasi ke role admin + username dalam tabel akses_pemantauan. Penegakan di
-- server (fungsi SECURITY DEFINER + cek akses di dalam fungsi), bukan penyembunyian menu.

-- ============================================================
-- 3. Fungsi data pemantauan: satu baris per unit yang sudah lewat
-- ============================================================
-- Unit pantau = baris rotasi (modul x kelompok). Praktikan kelompok = profiles
-- role 'praktikan' dengan kelompok sama. "Sudah dinilai" seorang praktikan =
-- ada baris grades utk (username, module_id) dengan nilai_akhir >= v_batas
-- (nilai_akhir 0 dari komponen kosong, atau < 40 karena pengurang
-- plagiasi/keterlambatan, dihitung belum dinilai).
CREATE OR REPLACE FUNCTION public.pemantauan_penilaian()
RETURNS TABLE (
  aslab_username  text,
  aslab_name      text,
  aslab_wa        text,
  module_id       text,
  kode            text,
  judul           text,
  kelompok        int,
  tanggal         date,
  sesi            text,
  hari_terlambat  int,
  total_praktikan int,
  sudah_dinilai   int,
  belum_list      jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_today date;
  v_batas constant numeric := 40;
BEGIN
  IF NOT COALESCE(public.punya_akses_pemantauan(), false) THEN
    RAISE EXCEPTION 'Tidak punya akses' USING ERRCODE = '42501';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Jakarta')::date;

  RETURN QUERY
  WITH dinilai AS (
    SELECT g.username, g.module_id
    FROM public.grades g
    WHERE g.nilai_akhir >= v_batas
  )
  SELECT
    u.aslab_username,
    a.name,
    a.wa,
    u.module_id,
    m.kode,
    m.judul,
    u.kelompok,
    j.tanggal,
    j.sesi,
    (v_today - j.tanggal)::int,
    p.total_praktikan,
    p.sudah_dinilai,
    p.belum_list
  FROM public.rotasi u
  JOIN public.modules m ON m.id = u.module_id
  JOIN public.schedules j
    ON j.module_id = u.module_id
   AND j.kelompok = u.kelompok
   AND j.tanggal < v_today
  LEFT JOIN public.profiles a ON a.username = u.aslab_username
  CROSS JOIN LATERAL (
    SELECT
      count(pp.username)::int AS total_praktikan,
      count(CASE WHEN d.username IS NOT NULL THEN 1 END)::int AS sudah_dinilai,
      COALESCE(
        jsonb_agg(jsonb_build_object('name', pp.name, 'nrp', pp.nrp)
          ORDER BY pp.name)
        FILTER (WHERE d.username IS NULL),
        '[]'::jsonb
      ) AS belum_list
    FROM public.profiles pp
    LEFT JOIN dinilai d
      ON d.username = pp.username AND d.module_id = u.module_id
    WHERE pp.role = 'praktikan' AND pp.kelompok = u.kelompok
  ) p
  WHERE p.total_praktikan > 0
  ORDER BY j.tanggal ASC, a.name, u.kelompok;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pemantauan_penilaian() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pemantauan_penilaian() TO authenticated;
