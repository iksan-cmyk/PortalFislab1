'use strict';

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
    alert('File modul belum tersedia untuk modul ini. Hubungi admin.'); return;
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
