# PortalFislab1

Portal manajemen praktikum fisika laboratorium untuk 3 role:
- **praktikan** (mahasiswa) — modul, jadwal per kelompok, nilai, kontak aslab
- **aslab** (asisten lab) — atur jadwal & input nilai modul yang dipegang
- **admin** — rekap nilai semua praktikan, kelola daftar pengguna

Frontend statis (`index.html` + `script.js` + `style.css`) memanggil
[Supabase](https://supabase.com) langsung lewat `@supabase/supabase-js`,
diamankan sepenuhnya lewat Row Level Security (RLS) Postgres.

## Stack

- **Backend + DB + Auth + Storage:** Supabase (free tier) — Postgres, Auth,
  RLS, Storage bucket `avatars`.
- **Frontend hosting:** Vercel (free tier) — static site apa adanya.
- **Login:** username → email sintetis `{username}@portalfislab.local`,
  password di-hash & di-rate-limit bawaan Supabase Auth.

Tidak ada server Node/Express terpisah. Logika yang wajib server-side
(contoh: hitung ulang `nilai_akhir`) pakai trigger/function Postgres.

## Struktur folder

```
/                     — frontend statis (index.html, script.js, style.css)
/supabase/migrations/ — SQL migration (schema + RLS policy + trigger)
/supabase/functions/  — Edge Function (kalau ada logic server-side)
/migration/           — CSV ekspor Google Sheets + skrip migrasi satu-kali
vercel.json           — header keamanan & routing
.env.example          — variabel lingkungan (TANPA nilai asli)
AGENTS.md             — konteks permanen untuk agent (baca sebelum ubah apa pun)
```

## Setup

### Frontend

Anon (publishable) key Supabase tertanam langsung di `index.html` (aman
selama RLS benar — anon key memang didesain terekspos). Deploy folder root
ke Vercel; tidak perlu build step. Header keamanan dasar sudah diatur di
`vercel.json` (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).

### Migrasi data (CSV -> Supabase)

Skrip `migration/migrate.js` membaca CSV ekspor Google Sheets dan upsert ke
Supabase. Idempotent — aman dijalankan ulang saat CSV diperbarui.

```bash
cd migration
cp .env.example .env          # isi SUPABASE_SECRET_KEY (service_role, JANGAN di-commit)
npm install
node migrate.js
```

**Catatan password:** `migrate.js` membaca kolom `password` dari
`Database Fislab - users.csv` untuk SEMUA role. Akun baru dibuat dengan
password itu; akun yang sudah ada di-reset passwordnya via
`auth.admin.updateUserById`. Semua akun dipaksa `must_change_password = true`
di sesi pertama. Password dikirim apa adanya — Supabase Auth yang hash
otomatis di server.

## Skema nilai v3

Total bobot 100%. Plagiasi **bukan** komponen berbobot — pengurang langsung
dari nilai akhir (floor 0). `nilai_akhir` dihitung ulang server-side lewat
trigger `recompute_nilai_akhir` (lihat `supabase/migrations/0006_skema_nilai_v3.sql`);
nilai yang dikirim client diabaikan.

| Komponen | Key DB | Bobot |
|---|---|---|
| Pre-Lab | `prelab` | 10% |
| In-Lab Pengambilan Data | `inlab_pengambilan_data` | 15% |
| In-Lab Diskusi | `inlab_diskusi` | 10% |
| In-Lab Kerapian | `inlab_kerapian` | 5% |
| Laporan Abstrak | `abstrak` | 5% |
| Laporan Pendahuluan | `pendahuluan` | 5% |
| Laporan Metodologi | `metodologi` | 5% |
| Laporan Analisis Data | `analisis_data` | 5% |
| Laporan Analisis Perhitungan & Grafik | `analisis_perhitungan_grafik` | 10% |
| Laporan Pembahasan | `pembahasan` | 20% |
| Laporan Kesimpulan | `kesimpulan` | 5% |
| Laporan Formating | `format` | 5% |
| Plagiasi | `plagiasi` | pengurang langsung |

Setiap komponen punya pasangan kolom catatan `cat_<key>` (mis.
`cat_inlab_pengambilan_data`); di frontend camelCase (mis.
`catInlabPengambilanData`). Daftar otoritatif: array `KOMP` di `script.js`,
`KOMP_KEYS`/`CAT_MAP` di `migration/migrate.js`, trigger
`recompute_nilai_akhir` di `0006_skema_nilai_v3.sql`. Ketiganya wajib sinkron.

## Keamanan

Ringkasan singkat — detail lengkap dan justifikasi ada di
[`AGENTS.md`](AGENTS.md) (baca dulu sebelum mengubah apa pun).

- RLS aktif di semua tabel; otorisasi lewat `auth.uid()` + `app_current_role()`,
  bukan sekadar cek role di frontend.
- `service_role` key (`SUPABASE_SECRET_KEY`) **hanya** di `migration/.env`
  (tidak di-commit) — tidak boleh ada di frontend.
- Anon/publishable key memang terekspos di `index.html` (aman selama RLS benar).
- `nilai_akhir` dihitung server-side — nilai client diabaikan (anti-tampering).
- `password`/`password_hash` tidak pernah dikembalikan di response mana pun
  (select kolom eksplisit, bukan `select *`).
- Escape HTML di semua tempat yang merender teks input pengguna (helper `esc`).
- Upload foto profil dibatasi tipe (`image/*`) & ukuran (maks 2MB), disimpan
  di Storage bucket `avatars` (bukan base64 di DB).
