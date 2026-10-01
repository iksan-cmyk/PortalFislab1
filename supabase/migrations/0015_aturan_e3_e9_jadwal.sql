-- 0015_aturan_e3_e9_jadwal.sql
-- Aturan jadwal E3 & E9 per sesi (tanggal + slot sesi).
--
-- Aturan (RENCANA_PERUBAHAN_v9.md Tugas 3):
--   E3  : maksimal 2 kelompok E3 per sesi; TIDAK boleh ada judul lain di sesi
--         yang sama (E3 hanya boleh bersama E3).
--   E9  : maksimal 1 kelompok E9 per sesi; judul lain BOLEH ikut di sesi yang
--         sama (kecuali E3, karena E3 tidak boleh bersama judul lain).
--   Lainnya: tidak ada pembatasan baru, kecuali sesi yang sudah berisi E3
--            tidak boleh ditambah judul non-E3.
--
-- Pengecualian:
--   - Admin boleh melanggar semua aturan (override penuh).
--   - auth.uid() null (service_role / SQL editor / migrate.js) tidak terkena
--     aturan -> seeding & migrasi tetap berjalan.
--   - UPDATE yang tidak mengubah tanggal/sesi/module_id/kelompok -> skip cek.
--   - Data jadwal lama yang kebetulan sudah melanggar TIDAK diubah/dihapus.
--
-- Implementasi: fungsi + trigger TERPISAH dari cek_batas_aslab_jadwal (0009)
-- -> risiko nol ke perilaku trigger lama. Kunci lock SAMA
-- (`pg_advisory_xact_lock(hashtext(NEW.sesi::text || NEW.tanggal::text))`)
-- -> kedua trigger terserialisasi untuk (tanggal, sesi) yang sama, tidak
-- ada race condition antara pengecekan 3-aslab dan pengecekan E3/E9.
--
-- Role dicek via app_current_role() (0001:110-113, SECURITY DEFINER) —
-- mekanisme yang sudah ada, sama yang dipakai RLS & trigger 3-aslab.
-- auth.uid() null pada service_role/SQL editor -> app_current_role() return
-- NULL -> skip pengecekan.

CREATE OR REPLACE FUNCTION public.cek_aturan_e3_e9_jadwal()
RETURNS TRIGGER AS $$
DECLARE
  v_kode       text;
  jml_e3       int;
  jml_e9       int;
  ada_non_e3   boolean;
BEGIN
  -- Skip bila tanggal/sesi kosong: tidak ada slot konkret untuk dibatasi.
  IF NEW.tanggal IS NULL OR NEW.sesi IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pengecualian: admin & service_role (auth.uid() null) -> lewati pengecekan.
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

  -- Kunci lock SAMA dengan cek_batas_aslab_jadwal (0009:41) -> terserialisasi.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.sesi::text || NEW.tanggal::text));

  -- Kode modul yang sedang di-insert/update (E3, E9, atau lainnya).
  SELECT UPPER(BTRIM(m.kode)) INTO v_kode
    FROM public.modules m WHERE m.id = NEW.module_id;

  -- Hitung kelompok E3 berbeda di sesi ini (exclude baris sendiri, id <> NEW.id).
  SELECT COUNT(DISTINCT s.kelompok) INTO jml_e3
    FROM public.schedules s
    WHERE s.tanggal = NEW.tanggal
      AND s.sesi    = NEW.sesi
      AND s.id <> NEW.id
      AND EXISTS (
        SELECT 1 FROM public.modules m2
         WHERE m2.id = s.module_id AND UPPER(BTRIM(m2.kode)) = 'E3'
      );

  -- Hitung kelompok E9 berbeda di sesi ini (exclude baris sendiri).
  SELECT COUNT(DISTINCT s.kelompok) INTO jml_e9
    FROM public.schedules s
    WHERE s.tanggal = NEW.tanggal
      AND s.sesi    = NEW.sesi
      AND s.id <> NEW.id
      AND EXISTS (
        SELECT 1 FROM public.modules m2
         WHERE m2.id = s.module_id AND UPPER(BTRIM(m2.kode)) = 'E9'
      );

  -- Apakah ada judul non-E3 di sesi ini (exclude baris sendiri)?
  SELECT COUNT(*) > 0 INTO ada_non_e3
    FROM public.schedules s
    WHERE s.tanggal = NEW.tanggal
      AND s.sesi    = NEW.sesi
      AND s.id <> NEW.id
      AND EXISTS (
        SELECT 1 FROM public.modules m2
         WHERE m2.id = s.module_id
           AND UPPER(BTRIM(m2.kode)) IS DISTINCT FROM 'E3'
      );

  -- Evaluasi aturan berdasarkan kode modul yang sedang dipilih.
  IF v_kode = 'E3' THEN
    -- E3 tidak boleh bersama judul lain.
    IF ada_non_e3 THEN
      RAISE EXCEPTION 'E3 tidak boleh berada di sesi yang sama dengan judul lain. Sesi ini sudah berisi judul lain.'
        USING ERRCODE = 'P0001';
    END IF;
    -- Maksimal 2 kelompok E3 per sesi.
    IF jml_e3 >= 2 THEN
      RAISE EXCEPTION 'Sesi ini sudah memiliki 2 kelompok E3 (maksimal 2 kelompok per sesi).'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Judul non-E3 tidak boleh masuk sesi yang sudah berisi E3.
    IF jml_e3 >= 1 THEN
      RAISE EXCEPTION 'Sesi ini berisi E3. Judul lain tidak boleh dijadwalkan di sesi yang sama dengan E3.'
        USING ERRCODE = 'P0001';
    END IF;
    -- E9: maksimal 1 kelompok per sesi. Judul non-E3 lain tetap boleh
    -- (selama aturan 3-aslab per slot, 0009, terpenuhi).
    IF v_kode = 'E9' AND jml_e9 >= 1 THEN
      RAISE EXCEPTION 'Sesi ini sudah memiliki 1 kelompok E9 (maksimal 1 kelompok per sesi).'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Idempotent: DROP dulu sebelum CREATE (aman bila dijalankan ulang).
DROP TRIGGER IF EXISTS trg_aturan_e3_e9_jadwal ON public.schedules;

CREATE TRIGGER trg_aturan_e3_e9_jadwal
  BEFORE INSERT OR UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.cek_aturan_e3_e9_jadwal();

-- =============================================================================
-- VERIFIKASI (manual, setelah apply):
--   Sebagai aslab non-admin:
--   1. Sesi kosong: insert E3 kelompok A, E3 kelompok B -> OK. E3 kelompok C
--      -> ditolak ("2 kelompok E3").
--   2. Sesi berisi E3: insert judul non-E3 -> ditolak ("Sesi ini berisi E3").
--      Sesi berisi non-E3: insert E3 -> ditolak ("E3 tidak boleh berada di
--      sesi yang sama dengan judul lain").
--   3. Sesi berisi 1 kelompok E9: insert E9 kelompok kedua -> ditolak ("1
--      kelompok E9"); insert judul non-E3 lain -> OK.
--   4. Aturan 3-aslab per slot (0009) tetap berfungsi.
--   Sebagai admin: semua pelanggaran di atas LOLOS.
-- =============================================================================
