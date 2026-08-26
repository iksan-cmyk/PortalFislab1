// migrate.js — Skrip migrasi CSV (ekspor Google Sheets) -> Supabase.
// Idempotent: aman dijalankan ulang saat CSV diperbarui.
//   - Username baru (belum ada di profiles) -> buat akun Auth + password sementara
//   - Username yang sudah ada -> update field profil (name/role/nrp/kelompok/wa) saja,
//     tidak buat ulang akun Auth, tidak generate password baru
//   - temp_passwords.csv: APPEND antar-run (jangan overwrite)
//
// Jalankan: cd migration && npm install && node migrate.js
// Butuh file .env berisi SUPABASE_URL dan SUPABASE_SECRET_KEY.

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse';

const MIGRATION_DIR = import.meta.dirname.replace(/[\\/]$/, '');
const TEMP_PW_PATH = `${MIGRATION_DIR}/temp_passwords.csv`;
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

function readCSV(file) {
  const path = `${MIGRATION_DIR}/${file}`;
  if (!existsSync(path)) { console.warn(`  WARNING: ${file} tidak ditemukan, skip.`); return []; }
  return new Promise((resolve, reject) => {
    const data = readFileSync(path, 'utf8');
    parse(data, { columns: true, trim: true, skip_empty_lines: true }, (err, rs) => {
      if (err) reject(err); else resolve(rs);
    });
  });
}

function genPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pw = '';
  const buf = randomBytes(len);
  for (let i = 0; i < len; i++) pw += chars[buf[i] % chars.length];
  return pw;
}

function appendTempPw(username, name, pw) {
  const header = existsSync(TEMP_PW_PATH) ? '' : 'username,name,temp_password\n';
  const line = `${username},${JSON.stringify(name)},${pw}\n`;
  appendFileSync(TEMP_PW_PATH, header + line);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// retry dengan exponential backoff untuk createUser (menghindari rate limit / fetch failed)
async function createUserWithRetry(payload, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = await sb.auth.admin.createUser(payload);
    if (!error) return { data };
    if (attempt < maxRetries && (error.message.includes('fetch failed') || error.message.includes('rate') || error.message.includes('timeout'))) {
      const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
      console.warn(`    retry ${attempt + 1}/${maxRetries} setelah ${delay}ms... (${error.message})`);
      await sleep(delay);
      continue;
    }
    return { error };
  }
}

async function getExistingUsernames() {
  const { data, error } = await sb.from('profiles').select('username');
  if (error) throw error;
  return new Set(data.map(r => r.username));
}

async function migrateModules() {
  console.log('\n=== modules ===');
  const rows = await readCSV('Database Fislab - modules.csv');
  let upserted = 0;
  for (const r of rows) {
    if (!r.id) { console.warn(`  WARNING: baris tanpa id, skip: ${JSON.stringify(r)}`); continue; }
    const rec = {
      id: String(r.id).trim(),
      kode: r.kode || null,
      judul: r.judul || null,
      ringkas: r.ringkas || null,
      file_url: r.fileUrl || null,
      file_type: r.fileType || null,
    };
    const { error } = await sb.from('modules').upsert(rec, { onConflict: 'id' }).select('id').single();
    if (error) { console.warn(`  WARNING: gagal upsert module id=${r.id}: ${error.message}`); }
    else { upserted++; }
  }
  console.log(`  ${upserted}/${rows.length} modules upserted.`);
}

async function migrateUsers() {
  console.log('\n=== users (auth + profiles) ===');
  const rows = await readCSV('Database Fislab - users.csv');
  const existing = await getExistingUsernames();
  let created = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    const username = (r.username || '').trim().toLowerCase();
    if (!username) {
      console.warn(`  WARNING: baris tanpa username, skip: ${JSON.stringify(r.name || r)}`);
      skipped++;
      continue;
    }
    const name = (r.name || username).trim();
    const role = (r.role || 'praktikan').trim().toLowerCase();
    if (!['praktikan','aslab','admin'].includes(role)) {
      console.warn(`  WARNING: role tidak dikenal "${role}" untuk username=${username}, skip.`);
      skipped++; continue;
    }
    const profRec = {
      username,
      name,
      role,
      nrp: r.nrp ? r.nrp.trim() : null,
      kelompok: r.kelompok ? parseInt(r.kelompok, 10) || null : null,
      wa: r.wa ? r.wa.trim() : null,
    };
    if (!existing.has(username)) {
      // AKUN BARU: buat Auth user + password sementara (dengan retry + jeda)
      // Praktikan: password awal = username (dipaksa ganti di login pertama).
      // aslab/admin: password random aman, dicatat di temp_passwords.csv.
      const tempPw = (role === 'praktikan') ? username : genPassword();
      const email = `${username}@portalfislab.local`;
      const result = await createUserWithRetry({
        email,
        password: tempPw,
        email_confirm: true,
      });
      if (result.error) {
        console.warn(`  WARNING: gagal buat akun Auth username=${username}: ${result.error.message}`);
        skipped++; continue;
      }
      const au = result.data;
      await sleep(200); // jeda antar createUser untuk hindari rate limit
      // trigger handle_new_user sudah insert profile default; update dengan data CSV
      const { error: pe } = await sb.from('profiles').update(profRec).eq('id', au.user.id);
      if (pe) {
        console.warn(`  WARNING: Auth user dibuat tapi update profile gagal username=${username}: ${pe.message}`);
      }
      // tandai must_change_password
      await sb.from('profiles').update({ must_change_password: true }).eq('id', au.user.id);
      appendTempPw(username, name, tempPw);
      existing.add(username);
      created++;
      console.log(`  + NEW ${username} (${role}) -> temp password dicatat`);
    } else {
      // AKUN LAMA: update profil saja (termasuk role — poin #2)
      const { error: pe } = await sb.from('profiles').update(profRec).eq('username', username);
      if (pe) {
        console.warn(`  WARNING: gagal update profile username=${username}: ${pe.message}`);
        skipped++; continue;
      }
      updated++;
      console.log(`  ~ UPD ${username} (${role})`);
    }
  }
  console.log(`  ${created} baru, ${updated} update, ${skipped} skip.`);
}

