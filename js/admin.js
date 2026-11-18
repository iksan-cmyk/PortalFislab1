'use strict';

/*admin anjy*/
const NAV_AD=[{path:'/ad/jadwal',label:'Jadwal',icon:'jadwal'},{path:'/ad/nilai',label:'Nilai',icon:'nilai'},{path:'/ad/pengguna',label:'Profil',icon:'profil'}];
function renderAdmin(hash,ses){const path=hash||'/ad/jadwal';buildNav(NAV_AD,path);
  if(path==='/ad/pengguna')loadAdminPengguna(ses);
  else if(path==='/ad/nilai')loadAdminNilai(ses);
  else loadAdminJadwal(ses);}
async function loadAdminNilai(ses){
  setContent(loading());
  window._adSes = ses;
  try{
    const{users}=await api('getUsers', {}, true);window._adUsers=users;
    const kelompoks=[...new Set(users.filter(u=>u.role==='praktikan').map(u=>u.kelompok))].sort((a,b)=>+a-+b);
    setContent(`
    <div class="ph">
      <span class="ey">Administrasi</span>
      <h1>Rekap Nilai</h1>
      <p>Pilih kelompok lalu pilih praktikan. Admin dapat melihat, menginput, dan menghapus nilai untuk kombinasi modul + praktikan apa pun.</p>
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
  const stu=document.getElementById('ad-stu-sel');
  _adStuReqSeq++; // batalkan adStuChange yang sedang berjalan (C2)
  document.getElementById('ad-grade-wrap').innerHTML='';
  if(!sel.value){stu.disabled=true;stu.innerHTML='<option>Pilih kelompok dahulu</option>';return;}
  const list=(window._adUsers||[]).filter(u=>u.role==='praktikan'&&+u.kelompok===+sel.value);
  stu.disabled=false;stu.innerHTML='<option value="">Pilih praktikan</option>'+list.map(u=>`<option value="${esc(u.username)}">${esc(u.name)}</option>`).join('');
}
let _adStuReqSeq = 0; // C2: penjaga urutan permintaan adStuChange
async function adStuChange(sel){
  const wrap=document.getElementById('ad-grade-wrap');
  const reqUsername = sel.value; // username yang diminta (C2)
  if(!reqUsername){wrap.innerHTML='';return;}
  const mySeq = ++_adStuReqSeq; // C3: tanpa useCache, data selalu segar
  wrap.innerHTML=loading();
  try{
    const[mods,{grades}]=await Promise.all([getMods(),api('getGrades',{username:reqUsername})]);
    // C2: jangan render bila ada permintaan lebih baru ATAU pilihan berbeda
    if(mySeq !== _adStuReqSeq || sel.value !== reqUsername) return;
    window._adGradesMods=mods;window._adGrades=grades;window._adStuUsername=reqUsername;
    const u=(window._adUsers||[]).find(x=>x.username===reqUsername);
    wrap.innerHTML=`
    <div class="ph" style="margin-top:8px;"><span class="ey">Breakdown</span><h1>Nilai ${u?esc(u.name):esc(reqUsername)}</h1></div>
    <div class="tw">
      <table>
      <thead><tr><th>Judul</th>${KOMP.map(k=>`<th>${k.label}<br><small style="font-weight:400;color:var(--muted)">${k.bobot}%</small></th>`).join('')}<th>Total</th><th>Aksi</th></tr></thead>
      <tbody>${mods.map(m=>{const g=grades.find(x=>x.judul===m.id||x.judul===m.judul)||{};
        const hasNilaiServer = g.nilaiAkhir !== undefined && g.nilaiAkhir !== null && g.nilaiAkhir !== '';
        const total = hasNilaiServer ? g.nilaiAkhir : hitungTotal(g);
        const adaKomponen = KOMP.some(k => k.key !== 'keterlambatan'
          && g[k.key] !== undefined && g[k.key] !== null && g[k.key] !== '');
        const sudahDinilai = hasNilaiServer || adaKomponen;
        const hasNilai = sudahDinilai;
        return`<tr><td style="font-weight:500">${esc(m.judul)}</td>
          ${KOMP.map(k=>`<td>${g[k.key]!==undefined&&g[k.key]!==''?g[k.key]:'—'}</td>`).join('')}
          <td>${sudahDinilai?`<span class="score-chip ${scoreClass(total)}">${parseFloat(total).toFixed(2)}</span>`:'—'}</td>
          <td style="white-space:nowrap;">
            <button type="button" class="btn btn-sm btn-primary" style="padding:0 10px;font-size:11px;" onclick="openAdminNilaiForm('${escAttr(reqUsername)}','${escAttr(m.judul)}')">Edit</button>
            ${hasNilai?`<button type="button" class="btn btn-sm btn-danger" style="margin-left:4px;padding:0 8px;font-size:11px;" onclick="hapusAdminNilai('${escAttr(reqUsername)}','${escAttr(m.judul)}')">Hapus</button>`:''}
          </td>
        </tr>`;}).join('')}
      </tbody></table></div>
      <p style="margin-top:14px;font-size:12px;color:var(--muted);">Klik <b>Edit</b> untuk input/mengubah nilai modul mana pun. <b>Hapus</b> menghapus seluruh nilai + catatan untuk modul tersebut.</p>`;
  }catch(err){ if(mySeq === _adStuReqSeq && sel.value === reqUsername) wrap.innerHTML=`<p style="color:red">${esc(err.message)}</p>`; }
}

/* — openAdminNilaiForm: modal form input nilai (admin, full power untuk
   kombinasi praktikan+modul apa pun). Reuse pola form aslab (aStuChange),
   nilaiAkhir dihitung trigger di server. Data diambil SEGAR saat tombol Edit
   diklik (C3), bukan dari cache window._adGrades yang bisa basi. — */
async function openAdminNilaiForm(username, judul){
  const setBy = (window._adSes && window._adSes.username) || 'admin';
  const u=(window._adUsers||[]).find(x=>x.username===username);
  let g={};
  try {
    const { grades } = await api('getGrades',{username, judul});
    g = (grades && grades[0]) || {};
  } catch(err) { toast('Gagal memuat nilai: '+err.message); return; }
  const updatedAt = g.updatedAt || ''; // C1
  document.getElementById('modal-root').innerHTML=`
  <div class="modal-back" id="anf-back">
    <div class="modal" style="max-width:860px;">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <h3>Input Nilai — ${u?esc(u.name):esc(username)}</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:18px;">${esc(judul)}</p>
      <form onsubmit="submitAdminNilai(event,'${escAttr(username)}','${escAttr(judul)}','${escAttr(setBy)}')">
        <input type="hidden" name="updatedAt" value="${esc(updatedAt)}">
        <div class="total-preview">
          <div class="label">Total Akhir (pratinjau)</div>
          <div class="score" id="anf-total">${totalDisplay(g)}</div>
        </div>
        <div class="nform-grid">
          ${KOMP.map(k=>`
          <div class="nform-row">
            <div class="nform-label"><b>${k.label}</b><span>Bobot ${k.bobot}%</span></div>
            <div class="nform-num"><input type="number" name="${k.key}" min="0" max="100"
              value="${nilaiVal(g[k.key])}" placeholder="—" oninput="updateAdminTotal(this.form)"></div>
            <div class="nform-cat"><textarea name="${k.cat}" placeholder="Catatan…" rows="1">${esc(g[k.cat]||'')}</textarea></div>
          </div>`).join('')}
        </div>
        <button type="submit" class="btn btn-primary" id="anf-save" style="width:100%;height:50px;font-size:15px;">Simpan Nilai &amp; Catatan</button>
      </form>
    </div>
  </div>`;
  document.getElementById('anf-back').onclick=e=>{if(e.target.id==='anf-back')closeModal();};
  setupInputNilaiKeys(document.querySelector('#modal-root form'), 'anf-save');
}
function updateAdminTotal(form){
  const el = document.getElementById('anf-total');
  if (!el) return;
  el.textContent = hitungTotalDariForm(form).toFixed(2);
}
async function submitAdminNilai(e,username,judul,setBy){
  e.preventDefault();const fd=new FormData(e.target);
  const btn=document.getElementById('anf-save');btn.disabled=true;btn.innerHTML='<span class="spinner"></span> Menyimpan…';
  const body={username,judul,setBy,updatedAt:fd.get('updatedAt')||null};
  KOMP.forEach(k=>{body[k.key]=fd.get(k.key)||'';body[k.cat]=fd.get(k.cat)||'';});
  try{
    await api('setGrade',body);
    CACHE={};
    toast('Nilai & catatan tersimpan.');
    closeModal();
    // refresh tabel breakdown (tanpa cache, C3)
    const sel=document.getElementById('ad-stu-sel');if(sel&&sel.value)adStuChange(sel);
  }catch(err){
    if (/Data sudah diubah orang lain/i.test(err.message)) toast(err.message);
    else toast('Gagal: '+err.message);
    btn.disabled=false;btn.innerHTML='Simpan Nilai & Catatan';
  }
}
async function hapusAdminNilai(username, judul){
  if(!confirm(`Hapus nilai & catatan "${judul}" untuk praktikan ini? Tidak bisa dikembalikan.`))return;
  try{
    await api('deleteGrade',{username,judul});
    CACHE={};
    toast('Nilai dihapus.');
    const sel=document.getElementById('ad-stu-sel');if(sel&&sel.value)adStuChange(sel);
  }catch(err){toast('Gagal: '+err.message);}
}
/* — Halaman Jadwal admin (Fitur 1, RENCANA_PERUBAHAN_v8.md).
   Admin bisa: lihat seluruh jadwal lintas kelompok/modul/tanggal + aslab
   pemegang slot, filter (kelompok/modul/tanggal/aslab), edit (aslab pemegang
   slot + tanggal/sesi), dan hapus (dengan cascade delete nilai terkait via
   RPC admin_hapus_jadwal, plus modal konfirmasi eksplisit).
   Trigger cek_batas_aslab_jadwal (0009) tetap berlaku saat edit. — */
async function loadAdminJadwal(ses){
  setContent(loading('Memuat jadwal…'));
  try{
    const [{jadwal}, mods, aslabs] = await Promise.all([
      api('getAdminJadwal'),
      getMods(),
      api('getUsers', {}, true).then(r => (r.users||[]).filter(u => u.role === 'aslab')),
    ]);
    window._adJadwalState = { jadwal, mods, aslabs, ses };
    const kelompokSet = [...new Set(jadwal.map(j => j.kelompok))].sort((a,b)=>+a-+b);
    setContent(`
    <div class="ph">
      <span class="ey">Administrasi</span>
      <h1>Jadwal Praktikum</h1>
      <p>Seluruh jadwal lintas kelompok &amp; modul. Admin dapat mengubah dan menghapus jadwal.</p>
    </div>
    <div class="fr" style="margin-bottom:16px;align-items:flex-end;">
      <div class="ff"><label>Kelompok</label>
        <select id="aj-grp" onchange="renderAdminJadwalTable()">
          <option value="">Semua</option>${kelompokSet.map(k=>`<option value="${esc(k)}">Kelompok ${esc(k)}</option>`).join('')}
        </select></div>
      <div class="ff"><label>Modul</label>
        <select id="aj-mod" onchange="renderAdminJadwalTable()">
          <option value="">Semua</option>${mods.map(m=>`<option value="${esc(m.id)}">${esc(m.kode||'')} — ${esc(m.judul)}</option>`).join('')}
        </select></div>
      <div class="ff"><label>Aslab</label>
        <select id="aj-aslab" onchange="renderAdminJadwalTable()">
          <option value="">Semua</option>${aslabs.map(a=>`<option value="${esc(a.username)}">${esc(a.name)}</option>`).join('')}
        </select></div>
    </div>
    <div class="fr" style="margin-bottom:22px;align-items:flex-end;">
      <div class="ff"><label>Tanggal dari</label>
        <input type="date" id="aj-dari" onchange="renderAdminJadwalTable()"></div>
      <div class="ff"><label>Tanggal sampai</label>
        <input type="date" id="aj-sampai" onchange="renderAdminJadwalTable()"></div>
    </div>
    <div id="aj-table-wrap"></div>`);
    renderAdminJadwalTable();
  }catch(e){setContent(`<p style="color:red">${esc(e.message)}</p>`);}
}

function renderAdminJadwalTable(){
  const st = window._adJadwalState; if(!st) return;
  const wrap = document.getElementById('aj-table-wrap'); if(!wrap) return;
  const { jadwal, mods, aslabs } = st;
  let rows = (jadwal||[]).slice();
  const fGrp = (document.getElementById('aj-grp')||{}).value || '';
  const fMod = (document.getElementById('aj-mod')||{}).value || '';
  const fAs  = (document.getElementById('aj-aslab')||{}).value || '';
  const fDari = (document.getElementById('aj-dari')||{}).value || '';
  const fSmp  = (document.getElementById('aj-sampai')||{}).value || '';
  if(fGrp) rows = rows.filter(r => String(r.kelompok)===String(fGrp));
  if(fMod) rows = rows.filter(r => r.moduleId===fMod);
  if(fAs)  rows = rows.filter(r => r.setBy===fAs);
  if(fDari) rows = rows.filter(r => r.tanggal && r.tanggal >= fDari);
  if(fSmp)  rows = rows.filter(r => r.tanggal && r.tanggal <= fSmp);
  // sorting default: tanggal asc, sesi asc (sudah dari query, pertahankan)
  if(!rows.length){
    wrap.innerHTML = `<div class="card"><p style="color:var(--muted);">Tidak ada jadwal yang cocok dengan filter.</p></div>`;
    return;
  }
  const aslabOpts = aslabs.map(a=>`<option value="${esc(a.username)}">${esc(a.name)}</option>`).join('');
  wrap.innerHTML = `
  <div class="tw"><table class="riwayat-table">
    <thead><tr><th>Modul</th><th>Kelompok</th><th>Tanggal</th><th>Sesi</th><th>Aslab pemegang</th><th>Aksi</th></tr></thead>
    <tbody>${rows.map((r,i)=>`<tr>
      <td><span class="tag blue" style="font-size:10px;margin-right:6px;">${esc(r.kode)}</span>${esc(r.judul)}</td>
      <td>${esc(r.kelompok)}</td>
      <td>${r.tanggal?esc(fmtTgl(r.tanggal)):'—'}</td>
      <td>${r.sesi?esc(r.sesi):'—'}</td>
      <td>${r.setBy?esc(r.aslabName):'—'}</td>
      <td style="white-space:nowrap;">
        <button type="button" class="btn btn-sm btn-primary" style="padding:0 10px;font-size:11px;"
          onclick="openAdminJadwalEdit(${i},'${escAttr(r.moduleId)}','${escAttr(r.kelompok)}')">Edit</button>
        <button type="button" class="btn btn-sm btn-danger" style="margin-left:4px;padding:0 8px;font-size:11px;"
          onclick="openAdminJadwalHapus('${escAttr(r.moduleId)}','${escAttr(r.kelompok)}','${escAttr(r.judul)}','${escAttr(r.kelompok)}')">Hapus</button>
      </td>
    </tr>`).join('')}</tbody>
  </table></div>
  <p style="margin-top:12px;font-size:12px;color:var(--muted);">${rows.length} jadwal ditampilkan.</p>`;
  // simpan rows hasil filter untuk dipakai modal edit (index i)
  window._adJadwalRows = rows;
}

/* — Edit jadwal (admin): ubah aslab pemegang slot + tanggal/sesi.
   Reuse apiSetSchedule (upsert onConflict module_id,kelompok) — trigger
   max-3 tetap berjalan; bila slot tujuan penuh, tangkap & tampilkan error. — */
function openAdminJadwalEdit(idx, moduleId, kelompok){
  const rows = window._adJadwalRows || [];
  const r = rows[idx];
  if(!r){ toast('Data jadwal tidak ditemukan, muat ulang halaman.'); return; }
  const { aslabs } = window._adJadwalState;
  const aslabOpts = aslabs.map(a=>`<option value="${esc(a.username)}" ${a.username===r.setBy?'selected':''}>${esc(a.name)}</option>`).join('');
  document.getElementById('modal-root').innerHTML=`
  <div class="modal-back" id="aje-back">
    <div class="modal" style="max-width:520px;">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <h3>Edit Jadwal</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:18px;">${esc(r.kode||'')} — ${esc(r.judul)} · Kelompok ${esc(r.kelompok)}</p>
      <form onsubmit="submitAdminJadwalEdit(event,'${escAttr(moduleId)}','${escAttr(kelompok)}')">
        <input type="hidden" name="updatedAt" value="${r.updatedAt?esc(r.updatedAt):''}">
        <div class="mfield"><label>Aslab pemegang slot</label>
          <select name="setBy">${aslabOpts}</select></div>
        <div class="mfield"><label>Tanggal</label>
          <input type="date" name="tanggal" value="${r.tanggal||''}" required></div>
        <div class="mfield"><label>Sesi</label>
          <select name="sesi">${SESI.map(x=>`<option value="${esc(x)}" ${x===r.sesi?'selected':''}>${esc(x)}</option>`).join('')}</select></div>
        <button type="submit" class="btn btn-primary btn-block" id="aje-save" style="height:46px;margin-top:8px;">Simpan</button>
      </form>
    </div>
  </div>`;
  document.getElementById('aje-back').onclick=e=>{if(e.target.id==='aje-back')closeModal();};
}

async function submitAdminJadwalEdit(e, moduleId, kelompok){
  e.preventDefault();const fd=new FormData(e.target);
  const st=window._adJadwalState;
  // cari judul dari moduleId
  const mod=(st.mods||[]).find(m=>m.id===moduleId);
  const judul=mod?mod.judul:moduleId;
  const btn=document.getElementById('aje-save');btn.disabled=true;btn.textContent='Menyimpan…';
  try{
    await api('setSchedule',{
      kelompokId:+kelompok, judul,
      tanggal:fd.get('tanggal'), sesi:fd.get('sesi'),
      setBy:fd.get('setBy'), updatedAt:fd.get('updatedAt')||null,
    });
    CACHE={};
    toast('Jadwal diperbarui.');
    closeModal();
    loadAdminJadwal(window._adJadwalState.ses);
  }catch(err){
    if (/Data sudah diubah orang lain/i.test(err.message)){
      toast(err.message);
    }
    else if(/sudah penuh|maksimal 3 kelompok/i.test(err.message)){
      toast('Slot ini sudah penuh (maks 3 kelompok per tanggal). Pilih sesi/tanggal lain.');
    }else{
      toast('Gagal: '+err.message);
    }
    btn.disabled=false;btn.textContent='Simpan';
  }
}

/* — Hapus jadwal (admin) dengan modal konfirmasi EKSPLISIT. Cascade delete
   nilai terkait via RPC admin_hapus_jadwal (transaksi atomik).
   C4: tampilkan jumlah nilai + nama praktikan yang akan terhapus, tanpa
   mengubah RPC admin_hapus_jadwal. — */
async function openAdminJadwalHapus(moduleId, kelompok, judul, kelompokDisp){
  // Hitung nilai yang akan terdampak (replikasi himpunan subquery admin_hapus_jadwal:
  // grades module ini untuk praktikan yang profiles.kelompok == kelompok).
  let affected = 0;
  let names = [];
  try {
    const [profRes, gradeRes] = await Promise.all([
      SB.from('profiles').select('username,name').eq('role','praktikan').eq('kelompok', parseInt(kelompok,10)),
      SB.from('grades').select('username').eq('module_id', moduleId),
    ]);
    if (!profRes.error && !gradeRes.error) {
      const profSet = new Set((profRes.data||[]).map(p=>p.username));
      affected = (gradeRes.data||[]).filter(g=>profSet.has(g.username)).length;
      names = (profRes.data||[])
        .filter(p=>p.username && (gradeRes.data||[]).some(g=>g.username===p.username))
        .map(p=>p.name);
    }
  } catch(_) { /* biarkan tetap tampil dengan info default */ }
  const previewNama = names.length ? names.slice(0,8).join(', ') + (names.length>8?' …':'') : '—';
  document.getElementById('modal-root').innerHTML=`
  <div class="modal-back" id="ajh-back">
    <div class="modal" style="max-width:460px;">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <h3>Hapus Jadwal?</h3>
      <div class="merr" style="background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.4);margin:14px 0 18px;">
        Menghapus jadwal <b>${esc(judul)}</b> (Kelompok ${esc(kelompokDisp)}) juga akan menghapus <b>${affected} nilai</b> yang sudah diinput untuk slot ini. Operasi ini tidak bisa dibatalkan.
      </div>
      <p style="font-size:12px;color:var(--muted);margin:-6px 0 14px;line-height:1.5;">Praktikan terdampak: ${esc(previewNama)}</p>
      <div style="display:flex;gap:10px;">
        <button type="button" class="btn btn-ghost-dk" style="flex:1;height:46px;" onclick="closeModal()">Batal</button>
        <button type="button" class="btn btn-danger" style="flex:1;height:46px;border:1.5px solid #ef4444;background:#ef4444;color:#fff;" id="ajh-confirm" onclick="confirmAdminJadwalHapus('${escAttr(moduleId)}','${escAttr(kelompok)}')">Hapus</button>
      </div>
    </div>
  </div>`;
  document.getElementById('ajh-back').onclick=e=>{if(e.target.id==='ajh-back')closeModal();};
}

async function confirmAdminJadwalHapus(moduleId, kelompok){
  const btn=document.getElementById('ajh-confirm');btn.disabled=true;btn.textContent='Menghapus…';
  try{
    await api('adminHapusJadwal',{moduleId,kelompok});
    CACHE={};
    toast('Jadwal & nilai terkait dihapus.');
    closeModal();
    loadAdminJadwal(window._adJadwalState.ses);
  }catch(err){
    toast('Gagal: '+err.message);
    btn.disabled=false;btn.textContent='Hapus';
  }
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
