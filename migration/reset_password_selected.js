// reset_password_selected.js — One-time script.
// Reset password akun TERTENTU (dipilih via argumen CLI) menjadi password = username,
// dan set must_change_password = true lagi supaya dipaksa ganti saat login berikutnya.
// Berbeda dari reset_password_praktikan.js yang mereset SEMUA praktikan sekaligus —
// script ini untuk kasus per-akun (misal lupa password, atau salah input password awal).
//
// Jalankan manual dari folder migration/ dengan SUPABASE_SECRET_KEY tersedia:
//   cd migration && node reset_password_selected.js <username1> <username2> ...
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

const targetUsernames = process.argv.slice(2).map(u => u.trim()).filter(Boolean);
if (targetUsernames.length === 0) {
  console.error('ERROR: sebutkan minimal satu username.');
  console.error('Contoh: node reset_password_selected.js 5001251036 5001251099');
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
  console.log('=== Reset password akun terpilih ===');
  console.log(`URL: ${SUPABASE_URL}`);
  console.log(`Target (${targetUsernames.length}): ${targetUsernames.join(', ')}`);

  const { data: rows, error } = await sb
    .from('profiles')
    .select('id, username, name, role')
    .in('username', targetUsernames);
  if (error) {
    console.error('FATAL: gagal query profiles:', error.message);
    process.exit(1);
  }

  const found = new Map(rows.map(r => [r.username, r]));
  const notFound = targetUsernames.filter(u => !found.has(u));
  if (notFound.length > 0) {
    console.warn(`  PERINGATAN: username tidak ditemukan di profiles: ${notFound.join(', ')}`);
  }
  if (rows.length === 0) {
    console.log('  Tidak ada akun yang cocok. Tidak ada yang direset.');
    return;
  }

  console.log(`  ${rows.length} akun akan direset passwordnya ke username masing-masing.`);

  let ok = 0, gagal = 0;
  for (const r of rows) {
    const { error: e1 } = await sb.auth.admin.updateUserById(r.id, { password: r.username });
    if (e1) {
      console.warn(`  GAGAL reset auth ${r.username} (${r.name || '?'}, ${r.role}): ${e1.message}`);
      gagal++;
      await sleep(200);
      continue;
    }
    const { error: e2 } = await sb
      .from('profiles')
      .update({ must_change_password: true })
      .eq('id', r.id);
    if (e2) {
      console.warn(`  Password direset tapi GAGAL set must_change_password ${r.username}: ${e2.message}`);
      gagal++;
    } else {
      console.log(`  reset OK: ${r.username} (${r.name || '?'}, ${r.role})`);
      ok++;
    }
    await sleep(200); // jeda hindari rate limit
  }

  console.log(`\n=== SELESAI: ${ok} OK, ${gagal} gagal, ${notFound.length} tidak ditemukan ===`);
  if (gagal > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
