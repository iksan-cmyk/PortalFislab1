-- Batasan upload foto profil di level Storage (server-side, bukan cuma client).
-- Memenuhi item #6 checklist: restrict file uploads — validasi tipe & ukuran
-- di server juga, jangan cuma di client.
--
-- Kolom pada storage.buckets:
--   allowed_mime_types  text[]   -- daftar MIME yang diizinkan, NULL = semua
--   file_size_limit     bigint   -- batas byte per file, NULL = tanpa batas
-- 2MB = 2 * 1024 * 1024 = 2097152 byte.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ],
    file_size_limit = 2097152
WHERE id = 'avatars';
