// rename_username.js — One-time script (Fitur 2, RENCANA_PERUBAHAN_v8.md).
// Prompt interaktif untuk mengganti username (sekaligus email sintetis Auth)
// seorang praktikan berdasarkan NRP.
//
// Alur:
//   1. Prompt NRP praktikan -> cari di profiles.nrp. Harus unik & ditemukan.
//   2. Prompt username baru -> validasi format + tidak bentrok.
//   3. Update email Auth ({username_baru}@student.its.ac.id) via
//      sb.auth.admin.updateUserById, lalu update profiles.username.
//      FK grades.username & rotasi.aslab_username sudah ON UPDATE CASCADE
//      (lihat 0013_fk_username_on_update_cascade.sql) -> tidak perlu sentuh
//      tabel anak manual.
//
// TIDAK menyentuh password, tidak mereset must_change_password.
//
// Jalankan dari folder migration/ dengan SUPABASE_SECRET_KEY tersedia:
//   node rename_username.js
// JANGAN taruh SUPABASE_SECRET_KEY di frontend/browser. Hanya lewat env var
// atau migration/.env (sudah di-gitignore).

import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
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

const sb = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });
const EMAIL_DOMAIN = 'student.its.ac.id';

async function prompt(rl, q) {
  const a = await rl.question(q);
  return a.trim();
}

async function main() {
  const rl = createInterface({ input, output });
  try {
    console.log('=== Rename username praktikan ===');
    console.log(`URL: ${SUPABASE_URL}`);
    console.log('');

    // 1) NRP
    const nrp = await prompt(rl, 'NRP praktikan yang usernamenya mau diganti: ');
    if (!nrp) {
      console.error('ERROR: NRP tidak boleh kosong.');
      process.exit(1);
    }

    // cari profile berdasarkan nrp
    const { data: profRows, error: qErr } = await sb
      .from('profiles')
      .select('id, username, name, role, nrp, kelompok')
      .ilike('nrp', nrp);
    if (qErr) {
      console.error('FATAL: gagal query profiles:', qErr.message);
      process.exit(1);
    }
    if (!profRows || profRows.length === 0) {
      console.error(`ERROR: tidak ada praktikan dengan NRP "${nrp}" di database.`);
      process.exit(1);
    }
    if (profRows.length > 1) {
      console.error(`ERROR: NRP "${nrp}" cocok dengan lebih dari satu akun. Persempit pencarian.`);
      profRows.forEach(r => console.error(`  - ${r.username} | ${r.name} | nrp=${r.nrp} | kelompok=${r.kelompok}`));
      process.exit(1);
    }
    const prof = profRows[0];
    console.log(`  Ditemukan: ${prof.username} (${prof.name}, role=${prof.role}, kelompok=${prof.kelompok})`);
    console.log('');

    // 2) username baru
    const newUsernameRaw = await prompt(rl, 'Username baru: ');
    const newUsername = newUsernameRaw.toLowerCase();
    if (!newUsername) {
      console.error('ERROR: username baru tidak boleh kosong.');
      process.exit(1);
    }
    if (newUsername === prof.username) {
      console.error('ERROR: username baru sama dengan username lama. Tidak ada yang diubah.');
      process.exit(1);
    }
    if (!/^[a-z0-9._-]+$/.test(newUsername)) {
      console.error(`ERROR: username "${newUsername}" mengandung karakter tidak valid (hanya huruf kecil/angka/titik/underscore/strip).`);
      process.exit(1);
    }
    // cek bentrok
    const { data: clash, error: clashErr } = await sb
      .from('profiles')
      .select('username')
      .eq('username', newUsername)
      .maybeSingle();
    if (clashErr) {
      console.error('FATAL: gagal cek bentrok username:', clashErr.message);
      process.exit(1);
    }
    if (clash) {
      console.error(`ERROR: username "${newUsername}" sudah dipakai akun lain. Pilih username lain.`);
      process.exit(1);
    }
    // cek juga auth.users email bentrok (safety net)
    const oldEmail = `${prof.username}@${EMAIL_DOMAIN}`;
    const newEmail = `${newUsername}@${EMAIL_DOMAIN}`;
    const { data: authUser, error: authErr } = await sb.auth.admin.getUserById(prof.id);
    if (authErr) {
      console.error(`FATAL: gagal ambil data Auth untuk id=${prof.id}: ${authErr.message}`);
      process.exit(1);
    }
    const currentAuthEmail = authUser && authUser.user && authUser.user.email;
    if (currentAuthEmail && currentAuthEmail.toLowerCase() !== oldEmail.toLowerCase()) {
      console.warn(`  PERINGATAN: email Auth saat ini (${currentAuthEmail}) tidak match pola ${oldEmail}.`);
      console.warn(`  Akan tetap diupdate ke ${newEmail}.`);
    }
    console.log('');
    console.log('Konfirmasi perubahan:');
    console.log(`  NRP        : ${nrp}`);
    console.log(`  Username   : ${prof.username}  ->  ${newUsername}`);
    console.log(`  Email Auth : ${currentAuthEmail || oldEmail}  ->  ${newEmail}`);
    const yakin = (await prompt(rl, 'Lanjutkan? (ketik "ya"): ')).toLowerCase();
    if (yakin !== 'ya') {
      console.log('Dibatalkan. Tidak ada perubahan.');
      return;
    }

    // 3) Update email Auth dulu (kalau gagal, profiles belum disentuh).
    const { error: updAuthErr } = await sb.auth.admin.updateUserById(prof.id, {
      email: newEmail,
      email_confirm: true,
    });
    if (updAuthErr) {
      console.error(`FATAL: gagal update email Auth untuk id=${prof.id}: ${updAuthErr.message}`);
      console.error('       profiles.username BELUM diubah -> tidak ada perubahan.');
      process.exit(1);
    }
    console.log('  Email Auth berhasil diupdate.');

    // 4) Update profiles.username (FK ON UPDATE CASCADE -> grades/rotasi propagasi otomatis).
    const { error: updProfErr } = await sb
      .from('profiles')
      .update({ username: newUsername })
      .eq('id', prof.id);
    if (updProfErr) {
      console.error(`FATAL: email Auth sudah terlanjur diubah ke ${newEmail}, tapi update profiles.username gagal: ${updProfErr.message}`);
      console.error(`       KONDISI TIDAK KONSISTEN. Login pakai username baru, tapi profiles masih ${prof.username}.`);
      console.error('       Perbaiki manual: update profiles set username = ... atau kembalikan email Auth.');
      process.exit(1);
    }
    console.log('  profiles.username berhasil diupdate (FK grades/rotasi ter-cascade).');

    console.log('');
    console.log('=== SELESAI ===');
    console.log(`  NRP        : ${nrp}`);
    console.log(`  Username   : ${prof.username}  ->  ${newUsername}`);
    console.log(`  Email Auth : ${currentAuthEmail || oldEmail}  ->  ${newEmail}`);
    console.log('  Password & must_change_password TIDAK diubah.');
  } finally {
    rl.close();
  }
}

main().catch(e => { console.error('FATAL (tidak terduga):', e); process.exit(1); });