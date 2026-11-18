-- Menghapus aturan khusus E3/E9 pada jadwal.
--
-- Latar belakang: aturan E3 (maksimal 2 kelompok per sesi) dan E9 (maksimal
-- 1 kelompok per sesi) diberlakukan sejak 0015 dan diperbarui di 0016 lewat
-- fungsi cek_aturan_e3_e9_jadwal() + trigger trg_aturan_e3_e9_jadwal. Aturan
-- ini DIHAPUS total: semua aslab bebas memilih tanggal & sesi untuk judul/modul
-- apa pun, termasuk E3 dan E9. Satu-satunya aturan jadwal yang tersisa adalah
-- batas umum maksimal 3 kelompok per (tanggal, sesi) dari
-- cek_batas_aslab_jadwal() + trg_batas_aslab_jadwal (0009, diperbarui 0016) —
-- fungsi & trigger itu TIDAK disentuh di sini.

DROP TRIGGER IF EXISTS trg_aturan_e3_e9_jadwal ON public.schedules;
DROP FUNCTION IF EXISTS public.cek_aturan_e3_e9_jadwal();

-- Tidak mengubah/menghapus data jadwal yang sudah ada; hanya menghapus
-- penegakan aturan pada INSERT/UPDATE berikutnya.

-- Verifikasi manual (aslab non-admin): sesi yang barisnya <= 3 menerima E3 & E9
-- berapa pun (tidak ada lagi penolakan khusus); baris ke-4 ditolak oleh batas umum
-- 3 ("Jadwal ini sudah penuh: maksimal 3 kelompok per sesi."). Batas umum tetap
-- berlaku untuk admin.
