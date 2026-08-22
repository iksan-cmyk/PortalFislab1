-- v_aslab_meta: GRANT SELECT ke authenticated.
-- Bug: view ini tidak di-GRANT di migration 0001, hanya tabel di baliknya
-- (rotasi, modules) yang di-GRANT. PostgreSQL butuh GRANT SELECT eksplisit
-- pada view untuk role yang bukan owner. Akibatnya: 403 saat apiLogin (aslab)
-- & apiGetUsers (admin) query v_aslab_meta.
GRANT SELECT ON public.v_aslab_meta TO authenticated;
