'use strict';

/*API — semua action lewat Supabase (supabase-js). Tidak ada lagi fetch ke Google Apps Script.*/
async function api(action, body={}, useCache=false) {
  const cacheKey = action + JSON.stringify(body);
  if (useCache) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }
  let data;
  switch (action) {
    case 'login':         data = await apiLogin(body); break;
    case 'updateProfile': data = await apiUpdateProfile(body); break;
    case 'getModules':    data = await apiGetModules(); break;
    case 'getUsers':      data = await apiGetUsers(); break;
    case 'getGrades':     data = await apiGetGrades(body); break;
    case 'getSchedules':  data = await apiGetSchedules(body); break;
    case 'getRotasi':     data = await apiGetRotasi(body); break;
    case 'setSchedule':   data = await apiSetSchedule(body); break;
    case 'setGrade':      data = await apiSetGrade(body); break;
    case 'deleteGrade':   data = await apiDeleteGrade(body); break;
    case 'getKatalogJadwal': data = await apiGetKatalogJadwal(); break;
    case 'getRekapNilai': data = await apiGetRekapNilai(); break;
    case 'getJadwalKelompokModul': data = await apiGetJadwalKelompokModul(); break;
    case 'getAdminJadwal':  data = await apiGetAdminJadwal(body); break;
    case 'adminHapusJadwal': data = await apiAdminHapusJadwal(body); break;
    default: throw new Error('Unknown action: ' + action);
  }
  if (useCache) cacheSet(cacheKey, data);
  return data;
}

/* Supabase auth: login berbasis username, email sintetis {username}@student.its.ac.id */
async function apiLogin(body) {
  const username = (body.username || '').trim().toLowerCase();
  if (!username) throw new Error('Username wajib diisi.');
  const email = `${username}@student.its.ac.id`;
  const { data, error } = await SB.auth.signInWithPassword({ email, password: body.password });
  if (error) throw new Error(error.message);
  const uid = data.user.id;
  const { data: prof, error: pe } = await SB.from('profiles')
    .select('username,name,role,nrp,kelompok,wa,photo_path,must_change_password')
    .eq('id', uid).single();
  if (pe || !prof) throw new Error('Profil tidak ditemukan untuk user ini.');
  const user = {
    username: prof.username,
    name:     prof.name,
    role:     prof.role,
    nrp:      prof.nrp || undefined,
    kelompok: prof.kelompok,
    wa:       prof.wa || undefined,
    photo:    prof.photo_path ? SB.storage.from('avatars').getPublicUrl(prof.photo_path).data.publicUrl : undefined,
    must_change_password: prof.must_change_password,
  };
  if (prof.role === 'aslab') {
    const { data: meta } = await SB.from('v_aslab_meta')
      .select('kode_arr,kelompok_arr')
      .eq('username', prof.username).single();
    user.kode     = (meta && meta.kode_arr)     || [];
    user.kelompok = (meta && meta.kelompok_arr) || [];
  }
  return { user };
}

/* Supabase auth: ganti password + upload foto ke Storage */
async function apiUpdateProfile(body) {
  const ses = getSession();
  if (!ses) throw new Error('Sesi tidak ditemukan.');
  const { data: uData } = await SB.auth.getUser();
  const uid = uData.user.id;

  // 1. Ganti password (jika diminta)
  if (body.newPassword) {
    // verifikasi password lama dengan re-auth
    if (body.oldPassword) {
      const email = `${ses.username}@student.its.ac.id`;
      const { error: reErr } = await SB.auth.signInWithPassword({ email, password: body.oldPassword });
      if (reErr) throw new Error('Password saat ini salah.');
    }
    const { error: pwErr } = await SB.auth.updateUser({ password: body.newPassword });
    if (pwErr) throw new Error(pwErr.message);
  }

  // 2. Upload foto (jika ada) ke Storage bucket avatars, folder {uid}/
  let photoPath = undefined;
  if (body.photo) {
    const blob = dataURLtoBlob(body.photo);
    if (blob.size > 2 * 1024 * 1024) throw new Error('Ukuran foto maks. 2MB.');
    if (!blob.type.startsWith('image/')) throw new Error('File harus berupa gambar.');
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    photoPath = `${uid}/avatar.${ext}`;
    const { error: upErr } = await SB.storage.from('avatars')
      .upload(photoPath, blob, { upsert: true, contentType: blob.type });
    if (upErr) throw new Error('Gagal upload foto: ' + upErr.message);
  }

  // 3. Update profiles (photo_path + reset must_change_password)
  const updates = {};
  if (photoPath) updates.photo_path = photoPath;
  if (body.newPassword) updates.must_change_password = false;
  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await SB.from('profiles').update(updates).eq('id', uid);
    if (upErr) throw new Error('Gagal update profil: ' + upErr.message);
  }

  const newPhoto = photoPath ? SB.storage.from('avatars').getPublicUrl(photoPath).data.publicUrl : ses.photo;
  return { user: { ...ses, photo: newPhoto, must_change_password: false } };
}

