'use strict';

const KOMP = [
  { key:'prelab',                     label:'Pre-Lab',                         bobot:10, cat:'catPrelab'                     },
  { key:'inlab_pengambilan_data',     label:'In-Lab Pengambilan Data',         bobot:15, cat:'catInlabPengambilanData'       },
  { key:'inlab_diskusi',              label:'In-Lab Diskusi',                  bobot:10, cat:'catInlabDiskusi'               },
  { key:'inlab_kerapian',             label:'In-Lab Kerapian',                 bobot:5,  cat:'catInlabKerapian'              },
  { key:'abstrak',                    label:'Laporan Abstrak',                 bobot:5,  cat:'catAbstrak'                    },
  { key:'pendahuluan',                label:'Laporan Pendahuluan',             bobot:5,  cat:'catPendahuluan'                },
  { key:'metodologi',                 label:'Laporan Metodologi',              bobot:5,  cat:'catMetodologi'                 },
  { key:'analisis_data',              label:'Laporan Analisis Data',           bobot:5,  cat:'catAnalisisData'               },
  { key:'analisis_perhitungan_grafik',label:'Laporan Analisis Perhitungan & Grafik', bobot:10, cat:'catAnalisisPerhitunganGrafik' },
  { key:'pembahasan',                 label:'Laporan Pembahasan',              bobot:20, cat:'catPembahasan'                 },
  { key:'kesimpulan',                 label:'Laporan Kesimpulan',              bobot:5,  cat:'catKesimpulan'                 },
  { key:'format',                     label:'Laporan Formating',               bobot:5,  cat:'catFormat'                    },
  { key:'plagiasi',                   label:'Plagiasi',                        bobot:0,  cat:'catPlagiasi'                   },
];
function hitungTotal(g) {
  let total = 0;
  KOMP.forEach(k => {
    const val = parseFloat(g[k.key]);
    if (!isNaN(val) && k.bobot > 0) total += val * (k.bobot / 100);
  });
  return Math.round(total * 100) / 100;
}
function scoreClass(v) {
  if (v === null || v === '') return 'na';
  const n = parseFloat(v);
  if (n >= 80) return 'a';
  if (n >= 65) return 'b';
  if (n >= 50) return 'c';
  return 'd';
}

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
    default: throw new Error('Unknown action: ' + action);
  }
  if (useCache) cacheSet(cacheKey, data);
  return data;
}

