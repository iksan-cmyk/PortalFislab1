'use strict';

/*aslab*/
const NAV_A=[{path:'/a/jadwal',label:'Jadwal',icon:'jadwal'},{path:'/a/katalog',label:'Katalog',icon:'jadwal'},{path:'/a/nilai',label:'Nilai',icon:'nilai'},{path:'/a/modul',label:'Modul',icon:'modul'},{path:'/a/profil',label:'Profil',icon:'profil'}];
function renderAslab(hash,ses){const path=hash||'/a/jadwal';buildNav(NAV_A,path);
  switch(path){case'/a/katalog':loadKatalogA(ses);break;case'/a/nilai':loadNilaiA(ses);break;case'/a/modul':loadModulA(ses);break;case'/a/profil':loadProfilA(ses);break;default:loadJadwalA(ses);}
}

const SESI = ['07.00-08.40','09.00-10.40','11.00-12.40','13.30-15.10','15.30-17.10','18.30-20.20'];
const MAX_KELOMPOK_PER_SESI = 3; // batas umum trigger DB (0016_perbaikan_aturan_jadwal.sql)
// _jadwalSesi: array jadwal lintas-aslab dari RPC getJadwalKelompokModul (punya moduleId & kelompok).
// Diisi saat loadJadwalA; dipakai terisiCount & cekBatasSesiClient.
window._jadwalSesi = null;
function getSesiOptions(tanggal){
  return SESI;
}
// terisiCount: hitung baris jadwal LAIN di slot yang sama, exclude baris sendiri (own).
// own = {moduleId, kelompok}. Mengambil data dari window._jadwalSesi.
function terisiCount(tanggal, sesi, own){
  if(!Array.isArray(window._jadwalSesi) || !tanggal) return 0;
  return window._jadwalSesi.filter(j =>
    j.tanggal === tanggal && j.sesi === sesi &&
    !(own && j.moduleId === own.moduleId && +j.kelompok === +own.kelompok)
  ).length;
}
// sesiOptionsHtml: opsi sesi + indikator terisi (x/3) atau disabled "Penuh" jika sudah 3.
// Opsi yang sama dengan currentSesi TIDAK boleh disabled (bug lama: opsi terpilih yang
// disabled tidak ikut terkirim form -> sesi null saat aslab simpan ulang slot sendiri di
// slot yang sudah penuh). (Tugas 3.3)
function sesiOptionsHtml(tanggal, currentSesi, own){
  return getSesiOptions(tanggal).map(x=>{
    const c = terisiCount(tanggal, x, own);
    const full = c >= MAX_KELOMPOK_PER_SESI;
    const label = full ? x+' (Penuh)' : (c>0 ? x+' ('+c+'/'+MAX_KELOMPOK_PER_SESI+')' : x);
    const isCurrent = x === currentSesi;
    // disabled hanya bila penuh DAN bukan opsi yang sedang terpilih.
    const dis = full && !isCurrent ? 'disabled' : '';
    return `<option value="${esc(x)}" ${isCurrent?'selected':''} ${dis}>${esc(label)}</option>`;
  }).join('');
}
function updateSesiOptions(dateInput){
  const form = dateInput.closest('form');
  const select = form.querySelector('select[name="sesi"]');
  const own = { moduleId: form.dataset.modul, kelompok: form.dataset.kelompok };
  const current = select.value;
  select.innerHTML = sesiOptionsHtml(dateInput.value, current, own);
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

    // ambil jadwal lintas-aslab dengan module_id + kelompok (RPC 0011) untuk
    // indikator terisi & pra-pengecekan batas umum 3 kelompok di sisi klien.
    // Gagal ambil -> indikator & pra-cek nonaktif; trigger DB tetap sumber kebenaran.
    // Halaman Katalog tetap memakai getKatalogJadwal (tidak diubah di sini).
    try {
      const { jadwal: jadwalAll } = await api('getJadwalKelompokModul');
      window._jadwalSesi = jadwalAll || [];
    } catch(_) { window._jadwalSesi = null; }

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
              <form data-modul="${escAttr(mod.id)}" data-kelompok="${escAttr(r.kelompok)}" onsubmit="submitJadwal(event,'${escAttr(r.kelompok)}','${escAttr(mod.judul)}','${escAttr(ses.username)}')">
                <input type="hidden" name="updatedAt" value="${s?esc(s.updatedAt):''}">
                <div class="fr">
                  <div class="ff"><label>Tanggal</label>
                <input type="date" name="tanggal" value="${s?s.tanggal:''}" required onchange="updateSesiOptions(this)"></div>
              <div class="ff"><label>Sesi</label>
                <select name="sesi">${sesiOptionsHtml(s?s.tanggal:'', s?s.sesi:'', {moduleId: mod.id, kelompok: r.kelompok})}</select>
              </div>
                </div>
                <div style="margin-top:12px;display:flex;gap:10px;">
                  <button type="submit" class="btn btn-primary btn-sm">Simpan</button>
                  ${s?`<button type="button" class="btn btn-ghost-dk btn-sm"
                    onclick="hapusJadwal('${escAttr(r.kelompok)}','${escAttr(mod.judul)}','${escAttr(ses.username)}','${escAttr(s.updatedAt)}')">Hapus</button>`:''}
                </div>
              </form>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}`);
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}
/* — cekBatasSesiClient: pra-pengecekan batas umum 3 kelompok per sesi di sisi
   klien memakai data jadwal lintas-aslab (window._jadwalSesi dari RPC
   getJadwalKelompokModul). Return pesan error (string) bila melanggar, atau
   null bila OK. Mengecualikan baris sendiri (module_id + kelompok yang sama)
   karena upsert menggantikan baris itu. Trigger DB (cek_batas_aslab_jadwal,
   0009/0016) tetap cadangan untuk race condition.
   Aturan: maksimal 3 kelompok per sesi — satu-satunya aturan jadwal. — */
function cekBatasSesiClient(tanggal, sesi, judul, kelompokId){
  if(!tanggal || !sesi) return null;
  if(!Array.isArray(window._jadwalSesi)) return null; // data tidak tersedia -> biarkan DB
  const mods = APP.modules || [];
  const mod = mods.find(m => m.judul === judul);
  if(!mod) return null; // tidak ketahui moduleId -> skip pra-cek, biarkan DB
  const c = terisiCount(tanggal, sesi, { moduleId: mod.id, kelompok: kelompokId });
  if(c >= MAX_KELOMPOK_PER_SESI)
    return 'Jadwal ini sudah penuh: maksimal 3 kelompok per sesi.';
  return null;
}
async function submitJadwal(e,kelompokId,judul,setBy){
  e.preventDefault();const fd=new FormData(e.target);const btn=e.target.querySelector('button[type=submit]');
  btn.disabled=true;btn.textContent='Menyimpan…';
  // Pra-pengecekan batas umum 3 kelompok per sesi di sisi klien.
  const cekErr = cekBatasSesiClient(fd.get('tanggal'), fd.get('sesi'), judul, +kelompokId);
  if(cekErr){ toast(cekErr); btn.disabled=false; btn.textContent='Simpan'; return; }
  try{
    await api('setSchedule',
    {kelompokId:+kelompokId,judul,tanggal:fd.get('tanggal'),
    sesi:fd.get('sesi'),setBy,updatedAt:fd.get('updatedAt')||null});
    CACHE = {};
    APP.schedules = null;
    toast(`Jadwal kelompok ${kelompokId} tersimpan.`);renderApp();
  }
  catch(err){
    // Perubahan oleh orang lain / data usang (C1 optimistic concurrency)
    if (/Data sudah diubah orang lain/i.test(err.message)) {
      toast(err.message); btn.disabled=false; btn.textContent='Simpan';
    }
    // Race condition: dua aslab submit bersamaan, trigger DB
    // (cek_batas_aslab_jadwal) menolak.
    // Tangkap, beri pesan jelas, lalu refresh data opsi supaya indikator sinkron lagi.
    else if (/sudah penuh|maksimal 3 kelompok/i.test(err.message)) {
      toast(err.message);
      window._jadwalSesi = null; // paksa ambil ulang data jadwal
      renderApp();
    } else {
      toast('Gagal: '+err.message);btn.disabled=false;btn.textContent='Simpan';
    }
  }
}
async function hapusJadwal(kelompokId,judul,setBy,updatedAt){
  if(!confirm(`Hapus jadwal kelompok ${kelompokId}?`))return;
  try{await api('setSchedule',{kelompokId:+kelompokId,judul,tanggal:'',sesi:'',setBy,updatedAt:updatedAt||null});toast('Jadwal dihapus.');renderApp();}
  catch(err){
    if (/Data sudah diubah orang lain/i.test(err.message)) toast(err.message);
    else toast('Gagal: '+err.message);
  }
}

/* — Katalog Jadwal Praktikum (Task 2): tampil seluruh pilihan jadwal SEMUA aslab,
   read-only, group per tanggal (paling jauh di masa depan di atas). Akses baca lintas-aslab
   via RPC katalog_jadwal_aslab yang sama dengan indikator Task 1b (jangan buat mekanisme terpisah).
   Task B (RENCANA_PERUBAHAN_v5.md): tambah toggle "Per Tanggal" / "Per Kelompok".
   Per Tanggal = logika lama, TIDAK diubah. Per Kelompok = 1 card per kelompok,
   10 baris urut modul E1→E10. — */
async function loadKatalogA(ses){
  setContent(loading());
  try{
    // fetch sekali di awal — kedua tampilan pakai data yang sama sesi itu.
    const [katalogRes, jadwalRes, rotasiRes, mods] = await Promise.all([
      api('getKatalogJadwal'),
      api('getJadwalKelompokModul'),
      api('getRotasi', {}),
      getMods(),
    ]);
    window._katalogData = {
      katalog: katalogRes.katalog || [],
      jadwal:  jadwalRes.jadwal  || [],
      rotasi:  rotasiRes.rotasi  || [],
      mods,
    };
    if (!window._katalogView) window._katalogView = 'tanggal';

    setContent(`
    <div class="ph"><span class="ey">Katalog</span><h1>Katalog Jadwal Praktikum</h1></div>
    <p style="margin-bottom:18px;font-size:13px;color:var(--muted);max-width:560px;line-height:1.65;">
      Daftar jadwal praktikum semua aslab — hanya lihat. Maksimal ${MAX_KELOMPOK_PER_SESI} kelompok per sesi per tanggal; slot yang masih kosong dapat diisi di halaman Jadwal.
    </p>
    <div style="display:flex;gap:8px;margin-bottom:18px;">
      <button type="button" class="btn btn-sm" id="katalog-tab-tanggal" onclick="setKatalogView('tanggal')">Per Tanggal</button>
      <button type="button" class="btn btn-sm" id="katalog-tab-kelompok" onclick="setKatalogView('kelompok')">Per Kelompok</button>
    </div>
    <div id="katalog-content"></div>`);
    renderKatalogContent();
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}

function setKatalogView(v){
  window._katalogView = v;
  renderKatalogContent();
}

function renderKatalogContent(){
  const wrap = document.getElementById('katalog-content');
  if (!wrap) return;
  const tabTgl = document.getElementById('katalog-tab-tanggal');
  const tabKel = document.getElementById('katalog-tab-kelompok');
  const activeStyle = 'background:var(--accent,#2563eb);color:#fff;border-color:var(--accent,#2563eb);';
  if (tabTgl) tabTgl.setAttribute('style', window._katalogView === 'tanggal' ? 'font-size:12px;padding:6px 14px;'+activeStyle : 'font-size:12px;padding:6px 14px;');
  if (tabKel) tabKel.setAttribute('style', window._katalogView === 'kelompok' ? 'font-size:12px;padding:6px 14px;'+activeStyle : 'font-size:12px;padding:6px 14px;');

  if (window._katalogView === 'kelompok') {
    wrap.innerHTML = renderKatalogKelompok();
  } else {
    wrap.innerHTML = renderKatalogTanggal();
  }
}

/* — Per Tanggal: SAMA PERSIS seperti kode loadKatalogA lama — hanya dipindah
   ke fungsi terpisah, logika/output tidak diubah. — */
function renderKatalogTanggal(){
  const { katalog } = window._katalogData || {};
  // group by tanggal (urut DESC dari RPC), lalu by sesi (urut ASC dari RPC).
  const byTanggal = new Map();
  for (const row of (katalog || [])) {
    if (!byTanggal.has(row.tanggal)) byTanggal.set(row.tanggal, new Map());
    const bySesi = byTanggal.get(row.tanggal);
    if (!bySesi.has(row.sesi)) bySesi.set(row.sesi, []);
    bySesi.get(row.sesi).push(row.aslabName || row.setBy || '(tanpa nama)');
  }
  const tanggals = [...byTanggal.keys()]; // sudah DESC (paling jauh di masa depan duluan)
  if (!tanggals.length) {
    return `<div class="card"><p style="color:var(--muted);">Belum ada jadwal yang diambil aslab mana pun.</p></div>`;
  }
  return tanggals.map(tgl => {
    const bySesi = byTanggal.get(tgl);
    const sesiList = SESI;
    return `<div class="card" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <h3 style="margin:0;font-size:16px;">${esc(fmtTgl(tgl))}</h3>
        <span class="tag" style="font-size:11px;">${sesiList.length} sesi</span>
      </div>
      <div class="tw"><table class="riwayat-table">
        <thead><tr><th>Sesi</th><th>Aslab pengambil slot</th><th style="text-align:right;">Terisi</th></tr></thead>
        <tbody>${sesiList.map(sesi => {
          const names = bySesi.get(sesi) || [];
          const filled = names.length;
          const slots = names.slice();
          while (slots.length < MAX_KELOMPOK_PER_SESI) slots.push(null);
          const tagsHtml = slots.map(n => n
            ? `<span class="tag green" style="margin:2px 6px 2px 0;">${esc(n)}</span>`
            : `<span class="tag" style="margin:2px 6px 2px 0;opacity:.55;">Kosong</span>`).join('');
          const chipCls = filled >= MAX_KELOMPOK_PER_SESI ? 'amber' : 'blue';
          return `<tr>
            <td style="font-weight:600;white-space:nowrap;">${esc(sesi)}</td>
            <td>${tagsHtml}</td>
            <td style="text-align:right;white-space:nowrap;"><span class="tag ${chipCls}" style="font-size:11px;">${filled}/${MAX_KELOMPOK_PER_SESI}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
  }).join('');
}

/* — Per Kelompok (baru): 1 card per kelompok (urut ascending), isi = tabel 10
   baris urut modul E1→E10 (urutan dari array mods). Kolom: Modul (kode+judul) |
   Aslab pemegang (dari rotasi) | Tanggal & Sesi (dari RPC jadwal_kelompok_modul,
   atau "Belum dijadwalkan"). — */
function renderKatalogKelompok(){
  const { jadwal, rotasi, mods } = window._katalogData || {};
  const m = mods || [];
  // kelompok unik dari rotasi (sumber kebenaran kelompok×modul)
  const kelompoks = [...new Set((rotasi || []).map(r => r.kelompok))].sort((a,b) => +a - +b);
  if (!kelompoks.length) {
    return `<div class="card"><p style="color:var(--muted);">Belum ada data rotasi kelompok.</p></div>`;
  }
  // lookup jadwal: key "kelompok|moduleId" -> {tanggal, sesi}
  const jadwalMap = new Map();
  for (const j of (jadwal || [])) jadwalMap.set(j.kelompok + '|' + j.moduleId, j);
  return kelompoks.map(k => {
    const rows = m.map(mod => {
      // aslab pemegang kelompok+modul ini (dari rotasi)
      const r = (rotasi || []).find(x => +x.kelompok === +k && x.moduleId === mod.id);
      const aslabTxt = r && r.aslab ? esc(r.aslab) : '—';
      const j = jadwalMap.get(k + '|' + mod.id);
      const tglSesi = j
        ? `${esc(fmtTgl(j.tanggal))} · ${esc(j.sesi)}`
        : `<span style="color:var(--muted);">Belum dijadwalkan</span>`;
      return `<tr>
        <td><span class="tag blue" style="font-size:10px;margin-right:6px;">${esc(mod.kode)}</span>${esc(mod.judul)}</td>
        <td>${aslabTxt}</td>
        <td>${tglSesi}</td>
      </tr>`;
    }).join('');
    return `<div class="card" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <h3 style="margin:0;font-size:16px;">Kelompok ${esc(k)}</h3>
        <span class="tag" style="font-size:11px;">${m.length} modul</span>
      </div>
      <div class="tw"><table class="riwayat-table">
        <thead><tr><th>Modul</th><th>Aslab pemegang</th><th>Tanggal &amp; Sesi</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }).join('');
}
