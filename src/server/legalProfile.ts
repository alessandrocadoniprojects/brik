/**
 * Pizzeria Pack v1 — Patch 8: Legal settings (helper puri).
 *
 * NOTA DI ARCHITETTURA — leggere prima di agganciare.
 * Esiste già un sistema legale in produzione (`legal.ts`): tipo `LegalData
 * {legalName, vat, address}`, pannello Settings, endpoint `POST /api/projects/:id/legal`,
 * pagine `/privacy` e `/cookie` generate da `withLegal`, footer + cookie banner.
 * Questo modulo NON crea una persistenza parallela: fornisce solo generatori più ricchi e
 * cookie-mode-aware, riutilizzabili dal sistema esistente una volta esteso `LegalData`.
 *
 * Mappatura per la futura convergenza (un solo tipo, niente doppione):
 *   LegalProfile.legalName        ↔ LegalData.legalName
 *   LegalProfile.vatOrTaxId       ↔ LegalData.vat
 *   LegalProfile.registeredAddress↔ LegalData.address
 *   (privacyEmail, phone, websiteUrl, purposes, collectedData,
 *    thirdPartyServices, cookieMode = nuovi campi da aggiungere a LegalData)
 *
 * Regola dati: nessun campo viene mai inventato. Se un dato manca, la riga è omessa
 * (mai placeholder) e `validateLegalProfile` emette un warning.
 */

export type CookieMode = 'technical-only' | 'basic-analytics' | 'full-analytics' | 'marketing-pixel' | 'unknown';

export interface LegalPurposes {
  businessInfo?: boolean;
  contactRequests?: boolean;
  reservations?: boolean;
  whatsapp?: boolean;
  newsletter?: boolean;
  analytics?: boolean;
  marketing?: boolean;
}

export interface LegalCollectedData {
  name?: boolean;
  email?: boolean;
  phone?: boolean;
  message?: boolean;
  reservationPreference?: boolean;
  other?: string;
}

export interface LegalThirdPartyServices {
  cloudflareHosting?: boolean;
  emailProvider?: boolean;
  googleMaps?: boolean;
  youtubeVimeo?: boolean;
  metaPixel?: boolean;
  googleAds?: boolean;
  whatsapp?: boolean;
  instagramFacebookLinks?: boolean;
  analytics?: boolean;
}

/**
 * View-model per il rendering delle policy. NON è una struttura persistita: la fonte
 * dati è `LegalData` (legal.ts). Qui vive solo come forma intermedia per gli helper.
 */
export interface LegalProfile {
  legalName?: string;
  ownerName?: string;
  vatOrTaxId?: string;
  registeredAddress?: string;
  privacyEmail?: string;
  phone?: string;
  websiteUrl?: string;
  purposes?: LegalPurposes;
  collectedData?: LegalCollectedData;
  thirdPartyServices?: LegalThirdPartyServices;
  cookieMode?: CookieMode;
}

/** Copy obbligatorio: Brik prepara basi modificabili, non è un consulente legale. */
export const LEGAL_DISCLAIMER =
  'Brik può aiutarti a preparare una privacy/cookie policy base con i dati che inserisci. Per esigenze specifiche o attività complesse, verifica sempre con un consulente.';

function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function p(profile: LegalProfile | undefined | null): LegalProfile {
  return profile || {};
}

// --- Titolare del trattamento (solo campi presenti) -------------------------

function ownerLines(pr: LegalProfile): string[] {
  const out: string[] = [];
  if (pr.legalName && pr.legalName.trim()) out.push('Titolare del trattamento: ' + esc(pr.legalName.trim()));
  if (pr.ownerName && pr.ownerName.trim()) out.push('Rappresentante: ' + esc(pr.ownerName.trim()));
  if (pr.vatOrTaxId && pr.vatOrTaxId.trim()) out.push('P.IVA / C.F.: ' + esc(pr.vatOrTaxId.trim()));
  if (pr.registeredAddress && pr.registeredAddress.trim()) out.push('Sede: ' + esc(pr.registeredAddress.trim()));
  if (pr.privacyEmail && pr.privacyEmail.trim()) out.push('Email per richieste privacy: ' + esc(pr.privacyEmail.trim()));
  if (pr.phone && pr.phone.trim()) out.push('Telefono: ' + esc(pr.phone.trim()));
  if (pr.websiteUrl && pr.websiteUrl.trim()) out.push('Sito: ' + esc(pr.websiteUrl.trim()));
  return out;
}

