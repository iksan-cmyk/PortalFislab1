-- Pemantauan penilaian: daftar aslab yang belum (selesai) menilai kelompok yang diajarnya.
-- Akses dibatasi ke role admin + username dalam tabel akses_pemantauan. Penegakan di
-- server (fungsi SECURITY DEFINER + cek akses di dalam fungsi), bukan penyembunyian menu.

-- ============================================================
-- 1. Tabel allowlist akses
-- ============================================================
-- Hanya diakses lewat fungsi SECURITY DEFINER, tanpa policy untuk client.
-- ON UPDATE CASCADE supaya rename_username.js tidak merusak baris di sini.
CREATE TABLE public.akses_pemantauan (
  username text PRIMARY KEY REFERENCES public.profiles(username)
    ON UPDATE CASCADE ON DELETE CASCADE
);
ALTER TABLE public.akses_pemantauan ENABLE ROW LEVEL SECURITY;

-- Seed awal lima aslab. INSERT ... SELECT supaya username yang belum ada di
-- profiles tidak menggagalkan migrasi (akun itu tinggal ditambahkan nanti).
--
-- Menambah akses : INSERT INTO public.akses_pemantauan (username)
--                    VALUES ('username') ON CONFLICT DO NOTHING;
-- Mencabut akses : DELETE FROM public.akses_pemantauan WHERE username = 'username';
INSERT INTO public.akses_pemantauan (username)
SELECT username FROM public.profiles
WHERE username IN (
  '5001241089','5001241054','5001241080','5001241081','5001241076'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Fungsi cek akses
-- ============================================================
CREATE OR REPLACE FUNCTION public.punya_akses_pemantauan()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
      public.app_current_role() = 'admin'
      OR public.current_username() IN (
           SELECT username FROM public.akses_pemantauan
         ),
      false
    );
$$;

REVOKE EXECUTE ON FUNCTION public.punya_akses_pemantauan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.punya_akses_pemantauan() TO authenticated;

-- ============================================================
-- 3. Fungsi data pemantauan: satu baris per unit yang sudah lewat
-- ============================================================
-- Unit pantau = baris rotasi (modul x kelompok). Praktikan kelompok = profiles
-- role 'praktikan' dengan kelompok sama. "Sudah dinilai" seorang praktikan =
-- ada baris grades utk (username, module_id) dengan nilai_akhir NOT NULL DAN
-- minimal satu komponen utama terisi (simpan kosong menghasilkan nilai_akhir 0,
-- jangan dihitung sebagai sudah).
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
BEGIN
  IF NOT COALESCE(public.punya_akses_pemantauan(), false) THEN
    RAISE EXCEPTION 'Tidak punya akses' USING ERRCODE = '42501';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Jakarta')::date;

  RETURN QUERY
  WITH dinilai AS (
    SELECT g.username, g.module_id
    FROM public.grades g
    WHERE g.nilai_akhir IS NOT NULL
      AND (g.prelab IS NOT NULL OR g.inlab_pengambilan_data IS NOT NULL
        OR g.inlab_diskusi IS NOT NULL OR g.inlab_kerapian IS NOT NULL
        OR g.abstrak IS NOT NULL OR g.pendahuluan IS NOT NULL
        OR g.metodologi IS NOT NULL OR g.analisis_data IS NOT NULL
        OR g.analisis_perhitungan_grafik IS NOT NULL
        OR g.pembahasan IS NOT NULL OR g.kesimpulan IS NOT NULL
        OR g.format IS NOT NULL)
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

-- ============================================================
-- 4. Ringkasan unit yang belum waktunya / belum dijadwalkan
-- ============================================================
-- total_unit = jumlah unit (modul x kelompok) yang punya >= 1 praktikan.
-- belum_waktu = unit yang belum ada jadwal lewat (tanggal < hari ini).
-- Unit yang sudah lewat dihitung sisi klien dari pemantauan_penilaian().
CREATE OR REPLACE FUNCTION public.pemantauan_ringkas()
RETURNS TABLE (
  total_unit  int,
  belum_waktu int
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_today date;
BEGIN
  IF NOT COALESCE(public.punya_akses_pemantauan(), false) THEN
    RAISE EXCEPTION 'Tidak punya akses' USING ERRCODE = '42501';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Jakarta')::date;

  RETURN QUERY
  WITH grup AS (
    SELECT r.module_id, r.kelompok, count(pp.username)::int AS jml
    FROM public.rotasi r
    LEFT JOIN public.profiles pp
      ON pp.role = 'praktikan' AND pp.kelompok = r.kelompok
    GROUP BY r.module_id, r.kelompok
  ),
  lewat AS (
    SELECT DISTINCT s.module_id, s.kelompok
    FROM public.schedules s
    WHERE s.tanggal < v_today
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM lewat l
      WHERE l.module_id = g.module_id AND l.kelompok = g.kelompok
    ))::int
  FROM grup g
  WHERE g.jml > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pemantauan_ringkas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pemantauan_ringkas() TO authenticated;