/* helper: konversi data URL (base64) ke Blob untuk upload Storage */
function dataURLtoBlob(dataURL) {
  const [meta, b64] = dataURL.split(',');
  const mime = (meta.match(/:(.*?);/) || ['', 'image/png'])[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* helper: cache map judul -> module id (dipakai getGrades/getSchedules/setSchedule/setGrade) */
let _judulToId = null;
async function getModuleIdByJudul(judul) {
  if (!_judulToId) {
    const { data, error } = await SB.from('modules').select('id,judul');
    if (error) throw new Error(error.message);
    _judulToId = new Map();
    for (const m of data) _judulToId.set(m.judul, m.id);
  }
  const id = _judulToId.get(judul);
  if (!id) throw new Error('Modul tidak ditemukan: ' + judul);
  return id;
}

/* getModules: SELECT dari modules, public (anon bisa baca) */
async function apiGetModules() {
  const { data, error } = await SB.from('modules')
    .select('id,kode,judul,ringkas,file_url,file_type')
    .order('urutan');
  if (error) throw new Error(error.message);
  return { modules: (data || []).map(m => ({
    id: m.id,
    kode: m.kode,
    judul: m.judul,
    ringkas: m.ringkas,
    fileUrl: m.file_url,
    fileType: m.file_type,
  }))};
}

/* getUsers: response disesuaikan per role (RLS sudah filter baris) */
async function apiGetUsers() {
  const ses = getSession();
  if (!ses) {
    // anon (landing): hanya butuh jumlah aslab untuk stat
    const { data: count, error } = await SB.rpc('public_aslab_count');
    if (error) throw new Error(error.message);
    return { users: Array(count).fill({ role: 'aslab' }) };
  }
  // fetch aslab metadata (kode & kelompok array) untuk merge
  const { data: aslabMeta } = await SB.from('v_aslab_meta')
    .select('username,kode_arr,kelompok_arr');
  const metaMap = new Map();
  for (const m of (aslabMeta || [])) metaMap.set(m.username, m);

  let profiles = [];
  const cols = 'username,name,role,nrp,kelompok,wa,photo_path';
  if (ses.role === 'admin') {
    const { data, error } = await SB.from('profiles').select(cols);
    if (error) throw new Error(error.message);
    profiles = data;
  } else if (ses.role === 'aslab') {
    const { data: prak, error: e1 } = await SB.from('profiles').select(cols).eq('role', 'praktikan');
    if (e1) throw new Error(e1.message);
    const { data: self, error: e2 } = await SB.from('profiles').select(cols).eq('username', ses.username);
    if (e2) throw new Error(e2.message);
    profiles = [...(prak || []), ...(self || [])];
  } else {
    const { data: aslabs, error: e1 } = await SB.from('profiles').select(cols).eq('role', 'aslab');
    if (e1) throw new Error(e1.message);
    const { data: self, error: e2 } = await SB.from('profiles').select(cols).eq('username', ses.username);
    if (e2) throw new Error(e2.message);
    profiles = [...(aslabs || []), ...(self || [])];
  }
  const users = profiles.map(p => {
    const u = {
      username: p.username,
      name: p.name,
      role: p.role,
      nrp: p.nrp || undefined,
      kelompok: p.kelompok,
      wa: p.wa || undefined,
      photo: p.photo_path ? SB.storage.from('avatars').getPublicUrl(p.photo_path).data.publicUrl : undefined,
    };
    if (p.role === 'aslab') {
      const meta = metaMap.get(p.username);
      u.kode = (meta && meta.kode_arr) || [];
      u.kelompok = (meta && meta.kelompok_arr) || [];
    }
    return u;
  });
  return { users };
}

/* getGrades: body {username?} dan/atau {judul?} (judul = full module title) */
async function apiGetGrades(body) {
  let query = SB.from('grades').select(`
    username, module_id, set_by, updated_at, nilai_akhir,
    prelab, inlab_pengambilan_data, inlab_diskusi, inlab_kerapian, abstrak, pendahuluan, metodologi, analisis_data, analisis_perhitungan_grafik, pembahasan, kesimpulan, format, plagiasi, keterlambatan,
    cat_prelab, cat_inlab_pengambilan_data, cat_inlab_diskusi, cat_inlab_kerapian, cat_abstrak, cat_pendahuluan, cat_metodologi, cat_analisis_data, cat_analisis_perhitungan_grafik, cat_pembahasan, cat_kesimpulan, cat_format, cat_plagiasi, cat_keterlambatan,
    modules:module_id(judul)
  `);
  if (body.username) query = query.eq('username', body.username);
  if (body.judul) {
    const modId = await getModuleIdByJudul(body.judul);
    query = query.eq('module_id', modId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { grades: (data || []).map(g => ({
    judul: (g.modules && g.modules.judul) || g.module_id,
    username: g.username,
    nilaiAkhir: g.nilai_akhir !== null ? String(g.nilai_akhir) : '',
    setBy: g.set_by,
    updatedAt: g.updated_at,
    prelab: g.prelab ?? '', inlab_pengambilan_data: g.inlab_pengambilan_data ?? '',
    inlab_diskusi: g.inlab_diskusi ?? '', inlab_kerapian: g.inlab_kerapian ?? '',
    abstrak: g.abstrak ?? '',
    pendahuluan: g.pendahuluan ?? '', metodologi: g.metodologi ?? '',
    analisis_data: g.analisis_data ?? '', analisis_perhitungan_grafik: g.analisis_perhitungan_grafik ?? '',
    pembahasan: g.pembahasan ?? '',
    kesimpulan: g.kesimpulan ?? '', format: g.format ?? '', plagiasi: g.plagiasi ?? '', keterlambatan: g.keterlambatan ?? '',
    catPrelab: g.cat_prelab || '', catInlabPengambilanData: g.cat_inlab_pengambilan_data || '',
    catInlabDiskusi: g.cat_inlab_diskusi || '', catInlabKerapian: g.cat_inlab_kerapian || '',
    catAbstrak: g.cat_abstrak || '', catPendahuluan: g.cat_pendahuluan || '',
    catMetodologi: g.cat_metodologi || '', catAnalisisData: g.cat_analisis_data || '',
    catAnalisisPerhitunganGrafik: g.cat_analisis_perhitungan_grafik || '',
    catPembahasan: g.cat_pembahasan || '', catKesimpulan: g.cat_kesimpulan || '',
    catFormat: g.cat_format || '', catPlagiasi: g.cat_plagiasi || '', catKeterlambatan: g.cat_keterlambatan || '',
  }))};
}

/* getSchedules: body {kelompok?} dan/atau {judul?} (judul = full module title) */
async function apiGetSchedules(body) {
  let query = SB.from('schedules')
    .select('module_id, kelompok, tanggal, sesi, set_by, updated_at, modules:module_id(judul)');
  if (body.kelompok) query = query.eq('kelompok', parseInt(body.kelompok));
  if (body.judul) {
    const modId = await getModuleIdByJudul(body.judul);
    query = query.eq('module_id', modId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { schedules: (data || []).map(s => ({
    judul: (s.modules && s.modules.judul) || s.module_id,
    kelompokId: s.kelompok,
    tanggal: s.tanggal,
    sesi: s.sesi,
    setBy: s.set_by,
    updatedAt: s.updated_at,
  }))};
}

/* getRotasi: body {kelompok?} atau {kode:'E1,E2'} */
async function apiGetRotasi(body) {
  let query = SB.from('rotasi')
    .select('kelompok, minggu, aslab_username, modules:module_id(id, kode, judul)')
    .order('minggu', { ascending: true });
  if (body.kelompok) query = query.eq('kelompok', parseInt(body.kelompok));
  if (body.kode) {
    const kodeList = body.kode.split(',').map(k => k.trim()).filter(Boolean);
    const { data: mods, error: me } = await SB.from('modules').select('id').in('kode', kodeList);
    if (me) throw new Error(me.message);
    const modIds = (mods || []).map(m => m.id);
    if (modIds.length === 0) return { rotasi: [] };
    query = query.in('module_id', modIds);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // fetch aslab names untuk aslab_username -> name
  const aslabUsernames = [...new Set((data || []).map(r => r.aslab_username).filter(Boolean))];
  let nameMap = new Map();
  if (aslabUsernames.length > 0) {
    const { data: aslabs } = await SB.from('profiles').select('username,name').in('username', aslabUsernames);
    for (const a of (aslabs || [])) nameMap.set(a.username, a.name);
  }
  return { rotasi: (data || []).map(r => ({
    kode: (r.modules && r.modules.kode) || '',
    judul: (r.modules && r.modules.judul) || '',
    judulPanjang: (r.modules && r.modules.judul) || '',
    moduleId: (r.modules && r.modules.id) || null,
    kelompok: r.kelompok,
    minggu: r.minggu,
    aslabUsername: r.aslab_username || null,
    aslab: r.aslab_username ? (nameMap.get(r.aslab_username) || null) : null,
  }))};
}

/* setSchedule: body {kelompokId, judul, tanggal, sesi, setBy}. tanggal kosong = delete. */
async function apiSetSchedule(body) {
  const moduleId = await getModuleIdByJudul(body.judul);
  const kelompok = parseInt(body.kelompokId);
  const updatedAt = body.updatedAt || null; // updated_at yang dibaca saat form dimuat (C1)
  const CONFLICT = 'Data sudah diubah orang lain, muat ulang halaman';
  const rec = {
    module_id: moduleId,
    kelompok,
    tanggal: body.tanggal,
    sesi: body.sesi,
    set_by: body.setBy,
    updated_at: new Date().toISOString(),
  };

  if (!body.tanggal) {
    // Hapus jadwal — pengaman versi bila praktis (updated_at tersedia).
    let q = SB.from('schedules')
      .delete().eq('module_id', moduleId).eq('kelompok', kelompok);
    if (updatedAt) q = q.eq('updated_at', updatedAt);
    const { data, error } = await q.select();
    if (error) throw new Error(error.message);
    if (updatedAt && (!data || data.length === 0)) throw new Error(CONFLICT);
    return { success: true };
  }

  if (updatedAt) {
    // Baris sudah ada saat form dibuka — UPDATE dengan pengaman versi (C1).
    const { data, error } = await SB.from('schedules')
      .update(rec)
      .eq('module_id', moduleId).eq('kelompok', kelompok).eq('updated_at', updatedAt)
      .select('module_id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error(CONFLICT); // 0 baris = data sudah berubah
  } else {
    // Baris belum ada saat form dibuka — INSERT; bentrok unique = sudah dibuat orang lain.
    const { error } = await SB.from('schedules').insert(rec);
    if (error) {
      if (/duplicate|unique|23505/i.test(error.message)) throw new Error(CONFLICT);
      throw new Error(error.message);
    }
  }
  return { success: true };
}

/* getKatalogJadwal: pilihan jadwal semua aslab (lintas-aslab) via RPC
   SECURITY DEFINER katalog_jadwal_aslab (lihat 0009_batas_aslab_jadwal.sql),
   untuk indikator terisi & katalog read-only. Mengembalikan
   { katalog: [{tanggal, sesi, set_by, aslab_name}] } urut tanggal DESC. */
async function apiGetKatalogJadwal() {
  const { data, error } = await SB.rpc('katalog_jadwal_aslab');
  if (error) throw new Error(error.message);
  return { katalog: (data || []).map(r => ({
    tanggal:    r.tanggal,
    sesi:       r.sesi,
    setBy:      r.set_by,
    aslabName:  r.aslab_name,
  }))};
}

/* getRekapNilai: nilai_akhir SEMUA praktikan x SEMUA modul (lintas-aslab) via
   RPC SECURITY DEFINER rekap_nilai_aslab (lihat 0010_rpc_rekap_nilai_aslab.sql),
   untuk tabel Rekap Nilai E1-E10. */
async function apiGetRekapNilai() {
  const { data, error } = await SB.rpc('rekap_nilai_aslab');
  if (error) throw new Error(error.message);
  return { rekap: (data || []).map(r => ({
    username:   r.username,
    moduleId:   r.module_id,
    nilaiAkhir: r.nilai_akhir !== null ? String(r.nilai_akhir) : '',
  }))};
}

/* getJadwalKelompokModul: jadwal semua kelompok x semua modul (lintas-aslab)
   via RPC SECURITY DEFINER jadwal_kelompok_modul (lihat
   0011_rpc_jadwal_kelompok_modul.sql). Dipakai toggle "Per Kelompok" di
   Katalog Jadwal. */
async function apiGetJadwalKelompokModul() {
  const { data, error } = await SB.rpc('jadwal_kelompok_modul');
  if (error) throw new Error(error.message);
  return { jadwal: (data || []).map(r => ({
    kelompok:  r.kelompok,
    moduleId:  r.module_id,
    tanggal:   r.tanggal,
    sesi:      r.sesi,
    setBy:     r.set_by,
    aslabName: r.aslab_name,
  }))};
}

/* getAdminJadwal: SEMUA jadwal lintas kelompok/modul/tanggal (admin only,
   RLS sched_admin_all mengizinkan baca semua baris). Output menyertakan
   module_id + kode + judul + aslab pemegang slot (set_by + name) untuk
   halaman Jadwal admin. */
async function apiGetAdminJadwal() {
  const { data: sched, error } = await SB.from('schedules')
    .select('module_id, kelompok, tanggal, sesi, set_by, updated_at, modules:module_id(judul,kode)')
    .order('tanggal', { ascending: true })
    .order('sesi', { ascending: true });
  if (error) throw new Error(error.message);
  const aslabUsernames = [...new Set((sched || []).map(s => s.set_by).filter(Boolean))];
  let nameMap = new Map();
  if (aslabUsernames.length) {
    const { data: aslabs } = await SB.from('profiles')
      .select('username,name').in('username', aslabUsernames);
    for (const a of (aslabs || [])) nameMap.set(a.username, a.name);
  }
  return { jadwal: (sched || []).map(s => ({
    moduleId: s.module_id,
    judul: (s.modules && s.modules.judul) || s.module_id,
    kode: (s.modules && s.modules.kode) || '',
    kelompok: s.kelompok,
    tanggal: s.tanggal,
    sesi: s.sesi,
    setBy: s.set_by,
    aslabName: s.set_by ? (nameMap.get(s.set_by) || s.set_by) : '—',
    updatedAt: s.updated_at,
  }))};
}

/* adminHapusJadwal: body {moduleId, kelompok}. Hapus jadwal + nilai terkait
   atomik via RPC SECURITY DEFINER admin_hapus_jadwal (lihat
   0012_admin_full_power_nilai_jadwal.sql). Dipakai halaman Jadwal admin. */
async function apiAdminHapusJadwal(body) {
  const { error } = await SB.rpc('admin_hapus_jadwal', {
    p_module_id: body.moduleId,
    p_kelompok: parseInt(body.kelompok, 10),
  });
  if (error) throw new Error(error.message);
  return { success: true };
}

/* setGrade: body {username, judul, setBy, 10 komponen, 10 catatan, nilaiAkhir(ignored)}.
   nilai_akhir dihitung ulang oleh trigger recompute_nilai_akhir di server. */
async function apiSetGrade(body) {
  const moduleId = await getModuleIdByJudul(body.judul);
  const rec = {
    username: body.username,
    module_id: moduleId,
    set_by: body.setBy,
    updated_at: new Date().toISOString(),
  };
  const KOMP = ['prelab','inlab_pengambilan_data','inlab_diskusi','inlab_kerapian','abstrak','pendahuluan','metodologi','analisis_data','analisis_perhitungan_grafik','pembahasan','kesimpulan','format','plagiasi','keterlambatan'];
  const CAT = [
    ['catPrelab','cat_prelab'], ['catInlabPengambilanData','cat_inlab_pengambilan_data'],
    ['catInlabDiskusi','cat_inlab_diskusi'], ['catInlabKerapian','cat_inlab_kerapian'],
    ['catAbstrak','cat_abstrak'], ['catPendahuluan','cat_pendahuluan'],
    ['catMetodologi','cat_metodologi'], ['catAnalisisData','cat_analisis_data'],
    ['catAnalisisPerhitunganGrafik','cat_analisis_perhitungan_grafik'],
    ['catPembahasan','cat_pembahasan'], ['catKesimpulan','cat_kesimpulan'],
    ['catFormat','cat_format'], ['catPlagiasi','cat_plagiasi'], ['catKeterlambatan','cat_keterlambatan'],
  ];
  // Komponen nilai: kunci yang ada di body -> null bila kosong/NaN, selain itu parseFloat.
  // Khusus keterlambatan (NOT NULL DEFAULT 0 di DB, 0014) -> kirim 0 bila kosong.
  for (const k of KOMP) {
    if (body[k] === undefined) continue; // kunci tidak ada di body -> jangan sentuh (pertahankan nilai lama)
    const v = body[k];
    if (v === '' || v === null) {
      rec[k] = (k === 'keterlambatan') ? 0 : null;
    } else {
      const n = parseFloat(v);
      rec[k] = isNaN(n) ? ((k === 'keterlambatan') ? 0 : null) : n;
    }
  }
  for (const [camel, snake] of CAT) {
    if (body[camel] !== undefined) rec[snake] = body[camel] || null;
  }
  // nilaiAkhir sengaja TIDAK dikirim — trigger recompute_nilai_akhir menghitung ulang di server
  const updatedAt = body.updatedAt || null; // updated_at yang dibaca saat form dimuat (C1)
  const CONFLICT = 'Data sudah diubah orang lain, muat ulang halaman';
  if (updatedAt) {
    // Baris sudah ada saat form dibuka — UPDATE dengan pengaman versi (C1).
    const { data, error } = await SB.from('grades')
      .update(rec)
      .eq('username', body.username).eq('module_id', moduleId).eq('updated_at', updatedAt)
      .select('username');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error(CONFLICT); // 0 baris = data sudah berubah
  } else {
    // Baris belum ada — INSERT; bentrok unique = sudah dibuat orang lain.
    const { error } = await SB.from('grades').insert(rec);
    if (error) {
      if (/duplicate|unique|23505/i.test(error.message)) throw new Error(CONFLICT);
      throw new Error(error.message);
    }
  }
  return { success: true };
}

/* deleteGrade: body {username, judul}. Hapus baris nilai (untuk koreksi salah input). */
async function apiDeleteGrade(body) {
  const moduleId = await getModuleIdByJudul(body.judul);
  const { error } = await SB.from('grades')
    .delete().eq('username', body.username).eq('module_id', moduleId);
  if (error) throw new Error(error.message);
  return { success: true };
}

/* Pemantauan penilaian: cek akses. Hasil dicache per sesi (reset saat logout). */
async function apiAksesPemantauan() {
  if (typeof window._aksesPemantauan === 'boolean') return window._aksesPemantauan;
  try {
    const { data, error } = await SB.rpc('punya_akses_pemantauan');
    if (error) throw error;
    window._aksesPemantauan = !!data;
  } catch (_) {
    window._aksesPemantauan = false;
  }
  return window._aksesPemantauan;
}

/* Pemantauan penilaian: daftar unit yang sudah lewat (tanpa cache, harus segar). */
async function apiPemantauanPenilaian() {
  const { data, error } = await SB.rpc('pemantauan_penilaian');
  if (error) throw error;
  return data || [];
}

/* Pemantauan penilaian: ringkasan unit belum waktunya / belum dijadwalkan. */
async function apiPemantauanRingkas() {
  const { data, error } = await SB.rpc('pemantauan_ringkas');
  if (error) throw error;
  return (data && data[0]) || { total_unit: 0, belum_waktu: 0 };
}
