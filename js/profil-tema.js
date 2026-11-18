'use strict';

let _pp=null;
const closeModal=()=>{
  if(window._mustChangePassword) return;  // blokir sampai password diganti
  document.getElementById('modal-root').innerHTML='';_pp=null;
};
function logoutDariGantiPassword(){
  if(!confirm('Keluar dari akun ini? Anda perlu login ulang.'))return;
  window._mustChangePassword=false;
  document.getElementById('modal-root').innerHTML='';
  clearSession();CACHE={};showLanding();
}
function openEditModal(ses){
  if(typeof ses==='string') ses=JSON.parse(ses.replace(/&quot;/g,'"'));
  _pp=null;
  const mcp = !!window._mustChangePassword;
  document.getElementById('modal-root').innerHTML=`
  <div class="modal-back" id="m-back">
    <div class="modal">
      ${mcp?'<button class="modal-close" onclick="logoutDariGantiPassword()" title="Keluar">✕</button>':'<button class="modal-close" onclick="closeModal()">✕</button>'}
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
          <label>Password Saat Ini </label>
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
/* === EASTER EGG: efek gravitasi (Fitur 3, RENCANA_PERUBAHAN_v8.md) ===
   Trigger: 7 klik pada tombol TOGGLE TEMA (sidebar #btn-theme-sb atau
   tombol tema mobile di #mob-actions). Counter di state JS biasa (reset
   saat reload, tidak persist). Efek: elemen sidebar abu-abu (non-aktif)
   DAN isi halaman yang sedang dibuka (#content) jatuh ke bawah viewport
   (animasi ringan percepatan + bounce kecil), tetap di posisi jatuh (tidak
   auto-reset). Navigasi asli tetap jalan (link `<a>` tidak di-disable).
   Reset hanya via refresh manual. — */
const EGG_CLICKS_TARGET = 7;
function initGravityEgg(){
  window._eggClicks = 0;
  window._gravityTriggered = false;
  // Tombol toggle tema: sidebar (id) + mobile (onclick toggleTheme).
  const toggles = document.querySelectorAll('#btn-theme-sb, #mob-actions button[onclick*="toggleTheme"]');
  toggles.forEach(btn=>{
    if(btn.dataset.eggBound) return;
    btn.dataset.eggBound = '1';
    btn.addEventListener('click', ()=>{
      if(window._gravityTriggered) return;
      window._eggClicks = (window._eggClicks||0) + 1;
      if(window._eggClicks >= EGG_CLICKS_TARGET){
        gravityEggTrigger();
      }
    });
  });
}
function gravityEggTrigger(){
  window._gravityTriggered = true;
  // 1) sidebar abu-abu (non-aktif)
  const sbEls = document.querySelectorAll('#sidebar .sb-link:not(.active)');
  sbEls.forEach((el,i)=>{
    el.style.animationDelay = (i*0.06)+'s';
    el.classList.add('gravity-falling');
  });
  // 2) isi halaman yang sedang dibuka
  const content = document.getElementById('content');
  if(content){
    content.style.animationDelay = '0.2s';
    content.classList.add('gravity-falling');
  }
}
// Re-apply posisi jatuh (statis) ke nav item + #content yang baru dirender
// setelah renderApp -> buildNav, supaya efek tidak "pulih" saat pindah
// halaman. (Animasi gravity-falling cuma jalan sekali; setelah re-render
// pakai gravity-fallen = posisi akhir statis.)
function gravityEggRestoreFallen(){
  if(!window._gravityTriggered) return;
  document.querySelectorAll('#sidebar .sb-link:not(.active)').forEach(el=>{
    if(!el.classList.contains('gravity-falling')) el.classList.add('gravity-fallen');
  });
  const content = document.getElementById('content');
  if(content && !content.classList.contains('gravity-falling')){
    content.classList.add('gravity-fallen');
  }
}
