'use strict';

/* Halaman Pemantauan Penilaian — dipakai bersama admin & aslab yang diberi akses.
   Data berasal dari RPC pemantauan_penilaian() + pemantauan_ringkas() (server memfilter
   akses; halaman ini hanya menampilkan). Semua teks dari data lewat esc()/escAttr(). */

window._pmtu = null;   // { data, ringkas }
window._pmtuF = { aslab:'', modul:'', status:'belum-lengkap' };
window._pmtuSes = null;

function pmtuStatus(u){
  if (u.sudah_dinilai >= u.total_praktikan) return 'sudah';
  if (u.sudah_dinilai > 0) return 'sebagian';
  return 'belum';
}

function pmtuStatusLabel(u){
  const n = u.total_praktikan, d = u.sudah_dinilai;
  if (d >= n) return 'Sudah ('+n+'/'+n+')';
  if (d > 0) return 'Sebagian — '+d+' sudah, '+(n-d)+' belum';
  return 'Belum dinilai (0/'+n+')';
}

async function loadPemantauan(ses){
  const boleh = await apiAksesPemantauan();
  const defPath = ses && ses.role === 'admin' ? '/ad/jadwal' : '/a/jadwal';
  if (!boleh) {
    setContent(`<div class="ph"><span class="ey">Pemantauan</span><h1>Tidak punya akses</h1></div>
      <div class="card"><p>Anda tidak memiliki akses ke halaman ini.</p></div>`);
    if (window.location.hash.replace('#','') !== defPath) window.location.hash = defPath;
    return;
  }
  setContent(loading('Memuat data pemantauan…'));
  try {
    const [data, ringkas] = await Promise.all([apiPemantauanPenilaian(), apiPemantauanRingkas()]);
    window._pmtu = { data: data || [], ringkas };
    window._pmtuSes = ses;
    setContent(renderPemantauan());
  } catch(e) {
    const msg = (e && e.code === '42501') ? 'Anda tidak memiliki akses ke data ini.'
                                          : 'Gagal memuat data: ' + (e.message || e);
    setContent(`<div class="ph"><span class="ey">Pemantauan</span><h1>Gagal</h1></div>
      <div class="card"><p>${esc(msg)}</p></div>`);
  }
}

function renderPemantauan(){
  const st = window._pmtu;
  if (!st) return '';
  const rows = st.data || [];
  const F = window._pmtuF;

  const nBelum      = rows.filter(r => pmtuStatus(r) === 'belum').length;
  const nSebagian   = rows.filter(r => pmtuStatus(r) === 'sebagian').length;
  const nSudah      = rows.filter(r => pmtuStatus(r) === 'sudah').length;
  const nBelumWaktu = (st.ringkas && st.ringkas.belum_waktu) || 0;

  const filtered = rows.filter(r => {
    if (F.aslab && F.aslab !== (r.aslab_username || '__none__')) return false;
    if (F.modul && F.modul !== r.module_id) return false;
    const s = pmtuStatus(r);
    if (F.status === 'belum-lengkap') { if (s === 'sudah') return false; }
    else if (F.status !== 'semua' && s !== F.status) return false;
    return true;
  });

  const body = filtered.length ? pmtuGroupsHtml(filtered)
    : `<div class="card"><p>Semua kelompok yang sudah lewat sudah dinilai.</p></div>`;

  return `
  <div class="ph">
    <span class="ey">Pemantauan</span>
    <h1>Pemantauan Penilaian</h1>
    <p>Aslab yang belum (selesai) menilai kelompok yang diajarnya.</p>
  </div>
  <div class="pmtu-summary">
    <div class="card pmtu-sum"><span class="pmtu-sum-n">${nBelum}</span><span class="pmtu-sum-l">Belum dinilai</span></div>
    <div class="card pmtu-sum"><span class="pmtu-sum-n">${nSebagian}</span><span class="pmtu-sum-l">Sebagian</span></div>
    <div class="card pmtu-sum"><span class="pmtu-sum-n">${nSudah}</span><span class="pmtu-sum-l">Sudah</span></div>
    <div class="card pmtu-sum"><span class="pmtu-sum-n">${nBelumWaktu}</span><span class="pmtu-sum-l">Belum waktunya / belum dijadwalkan</span></div>
  </div>
  <div class="fr pmtu-filters">
    <div class="ff"><label>Aslab</label><select onchange="pmtuSetFilter('aslab',this.value)">${pmtuAslabOptions(rows, F.aslab)}</select></div>
    <div class="ff"><label>Modul</label><select onchange="pmtuSetFilter('modul',this.value)">${pmtuModulOptions(rows, F.modul)}</select></div>
    <div class="ff"><label>Status</label><select onchange="pmtuSetFilter('status',this.value)">${pmtuStatusOptions(F.status)}</select></div>
    <div class="ff" style="align-self:flex-end;"><button type="button" class="btn btn-primary btn-sm" onclick="pmtuReload(window._pmtuSes)">Muat ulang</button></div>
  </div>
  ${body}`;
}

