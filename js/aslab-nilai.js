'use strict';

function loadProfilA(ses){
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
/* Modul Praktikum (aslab): daftar modul sama seperti halaman praktikan, read-only,
   klik kartu buka viewer. Dipakai aslab untuk lihat file modul yang dipegang/sedang dinilai. */
async function loadModulA(){
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

    // Rekap Nilai E1-E10 (pengganti riwayat lama).
    await renderRekapNilai(mods, users, rotasi, ses);
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}

/* renderRekapNilai: tabel rekap nilai_akhir SEMUA praktikan x SEMUA modul E1-E10.
   Baris = praktikan (urut NRP naik), kolom = modul urut sesuai modules.urutan.
   Filter: dropdown Kelompok + input Nama + input NRP (AND, client-side).
   Tombol Hapus per sel HANYA muncul kalau aslab yang login memegang
   (module_id + kelompok praktikan) menurut rotasi. */
async function renderRekapNilai(mods, users, rotasi, ses){
  const wrap = document.getElementById('a-riwayat-wrap');
  if (!wrap) return;
  let rekap = [];
  try {
    const r = await api('getRekapNilai');
    rekap = r.rekap || [];
  } catch(e) { /* biarkan rekap kosong, tabel tetap tampil */ }
  // state di window supaya fungsi filter & refresh bisa akses tanpa refetch
  window._rekapState = { mods, users, rotasi, ses, rekap };
  const praktikan = (users||[]).filter(u => u.role === 'praktikan');
  // sort NRP ascending numerik (NRP asli = 10 digit angka, verifikasi data users.csv)
  praktikan.sort((a,b) => (parseInt(a.nrp||'0',10)||0) - (parseInt(b.nrp||'0',10)||0));
  window._rekapState.praktikan = praktikan;
  // opsi kelompok unik
  const kelompokSet = [...new Set(praktikan.map(u => u.kelompok).filter(k => k !== undefined && k !== null && k !== ''))];
  kelompokSet.sort((a,b) => +a - +b);

  wrap.innerHTML = `
    <div class="ph" style="margin-top:32px;"><span class="ey">Riwayat</span><h1>Rekap Nilai E1–E10</h1></div>
    <div class="fr" style="max-width:900px;margin-bottom:18px;">
      <div class="ff"><label>Kelompok</label>
        <select id="rek-grp" onchange="applyRekapFilters()">
          <option value="">Semua Kelompok</option>
          ${kelompokSet.map(k=>`<option value="${esc(k)}">Kelompok ${esc(k)}</option>`).join('')}
        </select></div>
      <div class="ff"><label>Nama</label>
        <input type="text" id="rek-nama" placeholder="Cari nama…" oninput="applyRekapFilters()"></div>
      <div class="ff"><label>NRP</label>
        <input type="text" id="rek-nrp" placeholder="Cari NRP…" oninput="applyRekapFilters()"></div>
    </div>
    <div class="tw" id="rek-table-wrap">${rekapTableHtml()}</div>`;
}

function rekapTableHtml(){
  const st = window._rekapState; if (!st) return '';
  const { mods, rotasi, ses } = st;
  let praktikan = (st.praktikan||[]).slice();
  // baca filter
  const fGrp = (document.getElementById('rek-grp')||{}).value || '';
  const fNama = ((document.getElementById('rek-nama')||{}).value || '').toLowerCase().trim();
  const fNrp  = ((document.getElementById('rek-nrp')||{}).value  || '').toLowerCase().trim();
  if (fGrp) praktikan = praktikan.filter(u => String(u.kelompok) === String(fGrp));
  if (fNama) praktikan = praktikan.filter(u => (u.name||'').toLowerCase().includes(fNama));
  if (fNrp)  praktikan = praktikan.filter(u => String(u.nrp||'').toLowerCase().includes(fNrp));

  // lookup nilai: key "username|moduleId" -> nilaiAkhir
  const nilaiMap = new Map();
  for (const r of (st.rekap||[])) nilaiMap.set(r.username + '|' + r.moduleId, r.nilaiAkhir);

  // header: Nama | NRP | Kelompok | 1 kolom per modul (kode)
  const header = `<thead><tr>
    <th>Nama</th><th>NRP</th><th>Kelompok</th>
    ${mods.map(m => `<th>${esc(m.kode)}</th>`).join('')}
  </tr></thead>`;

  const body = praktikan.map(u => {
    const cells = mods.map(m => {
      const val = nilaiMap.get(u.username + '|' + m.id);
      if (val === undefined || val === '' || val === null) return `<td>—</td>`;
      // cek kepemilikan: apakah aslab yang login memegang (module_id + kelompok) ini?
      const mine = rotasi.some(r =>
        r.moduleId === m.id &&
        +r.kelompok === +u.kelompok &&
        r.aslabUsername === ses.username);
      const chip = `<span class="score-chip ${scoreClass(val)}">${parseFloat(val).toFixed(2)}</span>`;
      if (!mine) return `<td>${chip}</td>`;
      return `<td>${chip} <button type="button" class="btn btn-sm btn-danger" style="margin-left:4px;padding:0 8px;font-size:11px;" title="Batalkan nilai ${esc(m.kode)}" onclick="batalNilai('${escAttr(u.username)}','${escAttr(m.judul)}')">✕</button></td>`;
    }).join('');
    return `<tr>
      <td>${esc(u.name)}</td>
      <td>${esc(u.nrp||'—')}</td>
      <td>${u.kelompok !== undefined && u.kelompok !== null ? esc(u.kelompok) : '—'}</td>
      ${cells}
    </tr>`;
  }).join('');

  if (!praktikan.length) {
    return `<table class="riwayat-table">${header}<tbody><tr><td colspan="${3 + mods.length}" style="text-align:center;color:var(--muted);padding:24px;">Tidak ada praktikan yang cocok dengan filter.</td></tr></tbody></table>`;
  }
  return `<table class="riwayat-table">${header}<tbody>${body}</tbody></table>`;
}

function applyRekapFilters(){
  const w = document.getElementById('rek-table-wrap'); if (!w) return;
  w.innerHTML = rekapTableHtml();
}

/* refreshRekapNilai: re-fetch data rekap & re-render tabel (dipakai setelah
   submit/batal nilai). Filter state (kelompok/nama/nrp) dipertahankan. */
async function refreshRekapNilai(){
  const st = window._rekapState; if (!st) return;
  try {
    const r = await api('getRekapNilai');
    st.rekap = r.rekap || [];
  } catch(e) { /* keep existing */ }
  applyRekapFilters();
}

function aModChange(sel){
  const grp=document.getElementById('a-grp-sel');
  const stu=document.getElementById('a-stu-sel');
  _aStuReqSeq++; // batalkan aStuChange yang sedang berjalan (C2)
  document.getElementById('a-grade-wrap').innerHTML='';
  // Rekap E1-E10 (pengganti riwayat lama) tetap tampil di a-riwayat-wrap
  // saat modul dipilih — jangan dikosongkan.
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
}

function aGrpChange(sel){
  const stu=document.getElementById('a-stu-sel');
  _aStuReqSeq++; // batalkan aStuChange yang sedang berjalan (C2)
  document.getElementById('a-grade-wrap').innerHTML='';
  if(!sel.value){stu.disabled=true;stu.innerHTML='<option>Pilih kelompok dahulu</option>';return;}
  const list=(window._aUsers||[]).filter(u=>u.role==='praktikan'&&+u.kelompok===+sel.value);
  stu.disabled=false;
  stu.innerHTML='<option value="">Pilih praktikan</option>'+
    list.map(u=>`<option value="${esc(u.username)}">${esc(u.name)}</option>`).join('');
}

/* setupInputNilaiKeys: pasang navigasi Enter + cegah scroll-wheel ubah nilai
   pada input angka di form Input Nilai (aslab & modal admin). Dipanggil sekali
   saat form dirender (form lama di-replace via innerHTML -> listener lama ikut
   hilang, tidak terpasang ganda). Enter di baris non-terakhir -> fokus ke input
   berikutnya + select() isi. Enter di baris terakhir -> submit via jalur yang
   sama dengan tombol Simpan (form.requestSubmit / dispatch submit). Hanya
   tangani input[type=number] di .nform-grid — bukan textarea catatan. */
function setupInputNilaiKeys(form, saveBtnId){
  if(!form) return;
  form.addEventListener('keydown', e=>{
    if(e.key!=='Enter') return;
    const t=e.target;
    if(!t||t.tagName!=='INPUT'||t.type!=='number') return;
    if(!t.closest('.nform-grid')) return;
    e.preventDefault();
    const inputs=Array.from(form.querySelectorAll('.nform-num input[type=number]'));
    const idx=inputs.indexOf(t); if(idx<0) return;
    if(typeof t.checkValidity==='function' && !t.checkValidity()){ t.reportValidity(); return; }
    if(idx < inputs.length-1){
      const n=inputs[idx+1]; n.focus(); n.select();
    } else {
      const btn=document.getElementById(saveBtnId);
      if(btn && btn.disabled) return;
      if(typeof form.requestSubmit==='function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
    }
  });
  form.addEventListener('wheel', e=>{
    const t=e.target;
    if(t && t.tagName==='INPUT' && t.type==='number' && t.closest('.nform-grid')) e.preventDefault();
  }, { passive:false });
}

let _aStuReqSeq = 0; // C2: penjaga urutan permintaan aStuChange
async function aStuChange(sel){
  const wrap=document.getElementById('a-grade-wrap');
  const reqUsername = sel.value; // username yang diminta (C2)
  if(!reqUsername){wrap.innerHTML='';return;}
  const judul=document.getElementById('a-mod-sel').value;
  const setBy=window._aSes.username;
  const mySeq = ++_aStuReqSeq;
  wrap.innerHTML=loading('Memuat nilai…');
  try{
    const{grades}=await api('getGrades',{username:reqUsername,judul});
    // C2: jangan render bila ada permintaan lebih baru ATAU pilihan & request berbeda
    if(mySeq !== _aStuReqSeq || sel.value !== reqUsername) return;
    const g=grades[0]||{};
    const u=(window._aUsers||[]).find(x=>x.username===reqUsername);
    const updatedAt = g.updatedAt || ''; // C1
    wrap.innerHTML=`
    <div class="card">
      <h3 style="margin-bottom:20px;">Nilai untuk ${u?esc(u.name):esc(reqUsername)}</h3>
      <form onsubmit="submitNilaiA(event,'${escAttr(reqUsername)}','${escAttr(judul)}','${escAttr(setBy)}')">
        <input type="hidden" name="updatedAt" value="${esc(updatedAt)}">
        <div class="total-preview">
          <div class="label">Total Akhir (pratinjau)</div>
          <div class="score" id="total-preview-val">${totalDisplay(g)}</div>
        </div>
        <div class="nform-grid">
          ${KOMP.map(k=>`
          <div class="nform-row">
            <div class="nform-label"><b>${k.label}</b><span>Bobot ${k.bobot}%</span></div>
            <div class="nform-num"><input type="number" name="${k.key}" min="0" max="100"
              value="${nilaiVal(g[k.key])}" placeholder="—" oninput="updateTotal(this.form)"></div>
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
    setupInputNilaiKeys(wrap.querySelector('form'), 'btn-save-grade');
  }catch(err){ if(mySeq === _aStuReqSeq && sel.value === reqUsername) wrap.innerHTML=`<p style="color:red">${esc(err.message)}</p>`; }
}

async function submitNilaiA(e,username,judul,setBy){
  e.preventDefault();const fd=new FormData(e.target);
  const btn=e.target.querySelector('#btn-save-grade');
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span> Menyimpan…';
  const body={username,judul,setBy,catatan:fd.get('catatan')||'',updatedAt:fd.get('updatedAt')||null};
  KOMP.forEach(k=>{body[k.key]=fd.get(k.key)||'';body[k.cat]=fd.get(k.cat)||'';});
  body.nilaiAkhir=hitungTotal(body).toFixed(2);
  try{
    await api('setGrade',body);
    CACHE={};APP.grades=null;
    toast('Nilai & catatan tersimpan.');
    // Jaring pengaman: ambil nilaiAkhir & updated_at TERBARU dari server, lalu
    // tulis ulang hidden 'updatedAt' di form. Tanpa ini, simpan kedua (termasuk
    // Enter di baris terakhir) mengirim versi lama → konflik palsu (C1/Verif 2).
    try {
      const { grades: g2 } = await api('getGrades',{username,judul});
      const row = g2 && g2[0];
      if (row) {
        const sv = row.nilaiAkhir;
        const el = document.getElementById('total-preview-val');
        if (el && sv !== undefined && sv !== null && sv !== '') el.textContent = parseFloat(sv).toFixed(2);
        const upd = e.target.querySelector('input[name="updatedAt"]');
        if (upd && row.updatedAt) upd.value = row.updatedAt;
      }
    } catch(_) { /* pratinjau lokal sudah cukup; abaikan */ }
    // refresh rekap E1-E10 (pengganti riwayat per-modul lama)
    refreshRekapNilai();
  }catch(err){
    if (/Data sudah diubah orang lain/i.test(err.message)) toast(err.message);
    else toast('Gagal: '+err.message);
  }
  finally{btn.disabled=false;btn.innerHTML='Simpan Nilai & Catatan';}
}

async function batalNilai(username, judul){
  if(!confirm('Batalkan nilai yang sudah tersimpan untuk peserta ini? Nilai & catatan akan dihapus dan tidak bisa dikembalikan.'))return;
  try{
    await api('deleteGrade',{username,judul});
    CACHE={};APP.grades=null;
    toast('Nilai dibatalkan.');
    // refresh rekap E1-E10 jika sedang tampil (pengganti riwayat lama).
    // Kalau _rekapState tidak ada (konteks lain), fallback ke loadNilaiA penuh.
    if (window._rekapState) refreshRekapNilai();
    else if (window._aSes) loadNilaiA(window._aSes);
  }catch(err){toast('Gagal: '+err.message);}
}