function buildNameToUsername(profiles) {
  const m = new Map();
  for (const p of profiles) {
    if (p.name) m.set(p.name.trim().toLowerCase(), p.username);
  }
  return m;
}

async function migrateRotasi() {
  console.log('\n=== rotasi ===');
  const rows = await readCSV('Database Fislab - rotasi.csv');
  // ambil semua aslab profile untuk map name -> username
  const { data: aslabs, error: ae } = await sb.from('profiles')
    .select('username,name').eq('role','aslab');
  if (ae) throw ae;
  const nameMap = buildNameToUsername(aslabs);
  let upserted = 0, skipped = 0;
  for (const r of rows) {
    const moduleId = (r.id || '').trim();
    const kelompok = parseInt(r.kelompok, 10);
    if (!moduleId || isNaN(kelompok)) {
      console.warn(`  WARNING: baris rotasi tidak valid, skip: ${JSON.stringify(r)}`);
      skipped++; continue;
    }
    let aslabUsername = null;
    const aslabName = (r.aslab || '').trim();
    if (aslabName) {
      aslabUsername = nameMap.get(aslabName.toLowerCase());
      if (!aslabUsername) {
        console.warn(`  WARNING: nama aslab "${aslabName}" tidak ketemu di profiles, skip baris rotasi (module=${moduleId}, kelompok=${kelompok}).`);
        skipped++;
        continue;
      }
    }
    const rec = {
      module_id: moduleId,
      kelompok,
      minggu: parseInt(r.minggu, 10) || null,
      aslab_username: aslabUsername,
    };
    const { error } = await sb.from('rotasi').upsert(rec, { onConflict: 'module_id,kelompok' });
    if (error) {
      console.warn(`  WARNING: gagal upsert rotasi module=${moduleId} kelompok=${kelompok}: ${error.message}`);
      skipped++; continue;
    }
    upserted++;
  }
  console.log(`  ${upserted}/${rows.length} rotasi upserted, ${skipped} skip.`);
}

function buildTitleToId(modules) {
  const m = new Map();
  for (const mod of modules) {
    if (mod.judul) m.set(mod.judul.trim().toLowerCase(), mod.id);
    if (mod.id) m.set(String(mod.id).trim().toLowerCase(), mod.id);
  }
  return m;
}

async function migrateSchedules() {
  console.log('\n=== schedules ===');
  const rows = await readCSV('Database Fislab - schedules.csv');
  if (!rows.length) { console.log('  (CSV kosong, skip)'); return; }
  const { data: mods, error: me } = await sb.from('modules').select('id,judul');
  if (me) throw me;
  const titleMap = buildTitleToId(mods);
  let upserted = 0, skipped = 0;
  for (const r of rows) {
    const judulRaw = (r.judul || '').trim();
    const moduleId = titleMap.get(judulRaw.toLowerCase());
    if (!moduleId) {
      console.warn(`  WARNING: judul schedule "${judulRaw}" tidak ketemu di modules, skip.`);
      skipped++; continue;
    }
    const kelompok = parseInt(r.kelompokId || r.kelompok, 10);
    if (isNaN(kelompok)) {
      console.warn(`  WARNING: kelompok tidak valid, skip: ${JSON.stringify(r)}`);
      skipped++; continue;
    }
    const rec = {
      module_id: moduleId,
      kelompok,
      tanggal: r.tanggal || null,
      sesi: r.sesi || null,
      set_by: r.setBy ? r.setBy.trim().toLowerCase() : null,
    };
    const { error } = await sb.from('schedules').upsert(rec, { onConflict: 'module_id,kelompok' });
    if (error) {
      console.warn(`  WARNING: gagal upsert schedule module=${moduleId} kelompok=${kelompok}: ${error.message}`);
      skipped++; continue;
    }
    upserted++;
  }
  console.log(`  ${upserted}/${rows.length} schedules upserted, ${skipped} skip.`);
}

