// Stili e script per i "blocchi sezione" aggiunti dall'utente (mappa, galleria, FAQ, orari, form…).
// Iniettati una sola volta per pagina, sia in anteprima che in pubblicazione, così i blocchi
// sono nativi su qualunque tema: usano i token del design system (var(--line), var(--accent)…)
// con fallback per i temi chiari.

interface Page { readonly route: string; readonly html: string }

const BLOCK_CSS =
  '.brik-map,.brik-embed{position:relative;width:100%;aspect-ratio:16/9;border-radius:2px;overflow:hidden;border:1px solid var(--line,rgba(0,0,0,.12))}' +
  '.brik-map iframe,.brik-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}' +
  '.brik-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}' +
  '.brik-gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:2px}' +
  '.brik-hours,.brik-pricelist{display:grid;gap:.1rem;max-width:640px}' +
  '.brik-hours .row,.brik-pricelist .row{display:flex;justify-content:space-between;gap:1rem;padding:.65rem 0;border-bottom:1px solid var(--line,rgba(0,0,0,.12))}' +
  '.brik-pricelist .price{font-weight:600;white-space:nowrap}' +
  '.brik-faq details{border-top:1px solid var(--line,rgba(0,0,0,.12));padding:.95rem 0}' +
  '.brik-faq details:last-of-type{border-bottom:1px solid var(--line,rgba(0,0,0,.12))}' +
  '.brik-faq summary{cursor:pointer;font-weight:600;list-style:none}' +
  '.brik-faq summary::-webkit-details-marker{display:none}' +
  '.brik-faq .a{margin:.6rem 0 0;color:var(--ink-2,#666)}' +
  '.brik-team{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:22px}' +
  '.brik-team .m img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:2px;margin-bottom:.6rem}' +
  '.brik-social{display:flex;gap:1.2rem;flex-wrap:wrap}.brik-social a{color:var(--accent,#c6a87d)}' +
  '.brik-image img{width:100%;height:auto;display:block;border-radius:2px}' +
  '.brik-image .cap{display:block;margin-top:.8rem;font-size:.92rem;opacity:.7}' +
  '.brik-form{display:grid;gap:.7rem;max-width:520px}' +
  '.brik-form input,.brik-form textarea{width:100%;box-sizing:border-box;padding:.85em 1em;border:1px solid var(--line,rgba(0,0,0,.18));border-radius:2px;background:transparent;color:inherit;font:inherit}' +
  '.brik-form .brik-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}';

// Invio form lato client per i form aggiunti a mano (data-brik-form). Stesso contratto di /api/contact:
// urlencoded, honeypot "botcheck", tempo di compilazione "_dt". Salta i bot headless (QA).
const BLOCK_JS =
  '(function(){try{var fs=document.querySelectorAll("form[data-brik-form]");Array.prototype.forEach.call(fs,function(f){' +
  'if(f.getAttribute("data-brik-bound"))return;f.setAttribute("data-brik-bound","1");var t0=Date.now();' +
  'f.addEventListener("submit",function(e){e.preventDefault();if(navigator.webdriver)return;var fd=new FormData(f);' +
  'if(fd.get("botcheck"))return;var p=new URLSearchParams();fd.forEach(function(v,k){if(k!=="botcheck")p.append(k,v);});' +
  'p.append("_dt",String(Date.now()-t0));var msg=f.querySelector("[data-brik-form-msg]");' +
  'var btn=f.querySelector("button[type=submit],input[type=submit]");if(btn)btn.disabled=true;' +
  'fetch(f.getAttribute("action"),{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:p.toString()})' +
  '.then(function(r){return r.ok;}).then(function(ok){if(msg)msg.textContent=ok?"Grazie, ti ricontattiamo presto.":"Invio non riuscito, riprova.";if(ok)f.reset();if(btn)btn.disabled=false;})' +
  '.catch(function(){if(msg)msg.textContent="Errore di rete, riprova.";if(btn)btn.disabled=false;});});});}catch(e){}})();';

/** Inietta CSS (in head) e script form (in body) una sola volta. Idempotente. */
export function injectBlockAssets(html: string): string {
  let out = html;
  if (!out.includes('id="brik-blocks"')) {
    const style = '<style id="brik-blocks">' + BLOCK_CSS + '</style>';
    out = out.includes('</head>') ? out.replace('</head>', style + '</head>') : style + out;
  }
  if (!out.includes('id="brik-blocks-js"')) {
    const script = '<script id="brik-blocks-js">' + BLOCK_JS + '</script>';
    out = out.includes('</body>') ? out.replace('</body>', script + '</body>') : out + script;
  }
  return out;
}

export function withBlockAssets(pages: readonly Page[]): Page[] {
  return pages.map((p) => ({ ...p, html: injectBlockAssets(p.html) }));
}