const PURPOSE_LABELS: Record<string, string> = {
  businessInfo: 'fornire informazioni sull’attività',
  contactRequests: 'gestire le richieste di contatto',
  reservations: 'gestire le prenotazioni',
  whatsapp: 'rispondere ai contatti via WhatsApp',
  newsletter: 'inviare comunicazioni/newsletter (previo consenso)',
  analytics: 'produrre statistiche di utilizzo del sito',
  marketing: 'attività di marketing (previo consenso)',
};

const DATA_LABELS: Record<string, string> = {
  name: 'nome',
  email: 'indirizzo email',
  phone: 'numero di telefono',
  message: 'contenuto del messaggio',
  reservationPreference: 'preferenze di prenotazione',
};

const SERVICE_LABELS: Record<string, string> = {
  cloudflareHosting: 'hosting del sito (Cloudflare)',
  emailProvider: 'servizio di invio email',
  googleMaps: 'mappe (Google Maps)',
  youtubeVimeo: 'video YouTube incorporati',
  metaPixel: 'Meta Pixel (Facebook/Instagram)',
  googleAds: 'Google Ads',
  whatsapp: 'WhatsApp',
  instagramFacebookLinks: 'collegamenti ai profili Instagram/Facebook',
  analytics: 'strumenti di analisi statistica',
};

// Servizi esposti dal pannello ma che Brik NON inietta nei siti pubblicati: non vanno
// dichiarati come trattamenti attivi nelle informative (lato Settings generano warning).
const UNSUPPORTED_SERVICES = ['metaPixel', 'googleAds', 'analytics'] as const;
function injectedServices(svc: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(svc || {}) };
  for (const k of UNSUPPORTED_SERVICES) delete out[k];
  return out;
}

function flagList(obj: Record<string, unknown> | undefined, labels: Record<string, string>): string[] {
  if (!obj) return [];
  return Object.keys(labels).filter((k) => obj[k] === true).map((k) => labels[k] as string);
}

function ul(items: string[]): string {
  return '<ul>' + items.map((i) => '<li>' + i + '</li>').join('') + '</ul>';
}

// --- Privacy policy ---------------------------------------------------------

const PURPOSE_BASIS: Record<string, string> = {
  businessInfo: 'legittimo interesse del titolare a presentare la propria attività',
  contactRequests: 'esecuzione di misure precontrattuali e legittimo interesse a rispondere',
  reservations: 'esecuzione del servizio richiesto dall’interessato',
  whatsapp: 'legittimo interesse a gestire la conversazione avviata dall’utente',
  newsletter: 'consenso dell’interessato',
  analytics: 'consenso dell’interessato (o legittimo interesse se in forma anonimizzata)',
  marketing: 'consenso dell’interessato',
};

// Servizi che possono comportare un trasferimento di dati fuori dallo Spazio Economico Europeo.
const SERVICE_EXTRA_EU: Record<string, string> = {
  cloudflareHosting: 'Cloudflare (hosting/CDN)',
  emailProvider: 'fornitore di invio email',
  googleMaps: 'Google Maps',
  youtubeVimeo: 'YouTube',
  metaPixel: 'Meta',
  googleAds: 'Google',
  analytics: 'fornitore di analisi statistica',
};

export interface LegalDocMeta {
  dateLabel?: string;
}

