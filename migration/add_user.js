// add_user.js — Tambah SATU user baru, TANPA menyentuh akun lain.
//
// Beda dari migrate.js (bulk dari CSV, bisa update akun lama) dan
// reset_password_selected.js (reset password akun yang SUDAH ADA):
// script ini HANYA membuat akun baru. Kalau username yang diminta ternyata
// sudah ada, script berhenti total SEBELUM menyentuh database sama sekali —
// tidak ada update, tidak ada reset password, tidak ada apa pun. Jadi aman
// dijalankan kapan saja tanpa risiko mengubah data user aktif lain.
//
// Taruh file ini di folder migration/ (satu level dengan migrate.js), lalu
// jalankan dari sana dengan SUPABASE_SECRET_KEY tersedia (via migration/.env
// atau env var langsung):
//
//   cd migration
//   node add_user.js --username=5001251036 --name="Budi Santoso" --role=praktikan --nrp=5001251036 --kelompok=3 --wa=628123456789
//
// Flag yang didukung:
//   --username   (wajib)    login username -> jadi local-part email
//                            {username}@student.its.ac.id
//   --name       (wajib)    nama lengkap
//   --role       (opsional) praktikan | aslab | admin  (default: praktikan)
//   --nrp        (opsional)
//   --kelompok   (opsional) integer
//   --wa         (opsional) nomor WhatsApp
//   --password   (opsional) default: sama dengan username (konsisten dengan
//                            konvensi akun awal di proyek ini)
//
// User baru otomatis must_change_password = true, jadi dipaksa ganti
// password sendiri saat login pertama kali.
//
// JANGAN taruh SUPABASE_SECRET_KEY di frontend/browser. Hanya lewat env var
// atau migration/.env (yang sudah di-gitignore).

import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const MIGRATION_DIR = import.meta.dirname.replace(/[\\/]$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || loadEnv().SUPABASE_URL;
const SECRET_KEY   = process.env.SUPABASE_SECRET_KEY || loadEnv().SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  console.error('ERROR: SUPABASE_URL atau SUPABASE_SECRET_KEY tidak ditemukan. Isi .env di folder migration/.');
  process.exit(1);
}

function loadEnv() {
  const envPath = `${MIGRATION_DIR}/.env`;
  if (!existsSync(envPath)) return {};
  const txt = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

// --- parser flag sederhana: --key=value ATAU --key value ---
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = true; }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const username = (typeof args.username === 'string' ? args.username : '').trim().toLowerCase();
const name = (typeof args.name === 'string' ? args.name : '').trim();
const role = (typeof args.role === 'string' ? args.role : 'praktikan').trim().toLowerCase();
const nrp = typeof args.nrp === 'string' ? args.nrp.trim() : null;
const kelompok = typeof args.kelompok === 'string' ? (parseInt(args.kelompok, 10) || null) : null;
const wa = typeof args.wa === 'string' ? args.wa.trim() : null;
const password = typeof args.password === 'string' ? args.password : username;

// --- validasi input dulu, gagal cepat SEBELUM menyentuh database sama sekali ---
if (!username) {
  console.error('ERROR: --username wajib diisi.');
  console.error('Contoh: node add_user.js --username=5001251036 --name="Budi Santoso" --role=praktikan');
  process.exit(1);
}
if (!/^[a-z0-9._-]+$/.test(username)) {
  console.error(`ERROR: username "${username}" mengandung karakter tidak valid untuk local-part email (hanya huruf/angka/titik/underscore/strip).`);
  process.exit(1);
}
if (!name) {
  console.error('ERROR: --name wajib diisi.');
  process.exit(1);
}
if (!['praktikan', 'aslab', 'admin'].includes(role)) {
  console.error(`ERROR: --role "${role}" tidak dikenal. Harus salah satu: praktikan | aslab | admin.`);
  process.exit(1);
}
if (args.kelompok !== undefined && kelompok === null) {
  console.error(`ERROR: --kelompok "${args.kelompok}" bukan angka valid.`);
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

async function main() {
  console.log('=== Tambah user baru (single, tidak menyentuh akun lain) ===');
  console.log(`URL     : ${SUPABASE_URL}`);
  console.log(`username: ${username}`);
  console.log(`name    : ${name}`);
  console.log(`role    : ${role}`);
  console.log(`nrp     : ${nrp ?? '-'}`);
  console.log(`kelompok: ${kelompok ?? '-'}`);
  console.log(`wa      : ${wa ?? '-'}`);
  console.log('');

  // 1) PENGECEKAN WAJIB PALING AWAL: kalau username sudah ada di profiles,
  //    STOP total di sini. Tidak ada update, tidak ada reset password,
  //    tidak ada apa pun -- ini yang menjamin akun aktif lain tidak pernah
  //    tersentuh oleh script ini.
  const { data: existingProfile, error: checkErr } = await sb
    .from('profiles')
    .select('id, username, name, role')
    .eq('username', username)
    .maybeSingle();
  if (checkErr) {
    console.error('FATAL: gagal cek username di profiles, dibatalkan:', checkErr.message);
    process.exit(1);
  }
  if (existingProfile) {
    console.error(`ERROR: username "${username}" SUDAH ADA (${existingProfile.name}, role=${existingProfile.role}, id=${existingProfile.id}).`);
    console.error('       Dibatalkan -- TIDAK ADA perubahan apa pun yang dilakukan ke akun ini.');
    console.error('       Kalau mau reset password akun ini, pakai reset_password_selected.js. Kalau mau ubah data profil, update manual lewat halaman admin/Supabase.');
    process.exit(1);
  }

  const email = `${username}@student.its.ac.id`;

  // 2) Buat akun Auth baru. Kalau ternyata email ini sudah dipakai di
  //    auth.users (kasus langka: baris profiles hilang tapi auth user masih
  //    ada), createUser akan gagal dan kita berhenti tanpa efek samping apa pun.
  const { data: authData, error: createErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) {
    console.error(`FATAL: gagal buat akun Auth untuk ${email}: ${createErr.message}`);
    console.error('       Tidak ada perubahan yang tersimpan.');
    process.exit(1);
  }

  const uid = authData.user.id;
  console.log(`  Auth user dibuat: ${email} (id=${uid})`);

  // 3) Trigger on_auth_user_created (handle_new_user) otomatis insert baris
  //    profiles default (username, name=username, role='praktikan'). Di sini
  //    kita lengkapi ke data yang diminta -- update HANYA baris ini
  //    (.eq('id', uid)), tidak pernah menyentuh baris user lain mana pun.
  const profRec = { username, name, role, nrp, kelompok, wa, must_change_password: true };
  const { error: updErr } = await sb.from('profiles').update(profRec).eq('id', uid);
  if (updErr) {
    console.error(`FATAL: Auth user sudah terlanjur dibuat (id=${uid}) tapi update profil gagal: ${updErr.message}`);
    console.error(`       Cek manual akun ${email} di Supabase Auth dashboard (mungkin perlu dihapus & diulang).`);
    process.exit(1);
  }

  console.log('');
  console.log(`=== SELESAI: user "${username}" (${role}) berhasil dibuat. ===`);
  console.log(`  Login  : username="${username}", password="${password}"`);
  console.log('  must_change_password = true -> dipaksa ganti password sendiri saat login pertama.');
  console.log('  Tidak ada akun lain yang tersentuh oleh script ini.');
}

main().catch(e => {
  console.error('FATAL (tidak terduga):', e);
  process.exit(1);
});
