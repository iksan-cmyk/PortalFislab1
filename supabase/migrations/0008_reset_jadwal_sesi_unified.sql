-- Reset seluruh pilihan jadwal aslab lama. Slot waktu lama (SESI_SENIN_KAMIS/
-- SESI_JUMAT) tidak overlap sama sekali dengan slot waktu baru (SESI 1-6), jadi
-- baris lama tidak relevan; aslab submit ulang dari nol setelah perubahan ini live.
-- Tidak ada FK yang menunjuk ke schedules, jadi DELETE aman. Sebelum menjalankan
-- di production, backup dulu: SELECT * FROM public.schedules;

DELETE FROM public.schedules;
