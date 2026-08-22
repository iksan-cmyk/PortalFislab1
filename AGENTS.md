# AGENTS.md — PortalFislab1

Konteks permanen untuk agent (OpenCode). Baca file ini sebelum mengubah apa pun.
Update file ini setiap kali kamu (agent) mempelajari sesuatu yang salah paham
tentang proyek ini, lalu commit perubahannya.

## Apa proyek ini

Portal manajemen praktikum fisika lab untuk 3 role pengguna:
- **praktikan** (mahasiswa) — lihat modul, jadwal per kelompok, nilai, kontak aslab
- **aslab** (asisten lab) — atur jadwal & input nilai untuk modul yang dipegang
- **admin** — rekap nilai semua praktikan, kelola daftar pengguna

Kondisi saat ini: frontend statis (`index.html`, `script.js`, `style.css`) yang
memanggil satu endpoint Google Apps Script (`API_URL` di `index.html`) sebagai
backend, dengan Google Sheets sebagai "database". **Tugas kita: ganti backend
ini dengan backend nyata, migrasi semua data, dan deploy — TANPA mengubah
UI/UX/desain visual yang sudah ada.**

## Keputusan stack (jangan diubah tanpa alasan kuat)

- **Backend + DB + Auth: Supabase** (free tier) — Postgres, Auth, Row Level
  Security, Storage. Dipilih karena RLS bawaan Postgres langsung memenuhi
  sebagian besar item keamanan di bawah tanpa kode server custom.
- **Frontend hosting: Vercel** (free tier) — deploy static site apa adanya.
- **Tidak perlu server Node/Express terpisah.** Frontend memanggil Supabase
  langsung lewat `@supabase/supabase-js`, diamankan sepenuhnya lewat RLS
  policy di database. Pakai Supabase Edge Function HANYA untuk logika yang
  memang wajib server-side (contoh: hitung ulang `nilai_akhir` biar tidak
  dipercaya begitu saja dari client).
- **Auth:** Supabase Auth pakai email+password secara native. Karena app ini
  login pakai username, map `username` → email sintetis
  `{username}@portalfislab.local` saat sign up/sign in. Ini membuat kita
  dapat gratis: hashing password, rate-limit login, session token aman —
  semua bawaan Supabase Auth, tidak perlu implementasi manual.

## Kontrak API yang wajib tetap kompatibel secara fungsi

Frontend saat ini punya satu fungsi `api(action, body)` yang memanggil 9 action:
`login, getModules, getUsers, getGrades, getSchedules, getRotasi, setSchedule,
setGrade, updateProfile`. Perilaku tiap action (siapa boleh baca/tulis apa)
harus tetap sama seperti sekarang — lihat `script.js` untuk siapa memanggil
apa dan kapan. Boleh mengganti *cara* action ini dipenuhi (langsung
supabase-js query + RLS, bukan satu endpoint REST), tapi hasil akhirnya harus
sama dari sudut pandang UI.

## Migrasi data

Sumber data lama ada di Google Sheets, TIDAK bisa diakses otomatis oleh agent.
Minta user mengekspor tiap sheet/tab jadi CSV dan taruh di folder
`/migration/`. Untuk password: kemungkinan besar password lama tidak
ter-hash (plaintext di sheet) — JANGAN migrasikan plaintext password ke
kolom hash tanpa hashing. Kalau tidak yakin passwordnya asli plaintext atau
tidak, opsi paling aman: generate password sementara acak per user saat
migrasi, hasilkan daftar yang bisa dibagikan admin ke tiap orang untuk
login pertama kali, lalu paksa ganti password di sesi pertama.

## Checklist keamanan — bare minimum (bukan semua item dikerjakan sama beratnya)

Prioritas: yang gratis/otomatis dari stack di atas, plus perbaikan konkret
untuk kerentanan yang sudah ada di kode sekarang.

**Otomatis didapat dari Supabase Auth + RLS + supabase-js (verifikasi saja, jangan bangun ulang manual):**
hash password, rate limit login, secure session (token dikelola SDK, bukan
manual di localStorage), force HTTPS, parameterized queries, use public DB
key (anon key memang didesain untuk terekspos, aman selama RLS benar).

**Wajib dikerjakan eksplisit (ini yang jadi kerja nyata agent):**
1. **Enable row-level security + lock record access + block field tampering** —
   RLS policy per tabel per role. Contoh: praktikan hanya boleh SELECT baris
   `grades` miliknya sendiri; aslab hanya boleh UPDATE `grades`/`schedules`
   untuk modul yang ia pegang (cek lewat tabel `rotasi`); `nilai_akhir`
   dihitung ulang di server (trigger/function), jangan percaya nilai yang
   dikirim client.
2. **Enforce server-side auth** — semua otorisasi lewat RLS + `auth.uid()`,
   bukan sekadar cek `ses.role` di JavaScript frontend (itu cuma UX, bukan
   keamanan).
3. **Hide API keys / purge git secrets** — `service_role` key TIDAK BOLEH ada
   di frontend atau ter-commit di git, hanya dipakai di Edge Function
   secrets. Cek juga tidak ada key/URL lama yang sensitif tertinggal di
   riwayat git sebelum push publik.
4. **Validate all input** — constraint di DB (nilai komponen 0–100, field
   wajib not null) + validasi dasar di form sebelum submit.
5. **Escape user content** — kode sekarang banyak pakai `innerHTML` dengan
   template literal langsung (nama, catatan penilaian, pesan WA). Ini celah
   XSS nyata. Buat satu helper `escapeHtml()` dan pakai di semua tempat yang
   merender teks yang berasal dari input pengguna (nama, catatan, dsb).
6. **Restrict file uploads** — foto profil: validasi tipe (`image/*`) & ukuran
   (maks 2MB) di CLIENT **dan** server/Edge Function, jangan cuma client.
   Pindahkan foto dari base64-in-database ke Supabase Storage bucket dengan
   policy akses yang jelas.
7. **Trim API responses** — jangan pernah kembalikan `password`/`password_hash`
   di response mana pun; select kolom eksplisit, bukan `select *`.
8. **Add security headers** — set lewat `vercel.json`: minimal
   `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
   `Referrer-Policy: strict-origin-when-cross-origin`.

**Sengaja DILEWATI untuk bare minimum:** enkripsi custom di level aplikasi
untuk data selain password (grades/jadwal bukan data rahasia tingkat tinggi,
dan Supabase sudah enkripsi at-rest di level infrastruktur — cukup).

## Struktur repo target

```
/                     — frontend statis (index.html, script.js, style.css) — tetap
/supabase/migrations/ — SQL migration (schema + RLS policy)
/supabase/functions/  — Edge Function (kalau ada logic server-side)
/migration/           — CSV ekspor dari Google Sheets + skrip migrasi satu-kali
vercel.json           — konfigurasi header keamanan & routing
.env.example          — nama variabel yang dibutuhkan (TANPA nilai asli)
```

## Konvensi

- UI tetap berbahasa Indonesia, jangan diterjemahkan.
- Jangan ubah `style.css` atau struktur visual `index.html` kecuali memang
  perlu untuk fungsi (misal ganti cara render foto profil).
- Commit kecil dan sering, pesan commit jelas per langkah.
- Sebelum perubahan besar (skema DB, ganti seluruh layer networking), masuk
  Plan mode dulu dan tunjukkan rencananya.
- Jangan hardcode key/URL sensitif di kode — selalu lewat environment
  variable.
