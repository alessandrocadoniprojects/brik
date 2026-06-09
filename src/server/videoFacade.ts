/**
 * Player YouTube "facade" (click-to-play) per i siti generati.
 *
 * Il generatore NON scrive CSS e NON inserisce <iframe>: emette solo segnaposto
 * semantici, p.es. <button class="brik-yt" data-yt="URL_O_ID">…</button> dentro
 * <div class="brik-yt-grid">. Qui iniettiamo (lato server, come guard/legal) il
 * CSS + un piccolo JS che mostra la thumbnail e carica il player SOLO al click.
 *
 * Privacy: usa youtube-nocookie.com e non carica nulla da YouTube finché l'utente
 * non preme play → nessun cookie di terze parti al caricamento (coerente col banner
 * cookie). La griglia è CSS grid auto-fill → si adatta a qualsiasi numero di video.
 */

const FACADE =
  '<style data-brik-yt-rt>' +
  '.brik-yt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;width:100%}' +
  '.brik-yt{position:relative;display:block;width:100%;aspect-ratio:16/9;border:0;padding:0;margin:0;' +
  'border-radius:14px;overflow:hidden;cursor:pointer;background:#0b0b0f center/cover no-repeat;box-sizing:border-box}' +
  '.brik-yt::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.20);transition:background .2s}' +
  '.brik-yt:hover::after{background:rgba(0,0,0,.06)}' +
  '.brik-yt-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:64px;height:64px;' +
  'border-radius:50%;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;z-index:2;' +
  'transition:transform .2s,background .2s;pointer-events:none}' +
  '.brik-yt:hover .brik-yt-play{transform:translate(-50%,-50%) scale(1.08);background:#ff0000}' +
  '.brik-yt-play svg{width:26px;height:26px;fill:#fff;margin-left:3px}' +
  '.brik-yt-title{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:12px 14px;color:#fff;' +
  'font:600 14px/1.3 system-ui,-apple-system,sans-serif;text-align:left;' +
  'background:linear-gradient(transparent,rgba(0,0,0,.72));text-shadow:0 1px 2px rgba(0,0,0,.5)}' +
  '.brik-yt iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:14px}' +
  '.brik-yt.is-playing::after,.brik-yt.is-playing .brik-yt-play,.brik-yt.is-playing .brik-yt-title{display:none}' +
  '</style>' +
  '<script data-brik-yt-rt>(function(){' +
  'function idOf(v){if(!v)return "";v=(""+v).trim();if(/^[\\w-]{11}$/.test(v))return v;' +
  'var m=v.match(/(?:youtu\\.be\\/|youtube\\.com\\/(?:watch\\?v=|embed\\/|shorts\\/|v\\/|live\\/))([\\w-]{11})/);return m?m[1]:"";}' +
  'function init(el){if(el.getAttribute("data-brik-yt-ready"))return;el.setAttribute("data-brik-yt-ready","1");' +
  'var id=idOf(el.getAttribute("data-yt"));if(!id)return;' +
  'el.style.backgroundImage="url(\'https://i.ytimg.com/vi/"+id+"/hqdefault.jpg\')";' +
  'if(!el.querySelector(".brik-yt-play")){var p=document.createElement("span");p.className="brik-yt-play";' +
  'p.innerHTML=\'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>\';el.appendChild(p);}' +
  'el.addEventListener("click",function(){if(el.querySelector("iframe"))return;' +
  'var f=document.createElement("iframe");' +
  'f.src="https://www.youtube-nocookie.com/embed/"+id+"?autoplay=1&rel=0";' +
  'f.title=el.getAttribute("aria-label")||"Video";' +
  'f.allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";' +
  'f.setAttribute("allowfullscreen","");el.classList.add("is-playing");el.appendChild(f);el.style.cursor="default";});}' +
  'function run(){var els=document.querySelectorAll(".brik-yt");for(var i=0;i<els.length;i++)init(els[i]);}' +
  'if(document.readyState!=="loading")run();else document.addEventListener("DOMContentLoaded",run);' +
  '})();</script>';

/** Inietta CSS+JS del facade prima di </body>, solo se la pagina contiene video e non già iniettato. */
export function injectVideoFacade(html: string): string {
  if (!html || html.indexOf('brik-yt') < 0 || html.indexOf('data-brik-yt-rt') >= 0) return html;
  const i = html.search(/<\/body>/i);
  return i < 0 ? html + FACADE : html.slice(0, i) + FACADE + html.slice(i);
}

/** Versione su lista di pagine (per la pubblicazione). */
export function withVideoFacade<T extends { html: string }>(pages: readonly T[]): T[] {
  return pages.map((p) => ({ ...p, html: injectVideoFacade(p.html) }));
}
