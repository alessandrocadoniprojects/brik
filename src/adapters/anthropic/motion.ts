/**
 * Motion condiviso per tutte le identità (iniettato in ogni pagina).
 * Un solo script che si adatta a ciò che trova nel DOM:
 *  - reveal (fade + translate) su [data-reveal] — sempre
 *  - reveal immagini su [data-img] — stile (scale/fade) definito dal CSS dell'identità
 *  - counter su [data-count] — solo se presenti (Editorial/Athletic sì, Scandinavian no)
 *  - parallax leggero su [data-parallax] — solo se presenti (solo Athletic)
 * Gated da html.brik-anim, aggiunta nel <head> prima del paint → niente flash.
 * Rispetta prefers-reduced-motion. Scanner-safe: niente eval/new Function/document.write.
 *
 * MOTION_CSS qui sotto è il reveal dell'identità Editorial (scale immagini + counter,
 * niente parallax). Athletic e Scandinavian includono il proprio motion-CSS nel
 * rispettivo blocco del design system. Il MOTION_JS è unico e vale per tutte.
 */

export const MOTION_CSS: string =
  '\n/* --- motion editorial (reveal + image reveal scale) --- */' +
  '\nhtml.brik-anim [data-reveal]{opacity:0;transform:translateY(26px);transition:opacity .9s cubic-bezier(.22,.61,.36,1),transform .9s cubic-bezier(.22,.61,.36,1)}' +
  '\nhtml.brik-anim [data-reveal].in{opacity:1;transform:none}' +
  '\nhtml.brik-anim [data-img] img,html.brik-anim [data-img] .art{transform:scale(1.12);opacity:0;transition:transform 1.25s cubic-bezier(.22,.61,.36,1),opacity 1.05s ease}' +
  '\nhtml.brik-anim [data-img].in img,html.brik-anim [data-img].in .art{transform:none;opacity:1}' +
  '\n@media (prefers-reduced-motion:reduce){html.brik-anim [data-reveal],html.brik-anim [data-img] img,html.brik-anim [data-img] .art{opacity:1!important;transform:none!important;transition:none!important}}\n';

export const MOTION_JS: string = `(function(){
try{
var R=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)');
if(R&&R.matches)return;
document.documentElement.classList.add('brik-anim');
function ease(t){return 1-Math.pow(1-t,3);}
function init(){
try{
['.hero-text','.hero-inner'].forEach(function(sel){document.querySelectorAll(sel+' [data-reveal]').forEach(function(el,i){el.style.transitionDelay=(i*0.09).toFixed(2)+'s';});});
['.service','.svc','.step','.figure'].forEach(function(sel){document.querySelectorAll(sel+'[data-reveal]').forEach(function(el,i){el.style.transitionDelay=(i*0.08).toFixed(2)+'s';});});
}catch(e){}
var px=[];
try{
var t=[].slice.call(document.querySelectorAll('[data-reveal],[data-img]'));
if('IntersectionObserver' in window){
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px',threshold:.07});
t.forEach(function(n){io.observe(n);});
}else{t.forEach(function(n){n.classList.add('in');});}
px=[].slice.call(document.querySelectorAll('[data-parallax]'));
}catch(e){}
try{
if(px.length){
var ticking=false;
function frame(){ticking=false;var vh=window.innerHeight||1;
for(var i=0;i<px.length;i++){var el=px[i];var r=el.getBoundingClientRect();
if(r.bottom<-200||r.top>vh+200)continue;
var c=(r.top+r.height/2)-vh/2;var amt=Math.max(-1,Math.min(1,c/vh));
el.style.setProperty('--py',(amt*-8).toFixed(2)+'%');}}
function onScroll(){if(!ticking){ticking=true;requestAnimationFrame(frame);}}
window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll,{passive:true});onScroll();
}
}catch(e){}
try{
[].slice.call(document.querySelectorAll('[data-count]')).forEach(function(el){
var raw=(el.textContent||'').trim();var m=raw.match(/^(\\d[\\d.,]*)$/);if(!m)return;
var ns=m[1].replace(/\\s/g,'');
var dm=ns.match(/^\\d{1,3}[.,](\\d{1,2})$/),decimals,target,thou;
if(dm){decimals=dm[1].length;target=parseFloat(ns.replace(',','.'));thou=false;}
else{decimals=0;target=parseInt(ns.replace(/[.,]/g,''),10);thou=/[.,]/.test(ns);}
if(isNaN(target))return;
function fmt(v){if(decimals>0)return v.toFixed(decimals).replace('.',',');var n=Math.round(v);return thou?n.toLocaleString('it-IT'):String(n);}
var started=false;function go(){if(started)return;started=true;var t0=null,dur=1500;
function step(ts){if(t0===null)t0=ts;var p=Math.min((ts-t0)/dur,1);el.textContent=fmt(target*ease(p));if(p<1)requestAnimationFrame(step);else el.textContent=fmt(target);}
requestAnimationFrame(step);}
if('IntersectionObserver' in window){var io2=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){go();io2.unobserve(el);}});},{threshold:.6});io2.observe(el);}else go();
});
}catch(e){}
}
if(document.readyState!=='loading')init();else document.addEventListener('DOMContentLoaded',init);
}catch(e){}
})();`;
