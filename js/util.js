'use strict';

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