function pmtuAslabOptions(rows, sel){
  const keys = [...new Set(rows.map(r => r.aslab_username || '__none__'))];
  const opts = keys.map(k => {
    const nama = k === '__none__' ? 'Belum ada aslab'
      : (rows.find(r => (r.aslab_username || '__none__') === k)?.aslab_name || k);
    return `<option value="${escAttr(k)}" ${sel===k?'selected':''}>${esc(nama)}</option>`;
  }).join('');
  return `<option value="">Semua aslab</option>` + opts;
}

function pmtuModulOptions(rows, sel){
  const ids = [...new Set(rows.map(r => r.module_id))];
  const opts = ids.map(id => {
    const r = rows.find(x => x.module_id === id);
    const label = r ? ((r.kode || '') + ' — ' + (r.judul || id)) : id;
    return `<option value="${escAttr(id)}" ${sel===id?'selected':''}>${esc(label)}</option>`;
  }).join('');
  return `<option value="">Semua modul</option>` + opts;
}

function pmtuStatusOptions(sel){
  const items = [
    ['belum-lengkap','Belum lengkap'],
    ['semua','Semua'],
    ['belum','Belum'],
    ['sebagian','Sebagian'],
    ['sudah','Sudah'],
  ];
  return items.map(([v,l]) => `<option value="${v}" ${sel===v?'selected':''}>${l}</option>`).join('');
}

function pmtuGroupsHtml(rows){
  const map = new Map();
  for (const r of rows) {
    const key = r.aslab_username || '__none__';
    if (!map.has(key)) map.set(key, {
      key,
      name: key === '__none__' ? 'Belum ada aslab' : (r.aslab_name || key),
      wa: r.aslab_wa || '',
      units: [],
    });
    map.get(key).units.push(r);
  }
  const groups = [...map.values()];
  // Grup tanpa aslab di paling atas; grup dengan unit belum/sebagian di atas
  // grup yang semuanya sudah (yang terakhir ter-collapse).
  groups.sort((a,b) => {
    if (a.key === '__none__' && b.key !== '__none__') return -1;
    if (b.key === '__none__' && a.key !== '__none__') return 1;
    const ai = a.units.some(u => pmtuStatus(u) !== 'sudah') ? 0 : 1;
    const bi = b.units.some(u => pmtuStatus(u) !== 'sudah') ? 0 : 1;
    return ai - bi;
  });
  return groups.map(g => pmtuGroupHtml(g)).join('');
}

function pmtuGroupHtml(g){
  const belum    = g.units.filter(u => pmtuStatus(u) === 'belum').length;
  const sebagian = g.units.filter(u => pmtuStatus(u) === 'sebagian').length;
  const sudah    = g.units.filter(u => pmtuStatus(u) === 'sudah').length;
  const allDone  = belum === 0 && sebagian === 0;
  const waBtn = g.wa
    ? `<button type="button" class="btn btn-sm btn-primary" onclick="pmtuWa('${escAttr(g.key)}')">Ingatkan via WA</button>`
    : '';
  return `
  <div class="card pmtu-group" data-key="${escAttr(g.key)}">
    <div class="pmtu-group-head">
      <button type="button" class="pmtu-group-toggle" onclick="togglePmtuGrup('${escAttr(g.key)}')">
        <span class="pmtu-group-name">${esc(g.name)}</span>
        <span class="pmtu-group-badges">
          ${belum?`<span class="tag amber">Belum ${belum}</span>`:''}
          ${sebagian?`<span class="tag blue">Sebagian ${sebagian}</span>`:''}
          ${sudah?`<span class="tag green">Sudah ${sudah}</span>`:''}
        </span>
      </button>
      ${waBtn}
    </div>
    <div class="pmtu-group-body${allDone?' collapsed':''}">
      ${g.units.map(pmtuUnitHtml).join('')}
    </div>
  </div>`;
}

