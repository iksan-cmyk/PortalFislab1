-- 0016_perbaikan_aturan_jadwal.sql
-- Perbaikan aturan jadwal sesuai RENCANA_PERUBAHAN_v10.md Tugas 2.
--
-- Aturan final (hanya TIGA), ditegakkan pada baris schedules LAIN dengan
-- kombinasi tanggal + sesi yang sama (baris sendiri dikecualikan):
--   a) Umum (SEMUA judul, termasuk E3 & E9): maksimal 3 baris jadwal
--      (kombinasi modul+kelompok) per sesi.
--      Pesan: 'Jadwal ini sudah penuh: maksimal 3 kelompok per sesi.'
--   b) E3: maksimal 2 baris E3 per sesi.
--      Pesan: 'Sesi ini sudah memiliki 2 kelompok E3 (maksimal 2 per sesi).'
--   c) E9: maksimal 1 baris E9 per sesi.
--      Pesan: 'Sesi ini sudah memiliki 1 kelompok E9 (maksimal 1 per sesi).'
--
-- Yang DIHAPUS dari 0015 (logika lama yang SALAH):
--   - "E3 tidak boleh berada di sesi yang sama dengan judul lain".
--   - "Judul lain tidak boleh di sesi yang berisi E3".
--   Judul E lain TIDAK dipengaruhi aturan E3/E9; hanya batas umum 3 berlaku.
--
-- Pengecualian admin untuk b) dan c) dipertahankan persis seperti 0015
-- (app_current_role() = 'admin' OR auth.uid() IS NULL -> skip cek E3/E9).
-- Batas umum 3 (a) tetap berlaku untuk admin seperti sebelumnya di 0009.
--
-- Perubahan dari 0009: hitungan bukan lagi "DISTINCT set_by" (aslab berbeda),
-- melainkan hitung BARIS jadwal (COUNT(*)) exclude baris sendiri (id <> NEW.id)
-- -> mencerminkan "maksimal 3 kelompok per sesi", bukan "3 aslab berbeda".
--
-- Kunci advisory_lock SAMA dengan 0009 & 0015 untuk (tanggal, sesi):
--   pg_advisory_xact_lock(hashtext(NEW.sesi::text || NEW.tanggal::text))
-- Urutan kunci identik -> tidak ada race maupun deadlock antar trigger.
--
-- Tidak mengubah/menghapus data jadwal yang sudah ada; aturan hanya
-- ditegakkan saat INSERT/UPDATE berikutnya. Jangan dijalankan dari sini
-- (jalankan via Supabase SQL Editor / db push).

-- =============================================================================
-- 1. CREATE OR REPLACE FUNCTION cek_batas_aslab_jadwal() — batas umum 3 baris
--    Salin badan 0009, ubah HANYA: hitung baris (COUNT(*), exclude id sendiri)
--    bukan DISTINCT set_by. Nama fungsi & trigger tetap.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cek_batas_aslab_jadwal()
RETURNS TRIGGER AS $$
DECLARE
  jumlah_terisi INT;
BEGIN
  -- Skip bila tanggal/sesi kosong: tidak ada slot konkret untuk dibatasi.
  IF NEW.tanggal IS NULL OR NEW.sesi IS NULL THEN
    RETURN NEW;
  END IF;

  -- Kunci transaksional berbasis kombinasi sesi+tanggal (sama dengan 0015).
  PERFORM pg_advisory_xact_lock(hashtext(NEW.sesi::text || NEW.tanggal::text));

  -- Hitung baris jadwal LAIN di slot yang sama (exclude baris sendiri via id).
  -- Catatan: sebelum 0016, 0009 menghitung DISTINCT set_by (aslab berbeda);
  -- sekarang dihitung per baris (kombinasi modul+kelompok) -> "3 kelompok".
  SELECT COUNT(*) INTO jumlah_terisi
  FROM public.schedules
  WHERE sesi = NEW.sesi
    AND tanggal = NEW.tanggal
    AND id <> NEW.id;

  -- jumlah_terisi = jumlah baris lain yang sudah ambil slot ini.
  -- >= 3 berarti slot sudah ditempati 3 kelompok lain -> diri kita jadi ke-4 -> tolak.
  IF jumlah_terisi >= 3 THEN
    RAISE EXCEPTION 'Jadwal ini sudah penuh: maksimal 3 kelompok per sesi.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 2. CREATE OR REPLACE FUNCTION cek_aturan_e3_e9_jadwal() — E3 max 2, E9 max 1