export function buildPrivacyPolicy(profile: LegalProfile | undefined | null, opts?: LegalDocMeta): string {
  const pr = p(profile);
  const dateLabel = opts && opts.dateLabel ? opts.dateLabel : '';
  const svc = (pr.thirdPartyServices || {}) as Record<string, unknown>;
  const parts: string[] = [];
  parts.push('<h1>Privacy Policy</h1>');
  parts.push('<p class="brik-legal-note">' + esc(LEGAL_DISCLAIMER) + '</p>');
  parts.push('<p>La presente informativa descrive come vengono trattati i dati personali degli utenti che consultano questo sito, ai sensi del Regolamento (UE) 2016/679 (GDPR).</p>');

  const owner = ownerLines(pr);
  parts.push('<h2>Titolare del trattamento</h2>');
  if (owner.length) parts.push(ul(owner));
  else parts.push('<p>Il titolare del trattamento è il gestore di questo sito. Inserisci i dati identificativi (ragione sociale, P.IVA, sede, email) per completare l’informativa.</p>');

  parts.push('<h2>Tipologie di dati trattati</h2>');
  const dataItems: string[] = ['<strong>Dati di navigazione</strong>: raccolti automaticamente per il funzionamento e la sicurezza del sito (es. indirizzo IP, log tecnici, tipo di browser).'];
  const provided = flagList(pr.collectedData as Record<string, unknown> | undefined, DATA_LABELS);
  if (pr.collectedData && pr.collectedData.other && pr.collectedData.other.trim()) provided.push(esc(pr.collectedData.other.trim()));
  if (provided.length) dataItems.push('<strong>Dati forniti volontariamente</strong> tramite i moduli del sito: ' + provided.join(', ') + '.');
  parts.push(ul(dataItems));

  parts.push('<h2>Finalità e base giuridica</h2>');
  const purposeKeys = Object.keys(PURPOSE_LABELS).filter((k) => pr.purposes && (pr.purposes as Record<string, unknown>)[k] === true);
  if (purposeKeys.length) {
    parts.push('<p>I dati sono trattati per le seguenti finalità:</p>');
    parts.push(ul(purposeKeys.map((k) => (PURPOSE_LABELS[k] as string) + ' — base giuridica: ' + (PURPOSE_BASIS[k] || 'legittimo interesse'))));
  } else {
    parts.push('<p>I dati inviati tramite il sito sono trattati per gestire la richiesta di contatto dell’utente (esecuzione di misure precontrattuali e legittimo interesse del titolare).</p>');
  }

  const inj = injectedServices(svc);
  const services = flagList(inj, SERVICE_LABELS);
  if (services.length) {
    parts.push('<h2>Servizi di terze parti e responsabili del trattamento</h2>');
    parts.push('<p>Il sito si avvale dei seguenti servizi, i cui fornitori possono trattare dati come responsabili del trattamento o titolari autonomi secondo le rispettive informative:</p>' + ul(services));
  }

  const extraEu = Object.keys(SERVICE_EXTRA_EU).filter((k) => inj[k] === true).map((k) => SERVICE_EXTRA_EU[k] as string);
  if (extraEu.length) {
    parts.push('<h2>Trasferimento dei dati fuori dall’Unione Europea</h2>');
    parts.push('<p>Alcuni servizi utilizzati (' + extraEu.join(', ') + ') possono comportare il trasferimento di dati verso paesi terzi, anche fuori dallo Spazio Economico Europeo. In tal caso il trasferimento avviene sulla base delle garanzie adeguate previste dagli artt. 44 e seguenti del GDPR (ad esempio le clausole contrattuali standard adottate dalla Commissione Europea).</p>');
  }

  parts.push('<h2>Conservazione</h2>');
  parts.push('<p>I dati sono conservati per il tempo necessario a gestire la richiesta e ad adempiere agli obblighi di legge, dopodiché vengono cancellati o resi anonimi. I dati trattati sulla base del consenso sono conservati fino a revoca dello stesso.</p>');

  parts.push('<h2>Processo decisionale automatizzato</h2>');
  // Profilazione dichiarata SOLO se Brik inietta davvero uno strumento di marketing.
  // metaPixel/googleAds sono esclusi da injectedServices finché non vengono iniettati.
  const profiling = inj.metaPixel === true || inj.googleAds === true;
  if (profiling) parts.push('<p>Gli strumenti di marketing eventualmente attivi possono effettuare profilazione a fini pubblicitari. Tale trattamento avviene esclusivamente previo consenso dell’utente, revocabile in qualsiasi momento.</p>');
  else parts.push('<p>Non viene effettuato alcun processo decisionale automatizzato né alcuna profilazione degli utenti.</p>');

  parts.push('<h2>Diritti dell’interessato</h2>');
  const mail = pr.privacyEmail && pr.privacyEmail.trim() ? esc(pr.privacyEmail.trim()) : '';
  const consentBased = !!(pr.purposes && (pr.purposes.newsletter === true || pr.purposes.marketing === true || pr.purposes.analytics === true));
  parts.push('<p>Puoi esercitare in qualsiasi momento i diritti di accesso, rettifica, cancellazione, limitazione, opposizione e portabilità dei dati' + (mail ? ' scrivendo a ' + mail : ', contattando il titolare') + '.' + (consentBased ? ' Quando il trattamento si basa sul consenso, puoi revocarlo in qualsiasi momento senza pregiudicare la liceità del trattamento effettuato prima della revoca.' : '') + ' Hai inoltre il diritto di proporre reclamo all’Autorità Garante per la protezione dei dati personali.</p>');

  parts.push('<h2>Cookie</h2>');
  parts.push('<p>Per i cookie e le tecnologie di tracciamento utilizzati dal sito, consulta la Cookie Policy.</p>');

  if (dateLabel) parts.push('<p class="brik-legal-meta">Ultimo aggiornamento: ' + esc(dateLabel) + '.</p>');
  return parts.join('');
}