function pmtuUnitHtml(u){
  const key = u.module_id + '|' + u.kelompok;
  const s = pmtuStatus(u);
  const chipCls = s === 'sudah' ? 'a' : (s === 'sebagian' ? 'c' : 'na');
  const belumList = Array.isArray(u.belum_list) ? u.belum_list : [];
  const listHtml = belumList.length
    ? `<ul class="pmtu-belum-list">${belumList.map(b =>
        `<li>${esc(b.name || '')} <span class="pmtu-nrp">${esc(b.nrp || '—')}</span></li>`).join('')}</ul>`
    : `<p class="pmtu-empty">Semua praktikan sudah dinilai.</p>`;
  return `
  <div class="pmtu-unit" data-key="${escAttr(key)}">
    <button type="button" class="pmtu-unit-head" onclick="togglePmtuUnit('${escAttr(key)}')">
      <div class="pmtu-unit-title"><b>${esc(u.kode || '')}</b> — ${esc(u.judul || '')}</div>
      <div class="pmtu-unit-meta">Kelompok ${esc(u.kelompok)} · ${fmtTgl(u.tanggal)} · terlambat ${esc(u.hari_terlambat)} hari</div>
      <span class="score-chip ${chipCls}">${esc(pmtuStatusLabel(u))}</span>
    </button>
    <div class="pmtu-unit-belum collapsed">${listHtml}</div>
  </div>`;
}

function togglePmtuGrup(key){
  const el = document.querySelector('.pmtu-group[data-key="'+key+'"] .pmtu-group-body');
  if (el) el.classList.toggle('collapsed');
}

function togglePmtuUnit(key){
  const el = document.querySelector('.pmtu-unit[data-key="'+key+'"] .pmtu-unit-belum');
  if (el) el.classList.toggle('collapsed');
}

function pmtuSetFilter(k, v){
  window._pmtuF[k] = v;
  setContent(renderPemantauan());
}

async function pmtuReload(ses){
  setContent(loading('Memuat ulang…'));
  try {
    const [data, ringkas] = await Promise.all([apiPemantauanPenilaian(), apiPemantauanRingkas()]);
    window._pmtu = { data: data || [], ringkas };
    window._pmtuSes = ses;
    setContent(renderPemantauan());
  } catch(e) {
    toast('Gagal memuat ulang: ' + (e.message || e));
  }
}

function pmtuWa(key){
  const st = window._pmtu;
  if (!st) return;
  const rows = (st.data || []).filter(r => (r.aslab_username || '__none__') === key);
  const incomplete = rows.filter(r => pmtuStatus(r) !== 'sudah');
  if (!incomplete.length) { toast('Tidak ada unit yang belum lengkap.'); return; }
  const wa = (incomplete[0].aslab_wa || '').trim();
  if (!wa) { toast('Nomor WA aslab tidak tersedia.'); return; }
  const nama = incomplete[0].aslab_name || key;
  const list = incomplete.map(r =>
    `${r.kode || ''} — ${r.judul || ''} (Kelompok ${r.kelompok}, ${r.sudah_dinilai}/${r.total_praktikan} dinilai)`
  ).join('\n');
  const pesan =
`Halo Kak ${nama},

Praktikum berikut belum lengkap dinilai:
${list}

Mohon segera dilengkapi. Terima kasih.`;
  // Normalisasi nomor: buang karakter non-digit, lalu tambahkan awalan 62 bila diawali 0.
  let num = wa.replace(/\D/g, '');
  if (num.startsWith('0')) num = '62' + num.slice(1);
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(pesan)}`, '_blank');
}
