// reset_password_praktikan.js — One-time script.
// Reset password SEMUA akun praktikan yang masih must_change_password=true
// menjadi password = username. Berlaku HANYA untuk role 'praktikan'.
//
// Jalankan manual dari folder migration/ dengan SUPABASE_SECRET_KEY tersedia:
//   cd migration && node reset_password_praktikan.js
// JANGAN taruh SUPABASE_SECRET_KEY di frontend/browser. Hanya lewat env var.

import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const MIGRATION_DIR = import.meta.dirname.replace(/[\\/]$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || loadEnv().SUPABASE_URL;
const SECRET_KEY   = process.env.SUPABASE_SECRET_KEY || loadEnv().SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  console.error('ERROR: SUPABASE_URL atau SUPABASE_SECRET_KEY tidak ditemukan. Isi .env di folder migration/.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('=== Reset password praktikan (must_change_password=true) ===');
  console.log(`URL: ${SUPABASE_URL}`);

  const { data: rows, error } = await sb
    .from('profiles')
    .select('id, username, name')
    .eq('role', 'praktikan')
    .eq('must_change_password', true);
  if (error) {
    console.error('FATAL: gagal query profiles:', error.message);
    process.exit(1);
  }

  if (!rows.length) {
    console.log('  Tidak ada praktikan dengan must_change_password=true. Tidak ada yang direset.');
    return;
  }

  console.log(`  ${rows.length} akun praktikan akan direset passwordnya ke username.`);

  let ok = 0, gagal = 0;
  for (const r of rows) {
    const { error: e2 } = await sb.auth.admin.updateUserById(r.id, { password: r.username });
    if (e2) {
      console.warn(`  GAGAL reset ${r.username} (${r.name || '?'}): ${e2.message}`);
      gagal++;
    } else {
      console.log(`  reset OK: ${r.username} (${r.name || '?'})`);
      ok++;
    }
    await sleep(200); // jeda hindari rate limit
  }

  console.log(`\n=== SELESAI: ${ok} OK, ${gagal} gagal ===`);
  if (gagal > 0) {
    console.log('Akun yang gagal perlu direset ulang manual di Dashboard Supabase.');
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });