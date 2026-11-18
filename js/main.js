'use strict';

window.addEventListener('hashchange',()=>{ if(getSession()) renderApp(); });
document.addEventListener('DOMContentLoaded',()=>{
  applyTheme(localStorage.getItem('lp_theme') || 'light');
  initSidebar();
  initCursor();initWebGL();initLoginPanel();loadLandingModules();
  initGravityEgg();
  const ses=getSession();if(ses){showApp();}else{showLanding();}
});
