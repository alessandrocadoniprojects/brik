/**
 * Conformità per i siti pubblicati (punto roadmap: Privacy + Cookie + P.IVA in footer).
 *
 * Iniettato alla pubblicazione, quindi vale per TUTTI i siti (vecchi e nuovi), a
 * prescindere dal design "baked". Aggiunge: una riga footer legale (titolare/P.IVA/
 * indirizzo + link Privacy/Cookie), un banner cookie informativo NON bloccante, e
 * due pagine standalone /privacy e /cookie con testo base in italiano.
 *
 * NB: testo base ragionevole, non consulenza legale; il titolare può adattarlo.
 */

import { buildPrivacyPolicy, buildCookiePolicy, type LegalProfile, type LegalPurposes, type LegalCollectedData, type LegalThirdPartyServices, type CookieMode } from './legalProfile.js';

export interface LegalData {
  legalName?: string;
  vat?: string;
  address?: string;
  // Estensione Patch 8 — campi opzionali, retrocompatibili. Se assenti, le pagine
  // mantengono il testo base attuale; se presenti, vengono usati gli helper arricchiti.
  ownerName?: string;
  privacyEmail?: string;
  phone?: string;
  purposes?: LegalPurposes;
  collectedData?: LegalCollectedData;
  thirdPartyServices?: LegalThirdPartyServices;
  cookieMode?: CookieMode;
}

export interface LegalOpts {
  name: string; // nome attività (fallback se manca ragione sociale)
  email: string; // email di contatto del titolare
  legal: LegalData;
}

function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Mappa LegalData (fonte persistita) → LegalProfile (view-model per gli helper). Nessun fallback: i campi assenti restano assenti, così la validazione resta veritiera. */
export function legalDataToProfile(legal: LegalData): LegalProfile {
  const out: LegalProfile = {};
  if (legal.legalName) out.legalName = legal.legalName;
  if (legal.ownerName) out.ownerName = legal.ownerName;
  if (legal.vat) out.vatOrTaxId = legal.vat;
  if (legal.address) out.registeredAddress = legal.address;
  if (legal.privacyEmail) out.privacyEmail = legal.privacyEmail;
  if (legal.phone) out.phone = legal.phone;
  if (legal.purposes) out.purposes = legal.purposes;
  if (legal.collectedData) out.collectedData = legal.collectedData;
  if (legal.thirdPartyServices) out.thirdPartyServices = legal.thirdPartyServices;
  if (legal.cookieMode) out.cookieMode = legal.cookieMode;
  return out;
}

function anyFlag(obj: Record<string, unknown> | undefined): boolean {
  if (!obj) return false;
  return Object.values(obj).some((v) => v === true || (typeof v === 'string' && v.trim() !== ''));
}

/** True se l'utente ha compilato almeno un campo dell'estensione Patch 8. */
export function hasExtendedLegal(l: LegalData): boolean {
  return !!(
    (l.cookieMode && l.cookieMode.length) ||
    (l.privacyEmail && l.privacyEmail.trim()) ||
    (l.ownerName && l.ownerName.trim()) ||
    (l.phone && l.phone.trim()) ||
    anyFlag(l.purposes as Record<string, unknown> | undefined) ||
    anyFlag(l.collectedData as Record<string, unknown> | undefined) ||
    anyFlag(l.thirdPartyServices as Record<string, unknown> | undefined)
  );
}

function titolare(o: LegalOpts): string {
  const n = (o.legal.legalName || o.name || 'Il titolare').trim();
  const v = o.legal.vat ? ` — P.IVA ${o.legal.vat}` : '';
  const a = o.legal.address ? ` — ${o.legal.address}` : '';
  return esc(n + v + a);
}