// map camelCase catatan -> snake_case kolom
const CAT_MAP = {
  catPrelab: 'cat_prelab', catInlab: 'cat_inlab', catAbstrak: 'cat_abstrak',
  catPendahuluan: 'cat_pendahuluan', catMetodologi: 'cat_metodologi',
  catAnalisis: 'cat_analisis', catPembahasan: 'cat_pembahasan',
  catKesimpulan: 'cat_kesimpulan', catFormat: 'cat_format', catPlagiasi: 'cat_plagiasi',
};
const KOMP_KEYS = ['prelab','inlab','abstrak','pendahuluan','metodologi','analisis','pembahasan','kesimpulan','format','plagiasi'];

async function migrateGrades() {
  console.log('\n=== grades ===');
  const rows = await readCSV('Database Fislab - grades.csv');
  if (!rows.length) { console.log('  (CSV kosong, skip)'); return; }
  const { data: mods, error: me } = await sb.from('modules').select('id,judul');
  if (me) throw me;
  const titleMap = buildTitleToId(mods);
  let upserted = 0, skipped = 0;
  for (const r of rows) {
    const username = (r.username || '').trim().toLowerCase();
    if (!username) { console.warn(`  WARNING: grade tanpa username, skip: ${JSON.stringify(r)}`); skipped++; continue; }
    const judulRaw = (r.judul || '').trim();
    const moduleId = titleMap.get(judulRaw.toLowerCase());
    if (!moduleId) {
      console.warn(`  WARNING: judul grade "${judulRaw}" tidak ketemu di modules, skip. (username=${username})`);
      skipped++; continue;
    }
    const rec = {
      username,
      module_id: moduleId,
      set_by: r.setBy ? r.setBy.trim().toLowerCase() : null,
    };
    for (const k of KOMP_KEYS) {
      const v = r[k];
      if (v !== undefined && v !== '') rec[k] = parseFloat(v) || null;
    }
    for (const [camel, snake] of Object.entries(CAT_MAP)) {
      if (r[camel] !== undefined && r[camel] !== '') rec[snake] = r[camel];
    }
    // nilaiAkhir diabaikan — trigger recompute_nilai_akhir menghitung ulang
    const { error } = await sb.from('grades').upsert(rec, { onConflict: 'username,module_id' });
    if (error) {
      console.warn(`  WARNING: gagal upsert grade username=${username} module=${moduleId}: ${error.message}`);
      skipped++; continue;
    }
    upserted++;
  }
  console.log(`  ${upserted}/${rows.length} grades upserted, ${skipped} skip.`);
}

async function main() {
  console.log('=== PortalFislab1 — Migrasi CSV -> Supabase ===');
  console.log(`URL: ${SUPABASE_URL}`);
  if (existsSync(TEMP_PW_PATH)) {
    console.log(`temp_passwords.csv: akan APPEND ke file yang ada.`);
  } else {
    console.log(`temp_passwords.csv: akan dibuat baru.`);
  }

  await migrateModules();
  await migrateUsers();
  await migrateRotasi();
  await migrateSchedules();
  await migrateGrades();

  await verifyConsistency();

  console.log('\n=== SELESAI ===');
  if (existsSync(TEMP_PW_PATH)) {
    console.log(`Password sementara: ${TEMP_PW_PATH}`);
    console.log('BAGIKAN ke tiap pengguna, lalu HAPUS file ini dari disk.');
  }
}

// Cek konsistensi: akun dengan must_change_password=true di profiles
// harus punya baris di temp_passwords.csv. Kalau tidak, password sementara
// hilang (mis: createUser timeout seperti kasus 5001251036).
async function verifyConsistency() {
  console.log('\n=== KONSISTENSI ===');
  const { data, error } = await sb.from('profiles')
    .select('username,name')
    .eq('must_change_password', true);
  if (error) { console.warn(`  WARNING: gagal query profiles untuk konsistensi: ${error.message}`); return; }
  const mustChange = new Set((data || []).map(r => r.username));

  const tempUsernames = new Set();
  if (existsSync(TEMP_PW_PATH)) {
    const lines = readFileSync(TEMP_PW_PATH, 'utf8').split('\n');
    // skip header (baris pertama) dan baris kosong
    for (let i = 1; i < lines.length; i++) {
      const u = (lines[i].split(',', 1)[0] || '').trim();
      if (u) tempUsernames.add(u);
    }
  }

  const orphans = [...mustChange].filter(u => !tempUsernames.has(u));
  if (orphans.length === 0) {
    console.log(`  OK: ${mustChange.size} akun must_change_password, semua tercatat di temp_passwords.csv.`);
  } else {
    console.warn(`  WARNING: ${orphans.length} akun must_change_password TIDAK punya baris di temp_passwords.csv:`);
    for (const u of orphans) {
      const p = (data || []).find(r => r.username === u);
      console.warn(`    - ${u} (${p ? p.name : '?'}) — password sementara hilang, perlu reset manual`);
    }
    console.warn('  Jalankan fix-orphan-user.js (atau reset manual di Dashboard) untuk akun-akun ini.');
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
