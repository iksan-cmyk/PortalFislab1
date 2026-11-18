-- Batas maksimal 3 kelompok per (tanggal, sesi) + RPC katalog jadwal lintas-aslab.
--
-- Pilihan jadwal aslab disimpan di tabel `schedules`: module_id, kelompok, tanggal (date),
-- sesi (text slot waktu), set_by (username aslab), updated_at; UNIQUE(module_id, kelompok).
-- Aturan: maksimal 3 TOTAL baris per (sesi, tanggal); baris ke-4 ditolak.
--
-- Dengan RLS saat ini (0001), aslab hanya ALL untuk modul yang dipegang sendiri dan tidak
-- bisa membaca jadwal aslab lain. Untuk menghitung slot terisi dan menampilkan katalog
-- diperlukan akses baca lintas-aslab, disediakan lewat RPC SECURITY DEFINER di bawah
-- (least-privilege: hanya kolom tanggal/sesi/set_by/aslab_name, bukan SELECT seluruh baris).

-- TRIGGER: batas 3 kelompok per (sesi, tanggal) — sumber kebenaran, anti race-condition

CREATE OR REPLACE FUNCTION public.cek_batas_aslab_jadwal()
RETURNS TRIGGER AS $$
DECLARE
  jumlah_terisi INT;
BEGIN
  -- Skip bila tanggal/sesi kosong: tidak ada slot konkret untuk dibatasi.
  IF NEW.tanggal IS NULL OR NEW.sesi IS NULL THEN
    RETURN NEW;
  END IF;

  -- Kunci transaksional berbasis kombinasi sesi+tanggal.
  -- Dilepas otomatis di akhir transaksi. Hash collision hanya menyebabkan serialisasi
  -- berlebih (false contention), TIDAK mengganggu kebenaran hitungan di bawah.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.sesi::text || NEW.tanggal::text));

  -- Hitung baris aslab LAIN di slot yang sama (exclude diri sendiri -> aman saat UPDATE
  -- dan saat aslab yang sama punya >1 kelompok). IS DISTINCT FROM = NULL-safe.
  SELECT COUNT(*) INTO jumlah_terisi
  FROM public.schedules
  WHERE sesi = NEW.sesi
    AND tanggal = NEW.tanggal
    AND set_by IS DISTINCT FROM NEW.set_by;

  -- jumlah_terisi = jumlah aslab lain yang sudah ambil slot ini.
  -- >= 3 berarti slot sudah ditempati 3 aslab lain -> diri kita jadi ke-4 -> tolak.
  -- (Maksimal 3 TOTAL per (sesi, tanggal).)
  IF jumlah_terisi >= 3 THEN
    RAISE EXCEPTION 'Jadwal ini sudah penuh (maksimal 3 aslab per tanggal)'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Idempotent: DROP dulu sebelum CREATE (aman bila migrasi ini dijalankan ulang /
-- setelah rename dari 0008 -> 0009 di lingkungan yang sudah pernah apply 0008 lama).
DROP TRIGGER IF EXISTS trg_batas_aslab_jadwal ON public.schedules;

CREATE TRIGGER trg_batas_aslab_jadwal
  BEFORE INSERT OR UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.cek_batas_aslab_jadwal();

-- RPC SECURITY DEFINER: katalog jadwal lintas-aslab (read-only, least-privilege).
-- Dipakai untuk indikator slot terisi dan halaman Katalog. Hanya mengekspos
-- tanggal/sesi/set_by/aslab_name — bukan module_id/kelompok/updated_at.

CREATE OR REPLACE FUNCTION public.katalog_jadwal_aslab()
RETURNS TABLE (
  tanggal date,
  sesi    text,
  set_by  text,
  aslab_name text
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT s.tanggal,
         s.sesi,
         s.set_by,
         p.name AS aslab_name
  FROM public.schedules s
  LEFT JOIN public.profiles p ON p.username = s.set_by
  WHERE s.tanggal IS NOT NULL
    AND s.sesi IS NOT NULL
  ORDER BY s.tanggal DESC, s.sesi ASC;
$$;

-- Akses: hanya yang sudah login (katalog ada di nav aslab; data tidak sensitif:
-- hanya slot + nama aslab, sama seperti halaman Kontak yang sudah ada via prof_p_select_aslab).
GRANT EXECUTE ON FUNCTION public.katalog_jadwal_aslab() TO authenticated;