// --- Cookie policy (mode-aware) ---------------------------------------------

// I siti generati da Brik installano SOLO cookie tecnici. I contenuti di terze parti
// non vengono caricati al primo load: i video YouTube usano un facade (player al clic),
// le mappe e i social sono semplici collegamenti esterni. Nessun consenso preventivo,
// nessun banner di consenso. I flag non iniettati (pixel/ads/analytics) non compaiono qui.
function cookieBody(pr: LegalProfile): { html: string; consentRequired: boolean } {
  const svc = (pr.thirdPartyServices || {}) as Record<string, unknown>;
  const parts: string[] = [
    '<p>Questo sito utilizza esclusivamente <strong>cookie tecnici</strong> necessari al suo funzionamento. ' +
    'Per i soli cookie tecnici la normativa non richiede il consenso preventivo né un banner di consenso.</p>',
  ];
  const ext: string[] = [];
  if (svc.youtubeVimeo === true) {
    ext.push('gli eventuali <strong>video YouTube</strong> sono mostrati come anteprima e il player viene caricato (in modalità senza cookie) <strong>solo dopo che l’utente fa clic su «play»</strong>, perciò al primo caricamento della pagina non viene impostato alcun cookie di terze parti');
  }
  if (svc.googleMaps === true) {
    ext.push('gli eventuali riferimenti a <strong>Google Maps</strong> sono <strong>collegamenti</strong> che aprono il sito di Google in una nuova scheda: non incorporano mappe nella pagina e non impostano cookie');
  }
  if (svc.instagramFacebookLinks === true || svc.whatsapp === true) {
    ext.push('i pulsanti verso <strong>social network</strong> o <strong>WhatsApp</strong> sono semplici <strong>collegamenti esterni</strong> che non caricano contenuti di terze parti nella pagina');
  }
  if (ext.length) {
    parts.push('<p>Riguardo ai contenuti di terze parti: ' + ext.join('; ') + '.</p>');
  }
  return { consentRequired: false, html: parts.join('') };
}

