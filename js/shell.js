'use strict';

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
      await apiAksesPemantauan().catch(()=>false);
    } else {
      const [mods,{users}] = await Promise.all([getMods(),api('getUsers',{},true)]);
      APP.modules=mods; APP.users=users;
    }
    renderApp();
  } catch(_) {}
}


const IC={
  profil: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.55 2.53a2 2 0 0 1 2.9 0l7.5 8A2 2 0 0 1 19.5 14H18v5a1 1 0 0 1-1 1h-3v-4h-4v4H7a1 1 0 0 1-1-1v-5H4.5a2 2 0 0 1-1.45-3.47l7.5-8z"/></svg>`,
  modul:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z"/><path d="M4 4v14a3 3 0 0 0 3 3h11"/></svg>`,
  jadwal:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>`,
  nilai:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 19V9M12 19V5M20 19v-7"/></svg>`,
  kontak:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  pemantauan:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 3h6v3H9z"/><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 13l2 2 4-4"/></svg>`,
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
  gravityEggRestoreFallen();
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
        ${IC[n.icon]}<span>${n.labelMob || n.label}</span>
      </a>`).join('');
  }
}
function setContent(html){
  document.getElementById('content').innerHTML=html;
}
