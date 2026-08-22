// fix-orphan-user.js — skrip sekali-jalan untuk perbaiki akun orphan
// 5001251036 (Auth user dibuat tapi HTTP timeout di run pertama migrate.js,
// sehingga password sementara tidak tercatat di temp_passwords.csv).
//
// Lakukan:
//   1. Generate password sementara baru (pola sama seperti migrate.js).
//   2. auth.admin.updateUserById(<uid>, { password }) — pakai SUPABASE_SECRET_KEY dari .env lokal.
//   3. UPDATE profiles SET must_change_password = true WHERE username = '5001251036'.
//   4. Append satu baris ke temp_passwords.csv (format sama).
//   5. Print password barunya ke terminal SEKALI setelah selesai.
//
// Jalankan: cd migration && node fix-orphan-user.js
// Tidak meminta secret key — membaca dari .env yang sudah ada.

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const MIGRATION_DIR = import.meta.dirname;
const TEMP_PW_PATH   = `${MIGRATION_DIR}/temp_passwords.csv`;
const ORPHAN_UID     = 'a6ce1d5a-54d5-4467-b466-9009306fb125';
const ORPHAN_USERNAME = '5001251036';

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

const env = loadEnv();
const SUPABASE_URL    = process.env.SUPABASE_URL    || env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET) {
  console.error('ERROR: SUPABASE_URL atau SUPABASE_SECRET_KEY tidak ditemukan di .env.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { persistSession: false } });

function genPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  const buf = randomBytes(len);
  for (let i = 0; i < len; i++) pw += chars[buf[i] % chars.length];
  return pw;
}

async function main() {
  // ambil name dari profiles untuk dirimu di temp_passwords.csv
  const { data: prof, error: pe } = await sb.from('profiles')
    .select('username,name').eq('username', ORPHAN_USERNAME).single();
  if (pe || !prof) {
    console.error(`ERROR: profile ${ORPHAN_USERNAME} tidak ditemukan: ${pe ? pe.message : 'no row'}`);
    process.exit(1);
  }
  const name = prof.name || ORPHAN_USERNAME;

  // 1. generate password sementara baru
  const tempPw = genPassword();

  // 2. update password di Auth
  const { error: ue } = await sb.auth.admin.updateUserById(ORPHAN_UID, { password: tempPw });
  if (ue) {
    console.error(`ERROR: gagal update password Auth untuk uid=${ORPHAN_UID}: ${ue.message}`);
    process.exit(1);
  }

  // 3. tandai must_change_password
  const { error: me } = await sb.from('profiles')
    .update({ must_change_password: true }).eq('username', ORPHAN_USERNAME);
  if (me) {
    console.error(`ERROR: gagal update must_change_password: ${me.message}`);
    process.exit(1);
  }

  // 4. append ke temp_passwords.csv (format: username,name,temp_password; name di-quote JSON)
  const header = existsSync(TEMP_PW_PATH) ? '' : 'username,name,temp_password\n';
  const line = `${ORPHAN_USERNAME},${JSON.stringify(name)},${tempPw}\n`;
  appendFileSync(TEMP_PW_PATH, header + line);

  // 5. print password SEKALI ke terminal
  console.log('=== SELESAI ===');
  console.log(`username : ${ORPHAN_USERNAME}`);
  console.log(`name     : ${name}`);
  console.log(`uid      : ${ORPHAN_UID}`);
  console.log(`password : ${tempPw}`);
  console.log('Catat password ini manual kalau perlu. Akun wajib ganti password saat login pertama.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