--    Salin badan 0015, HAPUS pemeriksaan "E3 vs judul lain" dan "judul lain
--    vs E3". Pengecualian admin dipertahankan apa adanya.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cek_aturan_e3_e9_jadwal()
RETURNS TRIGGER AS $$
DECLARE
  v_kode       text;
  jml_e3       int;
  jml_e9       int;
BEGIN
  -- Skip bila tanggal/sesi kosong: tidak ada slot konkret untuk dibatasi.
  IF NEW.tanggal IS NULL OR NEW.sesi IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pengecualian: admin & service_role (auth.uid() null) -> lewati pengecekan E3/E9.
  IF app_current_role() = 'admin' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pada UPDATE yang tidak mengubah kolom relevan -> skip (idempoten).
  IF TG_OP = 'UPDATE' AND
     NEW.tanggal    IS NOT DISTINCT FROM OLD.tanggal AND
     NEW.sesi       IS NOT DISTINCT FROM OLD.sesi AND
     NEW.module_id  IS NOT DISTINCT FROM OLD.module_id AND
     NEW.kelompok   IS NOT DISTINCT FROM OLD.kelompok THEN
    RETURN NEW;
  END IF;

  -- Kunci lock SAMA dengan cek_batas_aslab_jadwal -> terserialisasi, bebas race.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.sesi::text || NEW.tanggal::text));

  -- Kode modul yang sedang di-insert/update (E3, E9, atau lainnya).
  SELECT UPPER(BTRIM(m.kode)) INTO v_kode
    FROM public.modules m WHERE m.id = NEW.module_id;

  -- Hitung baris E3 lain di sesi ini (exclude baris sendiri via id <> NEW.id).
  SELECT COUNT(*) INTO jml_e3
    FROM public.schedules s
    WHERE s.tanggal = NEW.tanggal
      AND s.sesi    = NEW.sesi
      AND s.id <> NEW.id
      AND EXISTS (
        SELECT 1 FROM public.modules m2
         WHERE m2.id = s.module_id AND UPPER(BTRIM(m2.kode)) = 'E3'
      );

  -- Hitung baris E9 lain di sesi ini (exclude baris sendiri).
  SELECT COUNT(*) INTO jml_e9
    FROM public.schedules s
    WHERE s.tanggal = NEW.tanggal
      AND s.sesi    = NEW.sesi
      AND s.id <> NEW.id
      AND EXISTS (
        SELECT 1 FROM public.modules m2
         WHERE m2.id = s.module_id AND UPPER(BTRIM(m2.kode)) = 'E9'
      );

  -- Evaluasi aturan berdasarkan kode modul yang sedang dipilih.
  -- Hanya dua aturan khusus: E3 maksimal 2, E9 maksimal 1.
  -- Tidak ada lagi larangan "E3 bersama judul lain" atau "judul lain di sesi E3".
  IF v_kode = 'E3' THEN
    IF jml_e3 >= 2 THEN
      RAISE EXCEPTION 'Sesi ini sudah memiliki 2 kelompok E3 (maksimal 2 per sesi).'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_kode = 'E9' THEN
    IF jml_e9 >= 1 THEN
      RAISE EXCEPTION 'Sesi ini sudah memiliki 1 kelompok E9 (maksimal 1 per sesi).'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger tidak di-drop/recreate: CREATE OR REPLACE FUNCTION otomatis
-- menggantikan definisi lama, trigger existing (trg_batas_aslab_jadwal &
-- trg_aturan_e3_e9_jadwal) langsung memakai fungsi baru.

-- =============================================================================
-- VERIFIKASI (manual, setelah apply):
--   Sebagai aslab non-admin:
--   1. Sesi kosong: insert E3 kelompok A, E3 kelompok B -> OK. E3 kelompok C
--      -> ditolak ("2 kelompok E3").
--   2. Sesi berisi 2 E3: insert judul E1 -> OK (jadi baris ke-3). Insert
--      baris ke-4 (judul apa pun) -> ditolak ("maksimal 3 kelompok per sesi").
--   3. Sesi berisi 1 E9: insert E9 kedua -> ditolak ("1 kelompok E9"); insert
--      judul non-E9 lain -> OK.
--   4. Tidak ada lagi penolakan "E3 tidak boleh berada" / "Sesi ini berisi E3".
--   Sebagai admin: E3/E9 LOLOS, batas umum 3 TETAP berlaku.
-- =============================================================================
