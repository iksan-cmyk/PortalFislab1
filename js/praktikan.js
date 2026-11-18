'use strict';

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
          // total dari server bila ada; bila null/kosong -> pratinjau hitungTotal (mungkin 0).
          const hasNilaiServer = g.nilaiAkhir !== undefined && g.nilaiAkhir !== null && g.nilaiAkhir !== '';
          const total = hasNilaiServer ? g.nilaiAkhir : hitungTotal(g);
          // "Belum dinilai" hanya bila tidak ada nilai server DAN semua komponen
          // (kecuali keterlambatan) kosong. Total 0 yang sah tetap tampil '0.00'.
          const adaKomponen = KOMP.some(k => k.key !== 'keterlambatan'
            && g[k.key] !== undefined && g[k.key] !== null && g[k.key] !== '');
          const sudahDinilai = hasNilaiServer || adaKomponen;
          const hasCat=KOMP.some(k=>g[k.cat]);
          return`<div class="ncard" id="nc-${m.id}">
            <div class="ncard-head" onclick="toggleNcard('${m.id}')">
              <span class="ncard-title">${esc(m.judul)}</span>
              <div class="ncard-meta">
                ${hasCat?`<span class="tag amber" style="font-size:10px;">Ada catatan</span>`:''}
                ${sudahDinilai?`<span class="ncard-total">${parseFloat(total).toFixed(2)}</span>`:'<span class="tag" style="font-size:11px;">Belum dinilai</span>'}
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
  const isi = document.getElementById('pesanTA')?.value || '';
  const nama = decodeURIComponent(namaEnc);
  const num = waNum.startsWith('0') ? '62'+waNum.slice(1) : waNum;
  const template =
`Halo Kak ${aslabName}, perkenalkan saya:

Nama: ${nama}
NRP: ${nrp||'—'}
Kelompok: ${kelompok}

${isi}

Kamsia`;
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(template)}`, '_blank');
}