/** Riga footer legale, stile adattivo (eredita il colore del testo del sito). */
function legalBar(o: LegalOpts): string {
  const year = new Date().getFullYear();
  const n = esc(o.legal.legalName || o.name || '');
  const v = o.legal.vat ? ' · P.IVA ' + esc(o.legal.vat) : '';
  const a = o.legal.address ? ' · ' + esc(o.legal.address) : '';
  return (
    '<div data-brik-legal style="font:13px/1.6 system-ui,-apple-system,sans-serif;text-align:center;' +
    'padding:18px 16px;opacity:.65;border-top:1px solid currentColor;color:inherit">' +
    '© ' + year + ' ' + n + v + a +
    ' · <a href="/privacy" style="color:inherit;text-decoration:underline">Privacy</a>' +
    ' · <a href="/cookie" style="color:inherit;text-decoration:underline">Cookie</a>' +
    '</div>'
  );
}

/** Banner cookie informativo, NON bloccante, dismissibile (preferenza in localStorage). */
const COOKIE_BANNER =
  '<div id="brik-cookie" data-brik-legal role="note" style="position:fixed;left:12px;right:12px;bottom:12px;' +
  'max-width:560px;margin:0 auto;background:#15151f;color:#eef1f7;font:13px/1.5 system-ui,-apple-system,sans-serif;' +
  'padding:13px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 40px rgba(0,0,0,.45);' +
  'z-index:2147483000;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">' +
  '<span style="flex:1;min-width:200px">Questo sito usa solo cookie tecnici necessari al funzionamento. ' +
  '<a href="/cookie" style="color:#9ab2ff;text-decoration:underline">Dettagli</a></span>' +
  '<button type="button" onclick="this.parentNode.remove();try{localStorage.setItem(\'brik_cookie_ok\',\'1\')}catch(e){}" ' +
  'style="cursor:pointer;border:0;border-radius:8px;padding:8px 16px;font:600 13px system-ui,sans-serif;' +
  'color:#0b0c12;background:#cdd4ff">Ho capito</button>' +
  '</div>' +
  '<script>try{if(localStorage.getItem(\'brik_cookie_ok\')){var b=document.getElementById(\'brik-cookie\');if(b)b.remove();}}catch(e){}</script>';

/** Pagina standalone leggibile su qualsiasi sfondo (tema chiaro neutro), noindex. */
function page(title: string, bodyHtml: string): string {
  return (
    '<!doctype html><html lang="it"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
    '<title>' + esc(title) + '</title><style>' +
    'body{margin:0;background:#f6f7f9;color:#1b1e28;font:16px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '.wrap{max-width:760px;margin:0 auto;padding:44px 22px 80px}' +
    'h1{font-size:1.85rem;line-height:1.2;margin:0 0 6px}h2{font-size:1.12rem;margin:1.7em 0 .3em}' +
    'p,li{color:#3a4051}a{color:#3b4ddb}.muted{color:#8a90a0;font-size:.84rem;margin-top:42px}' +
    '.back{display:inline-block;margin-bottom:26px;color:#3b4ddb;text-decoration:none}' +
    '</style></head><body><div class="wrap"><a class="back" href="/">← Torna al sito</a>' +
    bodyHtml +
    '</div></body></html>'
  );
}

function legalDateLabel(): string {
  try { return new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; }
}