/* — Supabase auth: login berbasis username, email sintetis {username}@portalfislab.local — */
async function apiLogin(body) {
  const username = (body.username || '').trim().toLowerCase();
  if (!username) throw new Error('Username wajib diisi.');
  const email = `${username}@portalfislab.local`;
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

/* — Supabase auth: ganti password + upload foto ke Storage — */
async function apiUpdateProfile(body) {
  const ses = getSession();
  if (!ses) throw new Error('Sesi tidak ditemukan.');
  const { data: uData } = await SB.auth.getUser();
  const uid = uData.user.id;

  // 1. Ganti password (jika diminta)
  if (body.newPassword) {
    // verifikasi password lama dengan re-auth
    if (body.oldPassword) {
      const email = `${ses.username}@portalfislab.local`;
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

/* — helper: konversi data URL (base64) ke Blob untuk upload Storage — */
function dataURLtoBlob(dataURL) {
  const [meta, b64] = dataURL.split(',');
  const mime = (meta.match(/:(.*?);/) || ['', 'image/png'])[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* — helper: cache map judul -> module id (dipakai getGrades/getSchedules/setSchedule/setGrade) — */
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

/* — getModules: SELECT dari modules, public (anon bisa baca) — */
async function apiGetModules() {
  const { data, error } = await SB.from('modules')
    .select('id,kode,judul,ringkas,file_url,file_type')
    .order('id');
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

/* — getUsers: response disesuaikan per role (RLS sudah filter baris) — */
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

/* — getGrades: body {username?} dan/atau {judul?} (judul = full module title) — */
async function apiGetGrades(body) {
  let query = SB.from('grades').select(`
    username, module_id, set_by, updated_at, nilai_akhir,
    prelab, inlab_pengambilan_data, inlab_diskusi, inlab_kerapian, abstrak, pendahuluan, metodologi, analisis_data, analisis_perhitungan_grafik, pembahasan, kesimpulan, format, plagiasi,
    cat_prelab, cat_inlab_pengambilan_data, cat_inlab_diskusi, cat_inlab_kerapian, cat_abstrak, cat_pendahuluan, cat_metodologi, cat_analisis_data, cat_analisis_perhitungan_grafik, cat_pembahasan, cat_kesimpulan, cat_format, cat_plagiasi,
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
    kesimpulan: g.kesimpulan ?? '', format: g.format ?? '', plagiasi: g.plagiasi ?? '',
    catPrelab: g.cat_prelab || '', catInlabPengambilanData: g.cat_inlab_pengambilan_data || '',
    catInlabDiskusi: g.cat_inlab_diskusi || '', catInlabKerapian: g.cat_inlab_kerapian || '',
    catAbstrak: g.cat_abstrak || '', catPendahuluan: g.cat_pendahuluan || '',
    catMetodologi: g.cat_metodologi || '', catAnalisisData: g.cat_analisis_data || '',
    catAnalisisPerhitunganGrafik: g.cat_analisis_perhitungan_grafik || '',
    catPembahasan: g.cat_pembahasan || '', catKesimpulan: g.cat_kesimpulan || '',
    catFormat: g.cat_format || '', catPlagiasi: g.cat_plagiasi || '',
  }))};
}

/* — getSchedules: body {kelompok?} dan/atau {judul?} (judul = full module title) — */
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

/* — getRotasi: body {kelompok?} atau {kode:'E1,E2'} — */
async function apiGetRotasi(body) {
  let query = SB.from('rotasi')
    .select('kelompok, minggu, aslab_username, modules:module_id(id, kode, judul)');
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
    kelompok: r.kelompok,
    minggu: r.minggu,
    aslab: r.aslab_username ? (nameMap.get(r.aslab_username) || null) : null,
  }))};
}

/* — setSchedule: body {kelompokId, judul, tanggal, sesi, setBy}. tanggal kosong = delete. — */
async function apiSetSchedule(body) {
  const moduleId = await getModuleIdByJudul(body.judul);
  const kelompok = parseInt(body.kelompokId);
  if (!body.tanggal) {
    const { error } = await SB.from('schedules')
      .delete().eq('module_id', moduleId).eq('kelompok', kelompok);
    if (error) throw new Error(error.message);
    return { success: true };
  }
  const { error } = await SB.from('schedules')
    .upsert({
      module_id: moduleId,
      kelompok,
      tanggal: body.tanggal,
      sesi: body.sesi,
      set_by: body.setBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'module_id,kelompok' });
  if (error) throw new Error(error.message);
  return { success: true };
}

/* — setGrade: body {username, judul, setBy, 10 komponen, 10 catatan, nilaiAkhir(ignored)}.
   nilai_akhir dihitung ulang oleh trigger recompute_nilai_akhir di server. — */
async function apiSetGrade(body) {
  const moduleId = await getModuleIdByJudul(body.judul);
  const rec = {
    username: body.username,
    module_id: moduleId,
    set_by: body.setBy,
    updated_at: new Date().toISOString(),
  };
  const KOMP = ['prelab','inlab_pengambilan_data','inlab_diskusi','inlab_kerapian','abstrak','pendahuluan','metodologi','analisis_data','analisis_perhitungan_grafik','pembahasan','kesimpulan','format','plagiasi'];
  const CAT = [
    ['catPrelab','cat_prelab'], ['catInlabPengambilanData','cat_inlab_pengambilan_data'],
    ['catInlabDiskusi','cat_inlab_diskusi'], ['catInlabKerapian','cat_inlab_kerapian'],
    ['catAbstrak','cat_abstrak'], ['catPendahuluan','cat_pendahuluan'],
    ['catMetodologi','cat_metodologi'], ['catAnalisisData','cat_analisis_data'],
    ['catAnalisisPerhitunganGrafik','cat_analisis_perhitungan_grafik'],
    ['catPembahasan','cat_pembahasan'], ['catKesimpulan','cat_kesimpulan'],
    ['catFormat','cat_format'], ['catPlagiasi','cat_plagiasi'],
  ];
  for (const k of KOMP) {
    if (body[k] !== undefined && body[k] !== '') rec[k] = parseFloat(body[k]);
  }
  for (const [camel, snake] of CAT) {
    if (body[camel] !== undefined) rec[snake] = body[camel] || null;
  }
  // nilaiAkhir sengaja TIDAK dikirim — trigger recompute_nilai_akhir menghitung ulang di server
  const { error } = await SB.from('grades')
    .upsert(rec, { onConflict: 'username,module_id' });
  if (error) throw new Error(error.message);
  return { success: true };
}

/*session*/
const SES_KEY = 'lp_ses_v5';
const getSession  = () => { 
  try{ 
    return JSON.parse(localStorage.getItem(SES_KEY)); 
  }catch(e){
     return null; 
    } 
  };
const setSession  = u  => localStorage.setItem(SES_KEY, JSON.stringify(u));
const clearSession     = () => localStorage.removeItem(SES_KEY);
let CACHE = {};
const CACHE_TTL = 5 * 60 * 1000;

function cacheSet(key, data) {
  CACHE[key] = { data, ts: Date.now() };
}
function cacheGet(key) {
  const c = CACHE[key];
  if (!c) return null;
  if (Date.now() - c.ts > CACHE_TTL) { delete CACHE[key]; return null; }
  return c.data;
}

/*helpers*/
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// escAttr: untuk nilai di dalam onclick="fn('...')" — HTML entity tidak cukup
// karena browser decode entity sebelum JS jalan. Butuh JS-string escape + HTML escape.
function escAttr(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/\\/g,'\\\\').replace(/'/g,"\\'")
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
const initials = n => esc(n).split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
function av(user, extra='') {
  const cls='av'+(extra?' '+extra:'');
  if(user.photo) return `<div class="${cls}"><img src="${user.photo}" alt="${esc(user.name)}"></div>`;
  return `<div class="${cls}">${initials(user.name)}</div>`;
}
function toast(msg) {
  const el=document.createElement('div');el.className='toast';el.textContent=msg;
  document.body.appendChild(el);setTimeout(()=>el.remove(),2400);
}
function fmtTgl(tgl) {
  if (!tgl) return '—';
  const d = new Date(tgl);
  if (isNaN(d)) return tgl;
  return d.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}
function loading(msg='Memuat…') {
  return `<div class="page-loading"><div class="spinner spinner-dk"></div>${msg}</div>`;
}
let modsCache = null;
async function getMods() {
  const cached = cacheGet('modules');
  if (cached) return cached;
  const mods = (await api('getModules')).modules;
  cacheSet('modules', mods);
  return mods;
}

function initWebGL() {
  const c=document.getElementById('webgl');if(!c)return;
  const gl=c.getContext('webgl',{antialias:true,alpha:true});if(!gl)return;
  const rsz=()=>{const d=Math.min(devicePixelRatio,2);c.width=c.offsetWidth*d;c.height=c.offsetHeight*d;gl.viewport(0,0,c.width,c.height);};
  rsz();window.addEventListener('resize',rsz);
  const v=`attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}`;
  const f=`precision highp float;uniform vec2 res;uniform float t;uniform vec2 mouse;
  vec2 hsh(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return -1.+2.*fract(sin(p)*43758.5453);}
  float ns(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(dot(hsh(i),f),dot(hsh(i+vec2(1,0)),f-vec2(1,0)),u.x),mix(dot(hsh(i+vec2(0,1)),f-vec2(0,1)),dot(hsh(i+vec2(1)),f-vec2(1)),u.x),u.y);}
  void main(){vec2 uv=(gl_FragCoord.xy-res*.5)/min(res.x,res.y),m=(mouse-res*.5)/min(res.x,res.y);float tt=t*.25;
  vec2 b1=vec2(sin(tt*.9)*.4,cos(tt*.7)*.28),b2=vec2(cos(tt*.6)*.36+m.x*.2,sin(tt*1.1)*.32+m.y*.14),b3=vec2(sin(tt*1.3)*.24,cos(tt*.85)*.4);
  float f=.18/dot(uv-b1,uv-b1)+.16/dot(uv-b2,uv-b2)+.12/dot(uv-b3,uv-b3),n=ns(uv*3.+tt*.4)*.5+.5;
  vec3 c1=vec3(.1,.18,.98),c2=vec3(.53,.2,.97),c3=vec3(1.,0.,1.),col=mix(c1,mix(c2,c3,n),smoothstep(.8,1.8,f));
  float blob=smoothstep(.9,1.,f/1.8),glow=smoothstep(0.,.65,f/1.8)*.13;gl_FragColor=vec4(col*blob+col*glow,blob*.8+glow);}`;
  const sh=(t,s)=>{const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);return x;};
  const prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,v));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,f));gl.linkProgram(prog);gl.useProgram(prog);
  const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(prog,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  const uR=gl.getUniformLocation(prog,'res'),uT=gl.getUniformLocation(prog,'t'),uM=gl.getUniformLocation(prog,'mouse');
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  let mx=innerWidth/2,my=innerHeight/2,start=performance.now();
  window.addEventListener('mousemove',e=>{mx=e.clientX;my=e.clientY;});
  (function loop(now){if(!document.getElementById('webgl'))return;rsz();const el=(now-start)/1e3;
  gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform2f(uR,c.width,c.height);gl.uniform1f(uT,el);
  gl.uniform2f(uM,mx*Math.min(devicePixelRatio,2),(innerHeight-my)*Math.min(devicePixelRatio,2));gl.drawArrays(gl.TRIANGLE_STRIP,0,4);requestAnimationFrame(loop);})(performance.now());
}

function initCursor() {
  const dot=document.getElementById('cur-dot'),ring=document.getElementById('cur-ring');
  if(!dot||!ring)return;
  document.documentElement.classList.add('lusion');
  let rx=innerWidth/2,ry=innerHeight/2;
  document.addEventListener('mousemove',e=>{
    dot.style.cssText=`left:${e.clientX}px;top:${e.clientY}px`;
    rx+=(e.clientX-rx)*.1;ry+=(e.clientY-ry)*.1;
    ring.style.cssText=`left:${rx}px;top:${ry}px`;
  });
  document.querySelectorAll('button,a,input,select').forEach(el=>{
    el.addEventListener('mouseenter',()=>ring.classList.add('h'));
    el.addEventListener('mouseleave',()=>ring.classList.remove('h'));
  });
}

function openViewer(mod) {
  if (!mod.fileUrl || mod.fileUrl.includes('GANTI')) {
    alert('URL file belum diisi untuk modul ini. Isi kolom fileUrl di sheet modules.'); return;
  }
  let src = mod.fileUrl;
  if (mod.fileType === 'pdf') {
    const m = src.match(/\/d\/([^/]+)/);
    if (m) src = `https://drive.google.com/file/d/${m[1]}/preview`;
  }
  const root = document.getElementById('viewer-root');
  root.style.display = '';
  root.innerHTML = `
    <div class="viewer-back" id="vback">
      <div class="viewer-box">
        <div class="viewer-head">
          <h3>${esc(mod.judul)}</h3>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="tag ${mod.fileType==='pdf'?'':'blue'}" style="font-size:11px;">${mod.fileType==='pdf'?'pdf':'Docs'}</span>
            <a href="${esc(mod.fileUrl)}" target="_blank" class="btn btn-ghost" style="color:#fff;height:32px;font-size:12px;">Buka tab baru ↗</a>
            <button class="btn btn-ghost" style="color:#fff;height:32px;" onclick="closeViewer()">✕</button>
          </div>
        </div>
        <div class="viewer-body">
          <div class="viewer-loading" id="vload"><div class="spinner"></div>Memuat…</div>
          <iframe src="${src}" style="display:none;"
            onload="document.getElementById('vload').style.display='none';this.style.display='block';"
            allow="fullscreen" title="${esc(mod.judul)}"></iframe>
        </div>
      </div>
    </div>`;
  document.getElementById('vback').addEventListener('click', e=>{ if(e.target.id==='vback') closeViewer(); });
}
function closeViewer() {
  const r=document.getElementById('viewer-root');r.style.display='none';r.innerHTML='';
}

async function loadLandingModules() {
  try {
    const mods = await getMods();
    document.getElementById('mod-grid').innerHTML =
      mods.map((m,i)=>`
        <div class="mod-card-land" onclick='openViewer(${escAttr(JSON.stringify(m))})'>
          <span class="mod-num">${String(i+1).padStart(2,'0')}</span>
          <h3>${esc(m.judul)}</h3>
          <span class="mod-type-badge ${m.fileType==='pdf'?'pdf':'docs'}">${m.fileType==='pdf'?'pdf':'Docs'}</span>
        </div>`).join('');
    try {
      const {users}=await api('getUsers');
      document.getElementById('stat-aslab').textContent=users.filter(u=>u.role==='aslab').length;
    }catch(_){}
  } catch(e) {
    document.getElementById('mod-grid').innerHTML=`<p style="color:#9497a8;font-size:13px;">Gagal: ${esc(e.message)}</p>`;
  }
}

const openPanel  = ()=>{ 
  document.getElementById('panel-backdrop').classList.add('open');document.getElementById('login-panel').classList.add('open');setTimeout(()=>document.getElementById('f-user')?.focus(),350); 
};
const closePanel = ()=>{ 
  document.getElementById('panel-backdrop').classList.remove('open');document.getElementById('login-panel').classList.remove('open'); 
};

function initLoginPanel() {
  document.getElementById('btn-open-panel')?.addEventListener('click', openPanel);
  document.getElementById('btn-open-panel-2')?.addEventListener('click', openPanel);
  document.getElementById('btn-open-panel-3')?.addEventListener('click', openPanel);
  document.getElementById('btn-close-panel')?.addEventListener('click', closePanel);
  document.getElementById('panel-backdrop')?.addEventListener('click', closePanel);
  document.getElementById('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn=document.getElementById('btn-login'),errEl=document.getElementById('login-err');
    errEl.innerHTML=''; btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
    try {
      const {user}=await api('login',{username:document.getElementById('f-user').value.trim().toLowerCase(),password:document.getElementById('f-pass').value});
      console.log("LOGIN RESPONSE", user);
      setSession(user); closePanel(); showApp();
    } catch(err) {
      errEl.innerHTML=`<div class="login-err">${esc(err.message)}</div>`;
    } finally { btn.disabled=false; btn.innerHTML='Masuk'; }
  });
}

/*root*/
function showLanding(){ 
  document.getElementById('landing').style.display='';
  document.getElementById('app').classList.remove('visible');
  document.getElementById('app').style.display='none';
  document.documentElement.classList.add('lusion');
  document.getElementById('mob-actions').style.display='none';
  document.getElementById('bot-nav').style.display='none';
  document.getElementById('sidebar').style.display='none';
}
async function showApp(){ 
  document.getElementById('landing').style.display='none';
  document.getElementById('app').classList.add('visible');
  document.getElementById('app').style.display='';
  document.documentElement.classList.remove('lusion');
  document.getElementById('mob-actions').style.display='';
  document.getElementById('bot-nav').style.display='';
  document.getElementById('sidebar').style.display='';
  const ses = getSession();
  if (!ses) { showLanding(); return; }
  renderApp();

  // pastikan kode aslab sudah jadi array
  if (ses.role === 'aslab' && !Array.isArray(ses.kode)) {
    ses.kode = ses.kode ? ses.kode.split(',').map(k=>k.trim()).filter(Boolean) : [];
    setSession(ses);
  }

  renderApp();

  // paksa ganti password sementara — modal tidak bisa ditutup sampai diganti (F4)
  if (ses.must_change_password) {
    window._mustChangePassword = true;
    openEditModal(ses);
  }

  try {
    if (ses.role === 'praktikan') {
      const [mods,{grades},{schedules},{rotasi}] = await Promise.all([
        getMods(),
        api('getGrades',{username:ses.username}),
        api('getSchedules',{kelompok:ses.kelompok}),
        api('getRotasi',{kelompok:ses.kelompok}),
      ]);
      APP.modules=mods; APP.grades=grades; APP.schedules=schedules; APP.rotasi=rotasi;
    } else if (ses.role === 'aslab') {
      const [mods,{users},{rotasi}] = await Promise.all([
        getMods(),
        api('getUsers',{},true),
        api('getRotasi',{kode:ses.kode.join(',')}),
      ]);
      APP.modules=mods; APP.users=users; APP.rotasi=rotasi;
    } else {
      const [mods,{users}] = await Promise.all([getMods(),api('getUsers',{},true)]);
      APP.modules=mods; APP.users=users;
    }
    renderApp();
  } catch(_) {}
}

window.addEventListener('hashchange',()=>{ if(getSession()) renderApp(); });

const IC={
  profil: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.55 2.53a2 2 0 0 1 2.9 0l7.5 8A2 2 0 0 1 19.5 14H18v5a1 1 0 0 1-1 1h-3v-4h-4v4H7a1 1 0 0 1-1-1v-5H4.5a2 2 0 0 1-1.45-3.47l7.5-8z"/></svg>`,
  modul:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z"/><path d="M4 4v14a3 3 0 0 0 3 3h11"/></svg>`,
  jadwal:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>`,
  nilai:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 19V9M12 19V5M20 19v-7"/></svg>`,
  kontak:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  camera:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/></svg>`,
};

/*render app*/
function renderApp() {
  const ses=getSession(); if(!ses){showLanding();return;}
  // sidebar user info
  const sbName = document.getElementById('sb-name');
  const sbRole = document.getElementById('sb-role');
  const sbAv   = document.getElementById('sb-av');
  if (sbName) sbName.textContent = ses.name;
  if (sbRole) sbRole.textContent = roleLabel(ses);
  if (sbAv)   sbAv.innerHTML = ses.photo ? `<img src="${ses.photo}" alt="${esc(ses.name)}">` : initials(ses.name);

  // mobile actions
  const mobAv = document.getElementById('mob-av');
  if (mobAv) mobAv.innerHTML = ses.photo ? `<img src="${ses.photo}" alt="${esc(ses.name)}">` : initials(ses.name);
  const mobLogout = document.getElementById('btn-logout-mob');
  if (mobLogout) mobLogout.onclick = () => { clearSession(); CACHE={}; showLanding(); };

  window._currentSes = ses;
  document.getElementById('btn-logout-sb').onclick = () => { clearSession(); CACHE={}; showLanding(); };  const hash=window.location.hash.replace('#','')||'/';
  if(ses.role==='praktikan') renderPraktikan(hash,ses);
  else if(ses.role==='aslab') renderAslab(hash,ses);
  else renderAdmin(hash,ses);
}
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle');
  sb.classList.toggle('expanded');
  btn.textContent = sb.classList.contains('expanded') ? '‹' : '›';
  localStorage.setItem('sb_expanded', sb.classList.contains('expanded'));
}

function openEditModalFromSb() {
  const ses = getSession();
  if (ses) openEditModal(ses);
}

// restore sidebar state
function initSidebar() {
  const expanded = localStorage.getItem('sb_expanded') === 'true';
  if (expanded) {
    document.getElementById('sidebar')?.classList.add('expanded');
    const btn = document.getElementById('sidebar-toggle');
    if (btn) btn.textContent = '‹';
  }
}
function roleLabel(u){ 
  if(
    u.role==='admin'
  )
  return'Administrator';
  if(u.role==='aslab') return 'Asisten Lab — '+(Array.isArray(u.kode)?u.kode.join(', '):u.kode||'');
  return 'Praktikan · Kelompok '+u.kelompok; 
  return'Praktikan · Kelompok '+u.kelompok; 
}
function buildNav(items, active) {
  // sidebar
  const sbNav = document.getElementById('sb-nav');
  if (sbNav) {
    sbNav.innerHTML = items.map(n => `
      <a href="#${n.path}" class="sb-link${active===n.path?' active':''}" >
        ${IC[n.icon]}
        <span class="sb-label">${n.label}</span>
      </a>`).join('');
  }
  // bottom nav (mobile)
  const botNav = document.getElementById('bot-nav');
  if (botNav) {
    botNav.innerHTML = items.map(n => `
      <a href="#${n.path}" class="${active===n.path?'active':''}">
        ${IC[n.icon]}<span>${n.label}</span>
      </a>`).join('');
  }
}
function setContent(html){
  document.getElementById('content').innerHTML=html;
}
async function preloadData(ses) {

  const req = [
    getMods()
  ];

  if (ses.role === "praktikan") {
    req.push(api("getGrades", { username: ses.username }));
    req.push(api("getSchedules", { kelompok: ses.kelompok }));
  }

  if (ses.role === "aslab") {
    req.push(api("getUsers"));
    req.push(api("getSchedules", { judul: ses.judul }));
  }

  const result = await Promise.all(req);

  APP.modules = result[0];

  if (ses.role === "praktikan") {
    APP.grades = result[1].grades;
    APP.schedules = result[2].schedules;
  }

  if (ses.role === "aslab") {
    APP.users = result[1].users;
    APP.schedules = result[2].schedules;
  }

}

/*praktikan*/
const NAV_P=[{path:'/p/dashboard',label:'Dashboard',icon:'profil'},{path:'/p/modul',label:'Modul',icon:'modul'},
  {path:'/p/jadwal',label:'Jadwal',icon:'jadwal'},{path:'/p/nilai',label:'Nilai',icon:'nilai'},{path:'/p/kontak',label:'Kontak',icon:'kontak'}];

function renderPraktikan(hash,ses){
  const path=hash||'/p/dashboard'; const active=path; buildNav(NAV_P,active);
  switch(path){case'/p/modul':loadModulP(ses);break;case'/p/jadwal':loadJadwalP(ses);break;case'/p/nilai':loadNilaiP(ses);break;case'/p/kontak':loadKontakP(ses);break;default:loadProfilP(ses);}
}
async function loadProfilP(ses){
  setContent(loading());
  try{
    const[{grades},{schedules}]=await Promise.all([
      api('getGrades',{username:ses.username}),
      api('getSchedules',{kelompok:ses.kelompok})
    ]);
    const mods=await getMods();
    const done=grades.filter(g=>g.nilaiAkhir!=='').length;
    setContent(`<div class="phero">
      ${av(ses,'av-lg')}
      <div style="flex:1">
        <h2>Selamat Datang, ${esc(ses.name)}</h2>
        <p>NRP ${esc(ses.nrp||'—')} · Kelompok ${esc(ses.kelompok)}</p>
      </div>
      </div>
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>Judul</th>
              <th>Jadwal</th>
              <th>Nilai Akhir</th>
            </tr>
          </thead>
          <tbody>${mods.map(m=>{
            const s=schedules.find(x=>x.judul===m.id||x.judul===m.judul),g=grades.find(x=>x.judul===m.id||x.judul===m.judul);
            const na=g&&g.nilaiAkhir!==''?parseFloat(g.nilaiAkhir):null;
            return`<tr>
              <td>${esc(m.judul)}</td>
              <td>${s?fmtTgl(s.tanggal)+' · '+s.sesi:'<span class="tag">Belum dijadwalkan</span>'}</td>
              <td>${na!==null?`<span class="score-chip ${scoreClass(na)}">${na}</span>`:'<span class="tag">—</span>'}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
        </div>`);
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}
async function loadModulP(){
  setContent(loading('Memuat modul…'));
  try{
    const mods=await getMods();
    setContent(`<div class="ph"><span class="ey">Materi</span><h1>Modul Praktikum</h1></div>
      <div class="g g3">${mods.map((m,i)=>`
        <div class="card card-click" onclick='openViewer(${escAttr(JSON.stringify(m))})'>
          <span style="font-size:11px;color:var(--muted);display:block;margin-bottom:10px;">${String(i+1).padStart(2,'0')}</span>
          <h3>${esc(m.judul)}</h3><p>${esc(m.ringkas)}</p>
          <span class="tag ${m.fileType==='pdf'?'':'blue'}" style="margin-top:10px;font-size:10px;">${m.fileType==='pdf'?'PDF':'Docs'}</span>
        </div>`).join('')}</div>`);
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}
async function loadJadwalP(ses){
  setContent(loading());
  try{
    const[{rotasi},{schedules}]=await Promise.all([
      api('getRotasi',{kelompok:ses.kelompok}),
      api('getSchedules',{kelompok:ses.kelompok}),
    ]);
    setContent(`
    <div class="ph">
      <span class="ey">Jadwal</span>
      <h1>Jadwal Praktikum — Kelompok ${esc(ses.kelompok)}</h1>
    </div>
    <div class="g g3">
      ${rotasi.map(r=>{
          const s = schedules.find(x => (x.judul === r.judul || x.judul === r.judulPanjang) && +x.kelompokId === +ses.kelompok);        
          return`<div class="card" style="display:flex;flex-direction:column;gap:12px;padding:20px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div style="background:var(--blue);color:#fff;border-radius:10px;padding:6px 10px;
              font-size:12px;font-weight:700;letter-spacing:.03em;flex-shrink:0;">
              ${esc(r.kode||r.judul.slice(0,4).toUpperCase())}
            </div>
            <span class="tag ${s?'green':''}" style="font-size:11px;">${s?'Terjadwal':'Belum'}</span>
          </div>
          <div>
            <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:2px;">${esc(r.judulPanjang||r.judul)}</div>
            <div style="font-size:12px;color:var(--muted);">Minggu ke-${r.minggu||''}</div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:10px;display:flex;flex-direction:column;gap:6px;">
            <div style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/>
              </svg>
              ${esc(r.aslab||'—')}
            </div>
            <div style="background:var(--off);border-left:3px solid ${s?'var(--blue)':'var(--border)'};
              padding:7px 10px;border-radius:0 8px 8px 0;font-size:13px;font-weight:500;color:var(--text);">
              ${s?fmtTgl(s.tanggal)+' · '+s.sesi:'Belum dijadwalkan'}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`);
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}
async function loadNilaiP(ses){
  setContent(loading());
  try{
    const[mods,{grades}]=await Promise.all([getMods(),api('getGrades',{username:ses.username})]);
    setContent(`<div class="ph"><span class="ey">Evaluasi</span><h1>Nilai Praktikum</h1></div>
      <div class="nilai-accordion">
        ${mods.map(m=>{
          const g=grades.find(x=>x.judul===m.id||x.judul===m.judul)||{};
          const total=g.nilaiAkhir||hitungTotal(g)||null;
          const hasCat=KOMP.some(k=>g[k.cat]);
          return`<div class="ncard" id="nc-${m.id}">
            <div class="ncard-head" onclick="toggleNcard('${m.id}')">
              <span class="ncard-title">${esc(m.judul)}</span>
              <div class="ncard-meta">
                ${hasCat?`<span class="tag amber" style="font-size:10px;">Ada catatan</span>`:''}
                ${total?`<span class="ncard-total">${parseFloat(total).toFixed(2)}</span>`:'<span class="tag" style="font-size:11px;">Belum dinilai</span>'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--muted);transition:transform .2s;" class="ncard-chevron"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>
            <div class="ncard-body">
              <div class="ncard-rows">
                ${KOMP.map(k=>{
                  const score=g[k.key]!==undefined&&g[k.key]!==''?g[k.key]:null;
                  const cat=g[k.cat]||'';
                  return`<div class="nrow">
                    <div class="nrow-label">${k.label}<span class="nrow-bobot">(${k.bobot}%)</span></div>
                    <div class="nrow-score${score===null?' na':''}">${score!==null?score:'—'}</div>
                    ${cat?`<div class="nrow-cat">✎ ${esc(cat)}</div>`:`<div class="nrow-cat empty">Belum ada catatan</div>`}
                  </div>`;}).join('')}
              </div>
            </div>
          </div>`;}).join('')}
      </div>`);
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}
function toggleNcard(id){
  const el=document.getElementById('nc-'+id);
  el.classList.toggle('open');
  const ch=el.querySelector('.ncard-chevron');
  if(ch) ch.style.transform=el.classList.contains('open')?'rotate(180deg)':'';
}
async function loadKontakP(ses){
  setContent(loading());
  try{
    const[{users},mods]=await Promise.all([api('getUsers', {}, true),getMods()]);
    const list=users.filter(u=>u.role==='aslab'&&Array.isArray(u.kelompok)&&u.kelompok.includes(+ses.kelompok));
    setContent(`
      <div class="ph"><h1>Kontak Asisten Lab</h1></div>
      <div class="g g2">
        ${list.map(a=>{
          const waNum = a.wa ? a.wa.replace(/\D/g,'') : '';
          return`<div class="card" style="padding:0;overflow:hidden;border-radius:20px;cursor:pointer;"
          onclick="openKontakPanel('${escAttr(a.name)}','${Array.isArray(a.kode)?escAttr(a.kode.join(', ')):''}','${a.photo||''}','${initials(a.name)}','${waNum}')"            <!-- header gradient -->
            <div style="height:110px;background:linear-gradient(135deg,#1B39B0,#8C4FEB,#FEA3DB);position:relative;">
              <div style="position:absolute;bottom:-28px;left:20px;
                width:56px;height:56px;border-radius:50%;border:3px solid var(--surface);overflow:hidden;
                background:var(--blue);display:flex;align-items:center;justify-content:center;
                font-size:18px;font-weight:700;color:#fff;">
                ${a.photo?`<img src="${a.photo}" style="width:100%;height:100%;object-fit:cover;">`:`${initials(a.name)}`}
              </div>
            </div>
            <!-- content -->
            <div style="padding:38px 20px 20px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div>
                <div style="font-size:15px;font-weight:600;color:var(--text);">${esc(a.name)}</div>
                <div style="font-size:12px;color:var(--muted);margin-top:2px;">Asisten Laboratorium</div>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`);
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}
function openKontakPanel(name, judul, photo, inits, waNum) {
  const ses = getSession();

  document.getElementById('modal-root').innerHTML = `
  <div class="modal-back" id="kback">
    <div class="modal" style="padding:0;overflow:hidden;max-width:400px;border-radius:24px;">
      <!-- header -->
      <div style="height:130px;background:linear-gradient(135deg,#1B39B0,#8C4FEB,#FEA3DB);position:relative;flex-shrink:0;">
        <button onclick="closeModal()" style="position:absolute;top:14px;right:14px;
          width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.25);
          display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;cursor:pointer;">✕</button>
        <div style="position:absolute;bottom:-30px;left:50%;transform:translateX(-50%);
          width:62px;height:62px;border-radius:50%;border:3px solid var(--surface);overflow:hidden;
          background:var(--blue);display:flex;align-items:center;justify-content:center;
          font-size:20px;font-weight:700;color:#fff;">
          ${photo?`<img src="${photo}" style="width:100%;height:100%;object-fit:cover;">`:`${inits}`}
        </div>
      </div>
      <!-- body -->
      <div style="padding:44px 24px 24px;text-align:center;">
        <div style="font-size:17px;font-weight:600;color:var(--text);margin-bottom:4px;">${esc(name)}</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:24px;">Asisten Laboratorium</div>
        <!-- template tetap, hanya bagian isi yang diedit -->
        <div style="background:var(--off);border:1px solid var(--border);border-radius:14px;
          padding:14px;font-size:13px;color:var(--muted);text-align:left;margin-bottom:12px;line-height:1.7;">
          Halo Kak <b style="color:var(--text);">${esc(name)}</b>, perkenalkan saya:<br>
          Nama: <b style="color:var(--text);">${esc(ses.name)}</b><br>
          NRP: <b style="color:var(--text);">${esc(ses.nrp||'—')}</b><br>
          Kelompok: <b style="color:var(--text);">${esc(ses.kelompok)}</b>
        </div>
        <textarea id="pesanTA" rows="3" style="width:100%;border:1px solid var(--border);border-radius:14px;
          padding:14px;font-size:13px;resize:none;
          background:var(--off);color:var(--text);font-family:inherit;text-align:left;"
          placeholder="Tulis keperluanmu di sini…"></textarea>
        ${waNum
          ?`<a id="waLink" href="#"
              onclick="event.preventDefault();kirimWA('${escAttr(waNum)}','${escAttr(name)}','${encodeURIComponent(ses.name)}','${escAttr(ses.nrp||'')}','${escAttr(String(ses.kelompok))}')"
              style="display:flex;align-items:center;justify-content:center;gap:8px;
                width:100%;height:50px;margin-top:14px;border-radius:100px;
                background:var(--blue);color:#fff;font-size:14px;font-weight:600;cursor:pointer;">
              Kirim Pesan via WhatsApp
            </a>`
          :`<div class="tag" style="margin-top:14px;width:100%;justify-content:center;">Nomor WA belum diisi</div>`}
      </div>
    </div>
  </div>`;

  document.getElementById('kback').addEventListener('click', e => { if(e.target.id==='kback') closeModal(); });

  const ta = document.getElementById('pesanTA');
  const waLink = document.getElementById('waLink');
  if (ta && waLink && waNum) {
    
  }
}
function kirimWA(waNum, aslabName, namaEnc, nrp, kelompok) {
  console.log('waNum raw:', waNum);
  const isi = document.getElementById('pesanTA')?.value || '';
  const nama = decodeURIComponent(namaEnc);
  const num = waNum.startsWith('0') ? '62'+waNum.slice(1) : waNum;
  console.log('num final:', num);
  const template =
`Halo Kak ${aslabName}, perkenalkan saya:

Nama: ${nama}
NRP: ${nrp||'—'}
Kelompok: ${kelompok}

${isi}

Kamsia`;
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(template)}`, '_blank');
}

/*aslab*/
const NAV_A=[{path:'/a/jadwal',label:'Jadwal',icon:'jadwal'},{path:'/a/nilai',label:'Nilai',icon:'nilai'},{path:'/a/profil',label:'Profil',icon:'profil'}];
function renderAslab(hash,ses){const path=hash||'/a/jadwal';buildNav(NAV_A,path);
  switch(path){case'/a/nilai':loadNilaiA(ses);break;case'/a/profil':loadProfilA(ses);break;default:loadJadwalA(ses);}
}
function loadProfilA(ses){
  console.log("SESSION", JSON.stringify(ses, null, 2));
  setContent(`<div class="phero">${av(ses,'av-lg')}<div style="flex:1"><h2>${esc(ses.name)}</h2><p>Asisten Lab</p></div>
    </div>
    <div class="g g2">
      <div class="card"><h3>${Array.isArray(ses.kelompok)?ses.kelompok.length:0} Kelompok</h3><p>Kelompok ${Array.isArray(ses.kelompok)?esc(ses.kelompok.join(', ')):esc(ses.kelompok)}</p></div>
      <div class="card">
        <h3 style="font-size:15px;">
          ${esc(Array.isArray(ses.kode)?ses.kode.join(', '):ses.kode)}
        </h3>
        <p>Judul yang kamu pegang</p>
      </div>
    </div>`);
}
async function loadJadwalA(ses){
  setContent(loading());
  const kodeList = Array.isArray(ses.kode) ? ses.kode : [];
  try{
    const mods    = APP.modules || await getMods();
    const myMods  = mods.filter(m => kodeList.includes(m.kode));

    // ambil rotasi yang relevan (sudah ada di APP dari preload)
    let rotasi = APP.rotasi || (await api('getRotasi',{kode:kodeList.join(',')})).rotasi;

    // ambil semua schedules untuk judul-judul yang dipegang
    const judulList = myMods.map(m=>m.judul);
    const allSchedules = await Promise.all(
      judulList.map(j => api('getSchedules',{judul:j}).then(r=>r.schedules))
    );
    const schedules = allSchedules.flat();

    setContent(`
    <div class="ph"><span class="ey">Pengaturan</span><h1>Jadwal Praktikum</h1></div>
    ${myMods.map(mod=>{
      const myRotasi = rotasi.filter(r => (r.kode === mod.kode || r.judul === mod.judul) && r.aslab === ses.name);      if(!myRotasi.length) return '';
      return`
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <span style="background:var(--blue);color:#fff;border-radius:8px;padding:4px 10px;
            font-size:12px;font-weight:700;">${esc(mod.kode)}</span>
          <span style="font-size:15px;font-weight:500;color:var(--text);">${esc(mod.judul)}</span>
        </div>
        <div class="g g2">
          ${myRotasi.map(r=>{
            const s = schedules.find(x => x.judul===mod.judul && +x.kelompokId===+r.kelompok);
            return`<div class="card">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <h3>Kelompok ${esc(r.kelompok)}</h3>
                <span class="tag" style="font-size:11px;">Minggu ke-${esc(r.minggu)}</span>
              </div>
              <p style="margin-bottom:14px;font-size:13px;color:var(--muted);">
                ${s?'Terjadwal: '+fmtTgl(s.tanggal)+' · '+esc(s.sesi):'Belum dijadwalkan'}
              </p>
              <form onsubmit="submitJadwal(event,'${escAttr(r.kelompok)}','${escAttr(mod.judul)}','${escAttr(ses.username)}')">
                <div class="fr">
                  <div class="ff"><label>Tanggal</label>
                    <input type="date" name="tanggal" value="${s?s.tanggal:''}" required></div>
                  <div class="ff"><label>Sesi</label>
                    <select name="sesi">${['Sesi 1 (08.00)','Sesi 2 (10.00)','Sesi 3 (13.00)','Sesi 4 (15.00)'].map(x=>`<option ${s&&s.sesi===x?'selected':''}>${x}</option>`).join('')}</select>
                  </div>
                </div>
                <div style="margin-top:12px;display:flex;gap:10px;">
                  <button type="submit" class="btn btn-primary btn-sm">Simpan</button>
                  ${s?`<button type="button" class="btn btn-ghost-dk btn-sm"
                    onclick="hapusJadwal('${escAttr(r.kelompok)}','${escAttr(mod.judul)}','${escAttr(ses.username)}')">Hapus</button>`:''}
                </div>
              </form>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}`);
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}
async function submitJadwal(e,kelompokId,judul,setBy){
  e.preventDefault();const fd=new FormData(e.target);const btn=e.target.querySelector('button[type=submit]');
  btn.disabled=true;btn.textContent='Menyimpan…';
  try{
    await api('setSchedule',
    {kelompokId:+kelompokId,judul,tanggal:fd.get('tanggal'),
    sesi:fd.get('sesi'),setBy});
    CACHE = {};
    APP.schedules = null;
    toast(`Jadwal kelompok ${kelompokId} tersimpan.`);renderApp();
  }
  catch(err){toast('Gagal: '+err.message);btn.disabled=false;btn.textContent='Simpan';}
}
async function hapusJadwal(kelompokId,judul,setBy){
  if(!confirm(`Hapus jadwal kelompok ${kelompokId}?`))return;
  try{await api('setSchedule',{kelompokId:+kelompokId,judul,tanggal:'',sesi:'',setBy});toast('Jadwal dihapus.');renderApp();}
  catch(err){toast('Gagal: '+err.message);}
}

async function loadNilaiA(ses){
  setContent(loading());
  const kodeList = Array.isArray(ses.kode) ? ses.kode : [];
  try{
    const [mods,{users}] = await Promise.all([getMods(), api('getUsers',{},true)]);
    const myMods = mods.filter(m => kodeList.includes(m.kode));
    const rotasi = APP.rotasi || (await api('getRotasi',{kode:kodeList.join(',')})).rotasi;
    window._aUsers=users; window._aSes=ses; window._rotasi=rotasi; window._myMods=myMods;

    setContent(`
    <div class="ph"><span class="ey">Penilaian</span><h1>Input Nilai</h1></div>
    <div class="fr" style="max-width:900px;margin-bottom:22px;">
      <div class="ff"><label>Modul</label>
        <select id="a-mod-sel" onchange="aModChange(this)">
          <option value="">Pilih modul</option>
          ${myMods.map(m=>`<option value="${esc(m.judul)}">${esc(m.kode)} — ${esc(m.judul)}</option>`).join('')}
        </select></div>
      <div class="ff"><label>Kelompok</label>
        <select id="a-grp-sel" disabled onchange="aGrpChange(this)">
          <option value="">Pilih modul dahulu</option></select></div>
      <div class="ff"><label>Praktikan</label>
        <select id="a-stu-sel" disabled onchange="aStuChange(this)">
          <option>Pilih kelompok dahulu</option></select></div>
    </div>
    <div id="a-grade-wrap"></div>
    <div id="a-riwayat-wrap"></div>`);

    // load riwayat semua modul sekaligus
    const judulList = myMods.map(m => m.judul);
    const allGrades = await Promise.all(judulList.map(j => api('getGrades',{judul:j}).then(r=>r.grades)));
    const semua = allGrades.flat().filter(g => g.nilaiAkhir !== '');
    const wrap = document.getElementById('a-riwayat-wrap');
    if (semua.length > 0) {
      wrap.innerHTML = `
      <div class="ph" style="margin-top:32px;"><span class="ey">Riwayat</span><h1>Sudah Dinilai</h1></div>
      <div class="tw"><table class="riwayat-table">
        <thead><tr><th>Nama</th><th>Modul</th><th>Kelompok</th><th>Total Akhir</th><th>Diinput</th></tr></thead>
        <tbody>${semua.map(g=>{
          const u=(users||[]).find(x=>x.username===g.username);
          const mod=myMods.find(m=>m.judul===g.judul);
          return`<tr>
            <td>${u?esc(u.name):esc(g.username)}</td>
            <td>${mod?`<span class="tag blue" style="font-size:10px;">${esc(mod.kode)}</span>`:esc(g.judul)}</td>
            <td>${u?esc(u.kelompok):'—'}</td>
            <td><span class="score-chip ${scoreClass(g.nilaiAkhir)}">${parseFloat(g.nilaiAkhir).toFixed(2)}</span></td>
            <td style="font-size:12px;color:var(--muted);">${g.updatedAt?new Date(g.updatedAt).toLocaleString('id-ID',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'-'}</td>
          </tr>`;}).join('')}
        </tbody></table></div>`;
    }
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}

function aModChange(sel){
  const grp=document.getElementById('a-grp-sel');
  const stu=document.getElementById('a-stu-sel');
  document.getElementById('a-grade-wrap').innerHTML='';
  document.getElementById('a-riwayat-wrap').innerHTML='';
  if(!sel.value){
    grp.disabled=true;grp.innerHTML='<option>Pilih modul dahulu</option>';
    stu.disabled=true;stu.innerHTML='<option>Pilih kelompok dahulu</option>';
    return;
  }
  // filter kelompok dari rotasi berdasarkan judul yang dipilih
  const rotasi = window._rotasi||[];
  const kelompoks = [...new Set(
    rotasi.filter(r=>r.judul===sel.value).map(r=>r.kelompok)
  )].sort((a,b)=>+a-+b);

  grp.disabled=false;
  grp.innerHTML='<option value="">Pilih kelompok</option>'+
    kelompoks.map(g=>`<option value="${g}">Kelompok ${g}</option>`).join('');
  stu.disabled=true;
  stu.innerHTML='<option>Pilih kelompok dahulu</option>';

  // tampilkan riwayat
  loadRiwayatNilai(sel.value);
}

async function loadRiwayatNilai(judul){
  const wrap=document.getElementById('a-riwayat-wrap');
  try{
    const{grades}=await api('getGrades',{judul});
    const done=grades.filter(g=>g.nilaiAkhir!=='');
    if(!done.length){wrap.innerHTML='';return;}
    wrap.innerHTML=`
    <div class="ph" style="margin-top:32px;"><span class="ey">Riwayat</span><h1>Sudah Dinilai</h1></div>
    <div class="tw"><table class="riwayat-table">
      <thead><tr><th>Nama</th><th>Kelompok</th><th>Total Akhir</th><th>Diinput</th></tr></thead>
      <tbody>${done.map(g=>{
        const u=(window._aUsers||[]).find(x=>x.username===g.username);
        return`<tr>
          <td>${u?esc(u.name):esc(g.username)}</td>
          <td>${u?esc(u.kelompok):'—'}</td>
          <td><span class="score-chip ${scoreClass(g.nilaiAkhir)}">${parseFloat(g.nilaiAkhir).toFixed(2)}</span></td>
          <td style="font-size:12px;color:var(--muted);">${g.updatedAt?new Date(g.updatedAt).toLocaleString('id-ID',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'-'}</td>
        </tr>`;}).join('')}
      </tbody></table></div>`;
  }catch(_){wrap.innerHTML='';}
}

function aGrpChange(sel){
  const stu=document.getElementById('a-stu-sel');
  document.getElementById('a-grade-wrap').innerHTML='';
  if(!sel.value){stu.disabled=true;stu.innerHTML='<option>Pilih kelompok dahulu</option>';return;}
  const list=(window._aUsers||[]).filter(u=>u.role==='praktikan'&&+u.kelompok===+sel.value);
  stu.disabled=false;
  stu.innerHTML='<option value="">Pilih praktikan</option>'+
    list.map(u=>`<option value="${esc(u.username)}">${esc(u.name)}</option>`).join('');
}

async function aStuChange(sel){
  const wrap=document.getElementById('a-grade-wrap');
  if(!sel.value){wrap.innerHTML='';return;}
  const judul=document.getElementById('a-mod-sel').value;
  const setBy=window._aSes.username;
  wrap.innerHTML=loading('Memuat nilai…');
  try{
    const{grades}=await api('getGrades',{username:sel.value,judul});
    const g=grades[0]||{};
    const u=(window._aUsers||[]).find(x=>x.username===sel.value);
    const total=hitungTotal(g);
    wrap.innerHTML=`
    <div class="card">
      <h3 style="margin-bottom:20px;">Nilai untuk ${u?esc(u.name):esc(sel.value)}</h3>
      <form onsubmit="submitNilaiA(event,'${escAttr(sel.value)}','${escAttr(judul)}','${escAttr(setBy)}')">
        <div class="total-preview">
          <div class="label">Total Akhir (auto-hitung)</div>
          <div class="score" id="total-preview-val">${total?total.toFixed(2):'—'}</div>
        </div>
        <div class="nform-grid">
          ${KOMP.map(k=>`
          <div class="nform-row">
            <div class="nform-label"><b>${k.label}</b><span>Bobot ${k.bobot}%</span></div>
            <div class="nform-num"><input type="number" name="${k.key}" min="0" max="100"
              value="${g[k.key]||''}" placeholder="—" oninput="updateTotal(this.form)"></div>
            <div class="nform-cat"><textarea name="${k.cat}"
              placeholder="Catatan…" rows="1">${esc(g[k.cat]||'')}</textarea></div>
          </div>`).join('')}
        </div>
        <button type="submit" class="btn btn-primary" id="btn-save-grade"
          style="width:100%;height:50px;font-size:15px;">
          Simpan Nilai &amp; Catatan
        </button>
      </form>
    </div>`;
  }catch(err){wrap.innerHTML=`<p style="color:red">${esc(err.message)}</p>`;}
}

async function submitNilaiA(e,username,judul,setBy){
  e.preventDefault();const fd=new FormData(e.target);
  const btn=e.target.querySelector('#btn-save-grade');
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span> Menyimpan…';
  const body={username,judul,setBy,catatan:fd.get('catatan')||''};
  KOMP.forEach(k=>{body[k.key]=fd.get(k.key)||'';body[k.cat]=fd.get(k.cat)||'';});
  body.nilaiAkhir=hitungTotal(body).toFixed(2);
  try{
    await api('setGrade',body);
    CACHE={};APP.grades=null;
    toast('Nilai & catatan tersimpan.');
    // refresh riwayat
    loadRiwayatNilai(judul);
  }catch(err){toast('Gagal: '+err.message);}
  finally{btn.disabled=false;btn.innerHTML='Simpan Nilai & Catatan';}
}

/*admin anjy*/
const NAV_AD=[{path:'/ad/nilai',label:'Nilai',icon:'nilai'},{path:'/ad/pengguna',label:'Profil',icon:'profil'}];
function renderAdmin(hash,ses){const path=hash||'/ad/nilai';buildNav(NAV_AD,path);
  path==='/ad/pengguna'?loadAdminPengguna(ses):loadAdminNilai();}
async function loadAdminNilai(){
  setContent(loading());
  try{
    const{users}=await api('getUsers', {}, true);window._adUsers=users;
    const kelompoks=[...new Set(users.filter(u=>u.role==='praktikan').map(u=>u.kelompok))].sort((a,b)=>+a-+b);
    setContent(`
    <div class="ph">
      <span class="ey">Administrasi</span>
      <h1>Rekap Nilai</h1>
      <p>Pilih kelompok lalu pilih praktikan.</p>
    </div>
    <div class="fr" style="max-width:600px;margin-bottom:22px;">
      <div class="ff">
        <label>Kelompok</label>
        <select id="ad-grp-sel" onchange="adGrpChange(this)">
        <option value="">Pilih kelompok</option>${kelompoks.map(g=>`<option value="${esc(g)}">Kelompok ${esc(g)}</option>`).join('')}
        </select>
      </div>
      <div class="ff">
        <label>Praktikan</label>
        <select id="ad-stu-sel" disabled onchange="adStuChange(this)">
          <option>Pilih kelompok dahulu</option>
        </select>
      </div>
    </div>
    <div id="ad-grade-wrap"></div>`);
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}
function adGrpChange(sel){
  const stu=document.getElementById('ad-stu-sel');document.getElementById('ad-grade-wrap').innerHTML='';
  if(!sel.value){stu.disabled=true;stu.innerHTML='<option>Pilih kelompok dahulu</option>';return;}
  const list=(window._adUsers||[]).filter(u=>u.role==='praktikan'&&+u.kelompok===+sel.value);
  stu.disabled=false;stu.innerHTML='<option value="">Pilih praktikan</option>'+list.map(u=>`<option value="${esc(u.username)}">${esc(u.name)}</option>`).join('');
}
async function adStuChange(sel){
  const wrap=document.getElementById('ad-grade-wrap');if(!sel.value){wrap.innerHTML='';return;}
  wrap.innerHTML=loading();
  try{
    const[mods,{grades}]=await Promise.all([getMods(),api('getGrades',{username:sel.value}, true)]);
    const u=(window._adUsers||[]).find(x=>x.username===sel.value);
    wrap.innerHTML=`
    <div class="tw">
      <table>
      <thead><tr><th>Judul</th>${KOMP.map(k=>`<th>${k.label}<br><small style="font-weight:400;color:var(--muted)">${k.bobot}%</small></th>`).join('')}<th>Total</th></tr></thead>
      <tbody>${mods.map(m=>{const g=grades.find(x=>x.judul===m.id||x.judul===m.judul)||{};const total=g.nilaiAkhir||hitungTotal(g)||null;
        return`<tr><td style="font-weight:500">${esc(m.judul)}</td>
          ${KOMP.map(k=>`<td>${g[k.key]!==undefined&&g[k.key]!==''?g[k.key]:'—'}</td>`).join('')}
          <td>${total?`<span class="score-chip ${scoreClass(total)}">${parseFloat(total).toFixed(2)}</span>`:'—'}</td>
        </tr>`;}).join('')}
      </tbody></table></div>`;
  }catch(err){wrap.innerHTML=`<p style="color:red">${esc(err.message)}</p>`;}
}
async function loadAdminPengguna(ses){
  setContent(loading());
  try{
    const[{users},mods]=await Promise.all([api('getUsers', {}, true),getMods()]);
    const aslabs=users.filter(u=>u.role==='aslab'),prak=users.filter(u=>u.role==='praktikan');
    setContent(`
    <div class="phero">${av(ses,'av-lg')}
      <div style="flex:1">
        <h2>${esc(ses.name)}</h2>
        <p>Administrator Laboratorium</p>
      </div>
      <button class="btn btn-white btn-sm" onclick='openEditModal(${escAttr(JSON.stringify(ses))})'>Edit Profil</button>
    </div> 
    <div class="ph">
      <span class="ey">Administrasi</span>
      <h1>Daftar Pengguna</h1>
    </div>
      <span class="slabel">Asisten Lab (${aslabs.length})</span>
      <div class="g g3" style="margin-bottom:28px;">${aslabs.map(a=>{
        return`<div class="card">
          <h3>${esc(a.name)}</h3>
          <p>${Array.isArray(a.kode)&&a.kode.length?esc(a.kode.join(', ')):'—'}</p>
          <span class="tag blue" style="margin-top:8px;">Kelompok ${Array.isArray(a.kelompok)?esc(a.kelompok.join(', ')):esc(a.kelompok)}</span>
          </div>`;}).join('')}
      </div>
      <span class="slabel">Praktikan (${prak.length})</span>
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>Nama</th>
              <th>NRP</th>
              <th>Kelompok</th>
              <th>Username</th>
            </tr>
          </thead>
          <tbody>${prak.map(p=>`<tr>
            <td>${esc(p.name)}</td>
            <td>${esc(p.nrp||'—')}</td>
            <td>${esc(p.kelompok)}</td>
            <td>${esc(p.username)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`);
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}

let _pp=null;
const closeModal=()=>{
  if(window._mustChangePassword) return;  // blokir sampai password diganti
  document.getElementById('modal-root').innerHTML='';_pp=null;
};
function openEditModal(ses){
  if(typeof ses==='string') ses=JSON.parse(ses.replace(/&quot;/g,'"'));
  _pp=null;
  const mcp = !!window._mustChangePassword;
  document.getElementById('modal-root').innerHTML=`
  <div class="modal-back" id="m-back">
    <div class="modal">
      ${mcp?'':'<button class="modal-close" onclick="closeModal()">✕</button>'}
      <h3>${mcp?'Wajib Ganti Password':'Edit Profil'}</h3>
      ${mcp?'<div class="merr" style="margin-bottom:16px;">Akun Anda menggunakan password sementara. Wajib ganti password sebelum bisa melanjutkan.</div>':''}
      <div class="photo-row">
        <div id="pp">${av(ses)}</div>
        <label class="btn btn-white btn-sm" style="cursor:pointer;">${IC.camera} Ganti Foto
          <input type="file" accept="image/*" id="photo-inp" style="display:none;">
        </label>
      </div>
      <form id="edit-form">
        <div id="edit-err"></div>
        <div class="mfield">
          <label>Password Saat Ini
            <span style="color:#aaa;font-weight:400;">(isi jika ingin ganti password)</span>
          </label>
          <input type="password" id="cur-p" placeholder="Kosongkan jika hanya ganti foto">
        </div>
        <div class="mfield">
          <label>Password Baru</label>
          <input type="password" id="new-p" placeholder="Min. 6 karakter">
        </div>
        <div class="mfield" style="margin-bottom:20px;">
          <label>Konfirmasi Password Baru</label>
          <input type="password" id="conf-p" placeholder="Ulangi password baru">
        </div>
        <button type="submit" class="btn btn-primary btn-block" id="btn-sp" style="height:50px;">Simpan Perubahan</button>
      </form>
    </div>
  </div>`;
  document.getElementById('m-back').onclick=e=>{if(e.target.id==='m-back')closeModal();};
  document.getElementById('photo-inp').onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    if(f.size>2*1024*1024){document.getElementById('edit-err').innerHTML='<div class="merr">Ukuran foto maks. 2MB.</div>';return;}
    const r=new FileReader();r.onload=()=>{_pp=r.result;
      document.getElementById('pp').innerHTML=`<div class="av"><img src="${_pp}" alt="preview"></div>`;
      document.getElementById('edit-err').innerHTML='';};r.readAsDataURL(f);
  };
  document.getElementById('edit-form').onsubmit=async e=>{
    e.preventDefault();
    const err=document.getElementById('edit-err'),curP=document.getElementById('cur-p').value,newP=document.getElementById('new-p').value,confP=document.getElementById('conf-p').value;
    if(mcp&&!newP){
      err.innerHTML='<div class="merr">Wajib mengisi password baru.</div>';
      return;
    }
    if(!_pp&&!newP&&!confP){
      err.innerHTML='<div class="merr">Belum ada perubahan.</div>';
      return;
    }
    if(newP||confP){
      if(newP.length<6){
        err.innerHTML='<div class="merr">Password baru min. 6 karakter.</div>';
        return;
      }
      if(newP!==confP){
        err.innerHTML='<div class="merr">Konfirmasi tidak cocok.</div>';
        return;
      }
    }
    const btn=document.getElementById('btn-sp');btn.disabled=true;btn.innerHTML='<span class="spinner spinner-dk"></span> Menyimpan…';
    try{
      const result=await api('updateProfile',{username:ses.username,oldPassword:curP,newPassword:newP||undefined,photo:_pp||undefined});
      if(result.user&&result.user.photo) ses.photo=result.user.photo;
      ses.must_change_password=false;
      setSession(ses);
      window._mustChangePassword=false;
      closeModal();toast('Profil berhasil diperbarui.');renderApp();
    }
    catch(ex){err.innerHTML=`<div class="merr">${esc(ex.message)}</div>`;btn.disabled=false;btn.innerHTML='Simpan Perubahan';}
  };
}

function applyTheme(mode) {
  document.documentElement.classList.remove('light','dark');
  document.documentElement.classList.add(mode);
  localStorage.setItem('lp_theme', mode);
  const icon = document.getElementById('theme-icon');
  if (!icon) return;
  icon.innerHTML = mode === 'dark'
    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  const iconMob = document.getElementById('theme-icon-mob');
  if (iconMob) iconMob.innerHTML = icon.innerHTML;
}
function toggleTheme() {
  const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

document.addEventListener('DOMContentLoaded',()=>{
  applyTheme(localStorage.getItem('lp_theme') || 'light');
  initSidebar();
  initCursor();initWebGL();initLoginPanel();loadLandingModules();
  const ses=getSession();if(ses){showApp();}else{showLanding();}
});
