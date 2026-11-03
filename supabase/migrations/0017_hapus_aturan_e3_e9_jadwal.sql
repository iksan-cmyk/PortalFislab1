-- 0017_hapus_aturan_e3_e9_jadwal.sql
-- Menghapus aturan khusus E3/E9 pada jadwal (RENCANA_PERUBAHAN_v11.md Tugas 1).
--
-- Latar belakang: aturan E3 (maksimal 2 kelompok per sesi) dan E9 (maksimal
-- 1 kelompok per sesi) diberlakukan sejak 0015 dan diperbarui di 0016 lewat
-- fungsi cek_aturan_e3_e9_jadwal() + trigger trg_aturan_e3_e9_jadwal. Aturan
-- ini DIHAPUS total: semua aslab bebas memilih tanggal & sesi untuk judul/modul
-- apa pun, termasuk E3 dan E9. Satu-satunya aturan jadwal yang tersisa adalah
-- batas umum maksimal 3 kelompok per (tanggal, sesi) dari
-- cek_batas_aslab_jadwal() + trg_batas_aslab_jadwal (0009, diperbarui 0016) —
-- fungsi & trigger itu TIDAK disentuh di sini.
--
-- Nama trigger & fungsi diambil persis dari 0015 (baris 30, 129-133) dan 0016
-- (baris 78, 152-154): trg_aturan_e3_e9_jadwal / public.cek_aturan_e3_e9_jadwal().

DROP TRIGGER IF EXISTS trg_aturan_e3_e9_jadwal ON public.schedules;
DROP FUNCTION IF EXISTS public.cek_aturan_e3_e9_jadwal();

-- Tidak mengubah/menghapus data jadwal yang sudah ada; hanya menghapus
-- penegakan aturan pada INSERT/UPDATE berikutnya.

-- =============================================================================
-- VERIFIKASI (manual, setelah apply):
--   Sebagai aslab non-admin:
--   1. Sesi kosong: insert E3 kelompok A, E3 kelompok B, E3 kelompok C
--      -> ketiganya DITERIMA (E3 ke-3 tidak lagi ditolak "2 kelompok E3"),
--      selama total baris di sesi itu masih <= 3.
--   2. Sesi berisi 1 E9: insert E9 kelompok kedua -> DITERIMA (E9 ke-2 tidak
--      lagi ditolak "1 kelompok E9"), selama total baris di sesi itu masih <= 3.
--   3. Sesi berisi 3 baris (judul apa pun): insert baris ke-4 -> DITOLAK
--      dengan pesan 'Jadwal ini sudah penuh: maksimal 3 kelompok per sesi.'
--      (cek_batas_aslab_jadwal / trg_batas_aslab_jadwal tetap aktif).
--   Sebagai admin: batas umum 3 TETAP berlaku (tidak ada pengecualian admin
--   untuk batas umum sejak 0009).
-- =============================================================================