function privacyPage(o: LegalOpts): string {
  if (hasExtendedLegal(o.legal)) {
    const prof = legalDataToProfile(o.legal);
    if (!prof.legalName && o.name) prof.legalName = o.name;
    if (!prof.privacyEmail && o.email) prof.privacyEmail = o.email;
    return page('Privacy Policy', buildPrivacyPolicy(prof, { dateLabel: legalDateLabel() }));
  }
  const mail = o.email ? `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>` : 'il titolare';
  return page('Privacy Policy', [
    '<h1>Informativa sulla privacy</h1>',
    `<p>La presente informativa descrive come vengono trattati i dati personali degli utenti che consultano questo sito, ai sensi del Regolamento (UE) 2016/679 (GDPR).</p>`,
    '<h2>Titolare del trattamento</h2>',
    `<p>${titolare(o)}. Per qualsiasi richiesta puoi scrivere a ${mail}.</p>`,
    '<h2>Dati trattati</h2>',
    '<p>Dati di navigazione raccolti automaticamente per il funzionamento e la sicurezza del sito (es. indirizzo IP, log tecnici). Dati che fornisci volontariamente tramite il modulo di contatto (es. nome, email, messaggio).</p>',
    '<h2>Finalità e base giuridica</h2>',
    '<p>I dati del modulo di contatto sono usati solo per rispondere alle tue richieste (esecuzione di misure precontrattuali / legittimo interesse). I dati tecnici sono trattati per il legittimo interesse a erogare il servizio in modo sicuro.</p>',
    '<h2>Conservazione</h2>',
    '<p>I dati sono conservati per il tempo necessario a gestire la richiesta e ad adempiere agli obblighi di legge, poi cancellati.</p>',
    '<h2>Comunicazione dei dati</h2>',
    '<p>I dati non sono diffusi. Possono essere trattati, come responsabili, dai fornitori tecnici che ospitano il sito e gestiscono l\'invio delle email.</p>',
    '<h2>I tuoi diritti</h2>',
    '<p>Puoi chiedere in qualsiasi momento accesso, rettifica, cancellazione, limitazione, opposizione e portabilità dei tuoi dati, scrivendo a ' + mail + '. Hai inoltre diritto di proporre reclamo al Garante per la protezione dei dati personali.</p>',
    '<p class="muted">Modello base fornito da brik. Adattalo alla tua attività se tratti dati ulteriori (es. newsletter, analytics, pagamenti).</p>',
  ].join(''));
}

function cookiePage(o: LegalOpts): string {
  if (hasExtendedLegal(o.legal)) {
    const prof = legalDataToProfile(o.legal);
    if (!prof.legalName && o.name) prof.legalName = o.name;
    return page('Cookie Policy', buildCookiePolicy(prof, { dateLabel: legalDateLabel() }));
  }
  return page('Cookie Policy', [
    '<h1>Cookie Policy</h1>',
    '<p>Questo sito utilizza esclusivamente <strong>cookie e tecnologie tecniche</strong> necessari al corretto funzionamento delle pagine. Non vengono utilizzati cookie di profilazione a fini pubblicitari.</p>',
    '<h2>Cosa usiamo</h2>',
    '<p>Memorizziamo localmente nel tuo browser una preferenza tecnica (per ricordare che hai chiuso l\'avviso sui cookie). Non servono per tracciarti e non sono condivisi con terzi.</p>',
    '<h2>Servizi di terze parti</h2>',
    '<p>Alcuni contenuti (es. font, mappe o video eventualmente incorporati) potrebbero impostare cookie propri quando presenti: in tal caso fanno riferimento alle informative dei rispettivi fornitori.</p>',
    '<h2>Gestione dei cookie</h2>',
    '<p>Puoi gestire o eliminare i cookie dalle impostazioni del tuo browser. La disattivazione dei cookie tecnici può compromettere il funzionamento del sito.</p>',
    '<h2>Titolare</h2>',
    `<p>${titolare(o)}${o.email ? ' — ' + esc(o.email) : ''}.</p>`,
    '<p class="muted">Modello base fornito da brik.</p>',
  ].join(''));
}

/** Inietta footer legale + banner cookie in ogni pagina e aggiunge /privacy e /cookie. */
export function withLegal<T extends { route: string; html: string }>(pages: readonly T[], o: LegalOpts): T[] {
  const bar = legalBar(o);
  const inject = (html: string): string => {
    if (html.includes('data-brik-legal')) return html;
    const add = bar + COOKIE_BANNER;
    const i = html.search(/<\/body>/i);
    return i < 0 ? html + add : html.slice(0, i) + add + html.slice(i);
  };
  const out = pages.map((p) => ({ ...p, html: inject(p.html) }));
  const routes = new Set(out.map((p) => p.route));
  const base = out[0];
  if (base && !routes.has('/privacy')) out.push({ ...base, route: '/privacy', html: privacyPage(o) });
  if (base && !routes.has('/cookie')) out.push({ ...base, route: '/cookie', html: cookiePage(o) });
  return out;
}