export function buildCookiePolicy(profile: LegalProfile | undefined | null, opts?: LegalDocMeta): string {
  const pr = p(profile);
  const dateLabel = opts && opts.dateLabel ? opts.dateLabel : '';
  const svc = (pr.thirdPartyServices || {}) as Record<string, unknown>;
  const parts: string[] = [];
  parts.push('<h1>Cookie Policy</h1>');
  parts.push('<p class="brik-legal-note">' + esc(LEGAL_DISCLAIMER) + '</p>');
  parts.push('<p>I cookie sono piccoli file di testo che i siti web salvano sul dispositivo dell’utente. Questo sito li utilizza nei termini descritti di seguito.</p>');

  const body = cookieBody(pr);
  parts.push(body.html);

  // Solo cookie tecnici: Brik non inietta pixel/analytics e non incorpora contenuti che
  // caricano cookie al primo load (video = facade al clic, mappe/social = link esterni).
  const cats: string[] = ['<strong>Cookie tecnici</strong>: necessari al funzionamento del sito; non richiedono il consenso.'];
  if (svc.cloudflareHosting === true) cats.push('<strong>Cookie tecnici di sicurezza</strong>: impostati dall’infrastruttura di hosting per la sicurezza e la stabilità del sito; sono cookie tecnici e non richiedono il consenso.');
  parts.push('<h2>Categorie di cookie utilizzate</h2>' + ul(cats));

  // Servizi di terze parti realmente presenti, attivati SOLO da un'azione dell'utente.
  const thirdInfo: string[] = [];
  if (svc.youtubeVimeo === true) thirdInfo.push('<strong>YouTube</strong> (solo dopo il clic su «play»)');
  if (svc.googleMaps === true) thirdInfo.push('<strong>Google Maps</strong> (solo aprendo il collegamento esterno)');
  if (thirdInfo.length) {
    parts.push('<h2>Servizi di terze parti</h2>');
    parts.push('<p>Solo quando l’utente sceglie di attivarli, i seguenti servizi possono trattare dati secondo le proprie informative: ' + thirdInfo.join(', ') + '. Fino a quel momento non vengono caricati e non impostano cookie.</p>');
  }

  parts.push('<h2>Gestione e revoca</h2>');
  parts.push('<p>Puoi gestire o eliminare i cookie dalle impostazioni del tuo browser. La disattivazione dei cookie tecnici può compromettere il funzionamento del sito.' + (body.consentRequired ? ' Per i cookie che richiedono il consenso puoi modificare o revocare le tue scelte in qualsiasi momento tramite l’apposito banner o pannello delle preferenze.' : '') + '</p>');

  if (dateLabel) parts.push('<p class="brik-legal-meta">Ultimo aggiornamento: ' + esc(dateLabel) + '.</p>');
  return parts.join('');
}

// --- Validazione (warnings, mai blocco) -------------------------------------

export function validateLegalProfile(profile: LegalProfile | undefined | null): string[] {
  const pr = p(profile);
  const w: string[] = [];
  if (!pr.legalName || !pr.legalName.trim()) w.push('Manca la ragione sociale / nome legale dell’attività.');
  if (!pr.vatOrTaxId || !pr.vatOrTaxId.trim()) w.push('Manca la P.IVA o il codice fiscale.');
  if (!pr.registeredAddress || !pr.registeredAddress.trim()) w.push('Manca la sede / indirizzo legale.');
  if (!pr.privacyEmail || !pr.privacyEmail.trim()) w.push('Manca l’email per le richieste privacy.');
  const svc = pr.thirdPartyServices || {};
  // Flag dichiarati ma NON iniettati da Brik: non vanno descritti come trattamenti attivi.
  const notInjected: string[] = [];
  if (svc.metaPixel === true) notInjected.push('Meta Pixel');
  if (svc.googleAds === true) notInjected.push('Google Ads');
  if (svc.analytics === true) notInjected.push('strumenti di analisi statistica');
  if (notInjected.length) {
    w.push('Hai indicato ' + notInjected.join(', ') + ', ma Brik non inserisce questi strumenti nei siti pubblicati: non verranno dichiarati come trattamenti attivi nella policy. Se in futuro li aggiungi manualmente, dovrai predisporre un sistema di consenso (banner) che li blocchi prima dell’accettazione.');
  }
  // Vimeo non è supportato: i video sono incorporati solo via YouTube (facade al clic).
  if (svc.youtubeVimeo === true) {
    w.push('I video vengono incorporati solo tramite YouTube, con caricamento al clic (nessun cookie prima del «play»). Vimeo non è supportato: un eventuale video Vimeo non verrà incorporato automaticamente.');
  }
  return w;
}
