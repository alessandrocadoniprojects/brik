/**
 * Form di contatto DETERMINISTICO.
 *
 * Il generatore LLM non scrive il form: lascia il segnaposto <!--BRIK_CONTACT_FORM-->.
 * Qui costruiamo un form reale, accessibile e con recapito, in modo prevedibile e
 * testabile. Il blocco iniettato e delimitato da commenti, cosi prima di rigenerare
 * (fix/edit) lo riportiamo a segnaposto e lo ricostruiamo: il form resta sempre nostro.
 *
 * In QA (browser headless, navigator.webdriver === true) l'invio reale viene SALTATO:
 * la conferma appare comunque, ma non parte alcuna email di test.
 */
import type { ProjectSpec, SitePage, FormDeliveryDescriptor } from '@core';

export const CONTACT_MARKER = '<!--BRIK_CONTACT_FORM-->';
const FORM_START = '<!--BRIK_FORM_START-->';
const FORM_END = '<!--BRIK_FORM_END-->';
const INJECTED_RE = /<!--BRIK_FORM_START-->[\s\S]*?<!--BRIK_FORM_END-->/g;

const norm = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string): string => esc(s).replace(/"/g, '&quot;');
const slug = (label: string): string => norm(label).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'campo';

function fieldHtml(label: string): string {
  const name = slug(label);
  const id = 'bf_' + name;
  const l = norm(label);
  if (/mail/.test(l)) return `<p><label for="${id}">${esc(label)}</label><input id="${id}" name="${name}" type="email" required></p>`;
  if (/messagg|message|nota|note|richiest|descr/.test(l)) return `<p><label for="${id}">${esc(label)}</label><textarea id="${id}" name="${name}" rows="4" required></textarea></p>`;
  if (/tel|cellul|phone/.test(l)) return `<p><label for="${id}">${esc(label)}</label><input id="${id}" name="${name}" type="tel"></p>`;
  return `<p><label for="${id}">${esc(label)}</label><input id="${id}" name="${name}" type="text" required></p>`;
}

/** Costruisce il blocco form (delimitato). `descriptor` assente o action "#" => solo conferma, nessun invio. */
export function buildContactForm(
  fields: readonly { readonly label: string }[],
  confirmationText: string,
  descriptor?: FormDeliveryDescriptor,
): string {
  const action = descriptor?.action ?? '#';
  const hidden = Object.entries(descriptor?.hiddenFields ?? {})
    .map(([k, v]) => `<input type="hidden" name="${escAttr(k)}" value="${escAttr(v)}">`)
    .join('');
  const honeypot = '<input type="checkbox" name="botcheck" tabindex="-1" autocomplete="off" style="display:none !important">';
  const inputs = fields.map((f) => fieldHtml(f.label)).join('');
  const script =
    "(function(){var f=document.getElementById('brik-contact');if(!f)return;" +
    "var ok=f.querySelector('[data-brik-confirm]');var ko=f.querySelector('[data-brik-error]');var t0=Date.now();" +
    "f.addEventListener('submit',function(e){e.preventDefault();" +
    "function show(el){if(el){el.hidden=false;}}function reset(){try{f.reset();}catch(_){}}" +
    "if(navigator.webdriver||f.getAttribute('action')==='#'){show(ok);reset();return;}" +
    "if(ko){ko.hidden=true;}" +
    "var fd=new FormData(f);fd.append('_dt',String(Date.now()-t0));" +
    "fetch(f.action,{method:'POST',body:new URLSearchParams(fd)}).then(function(r){if(r.ok){show(ok);reset();}else{show(ko);}}).catch(function(){show(ko);});});})();";
  const form =
    `<form id="brik-contact" data-brik-form method="POST" action="${escAttr(action)}" novalidate>` +
    hidden +
    honeypot +
    inputs +
    '<button type="submit">Invia</button>' +
    `<div data-brik-confirm role="status" hidden>${esc(confirmationText)}</div>` +
    '<div data-brik-error role="alert" hidden>Invio non riuscito. Riprova piu tardi.</div>' +
    '</form>' +
    `<script>${script}</script>`;
  return `${FORM_START}\n${form}\n${FORM_END}`;
}

/** Riporta un eventuale blocco gia iniettato al segnaposto (per rigenerare in modo pulito). */
export function deInjectForms(pages: readonly SitePage[]): SitePage[] {
  return pages.map((p) => ({ route: p.route, html: p.html.replace(INJECTED_RE, CONTACT_MARKER) }));
}

/** Sostituisce il segnaposto con un form reale, per ogni pagina che ha un criterio form-submission. */
export function injectForms(
  pages: readonly SitePage[],
  spec: ProjectSpec,
  descriptor?: FormDeliveryDescriptor,
): SitePage[] {
  return pages.map((p) => {
    // normalizza eventuali blocchi precedenti, poi inietta
    let html = p.html.replace(INJECTED_RE, CONTACT_MARKER);
    if (!html.includes(CONTACT_MARKER)) return { route: p.route, html };
    const crit = spec.criteria.find((c) => c.check?.kind === 'form-submission' && c.check.route === p.route);
    if (crit && crit.check?.kind === 'form-submission') {
      const block = buildContactForm(crit.check.fields, crit.check.confirmationText, descriptor);
      html = html.split(CONTACT_MARKER).join(block);
    } else {
      html = html.split(CONTACT_MARKER).join(''); // segnaposto senza criterio → rimuovi
    }
    return { route: p.route, html };
  });
}
