/**
 * Pizzeria Pack v1 — Patch 1A: footer corretto + sanitizer placeholder.
 *
 * Vale per TUTTI i siti (non solo pizzerie). Due responsabilità, entrambe pure
 * e isolate dal motore di generazione/publish:
 *
 *  1) publicBusinessName(): sceglie il nome da mostrare nel footer con priorità
 *     esplicita, e NON lascia mai trapelare un id/slug tecnico (es. "site-abc123").
 *
 *  2) sanitizePublicHtml(): rimuove i placeholder comuni (telefoni/email/indirizzi
 *     finti, lorem ipsum, link/social fasulli) dall'HTML che va online, senza
 *     romperne la struttura. Conservativo per costruzione: tocca SOLO stringhe che
 *     sono inequivocabilmente segnaposto, quindi l'HTML reale resta intatto.
 *
 * NB: non sostituisce un placeholder con un altro placeholder. Rimuove, oppure (solo
 * per il nome del footer) usa il fallback umano "La tua attività".
 */

// ---------------------------------------------------------------------------
// 1) Nome pubblico
// ---------------------------------------------------------------------------

/** Vero se la stringa è un identificatore tecnico (project id, slug) e NON un nome leggibile. */
export function isTechnicalName(name: string, ctx?: { id?: string | undefined; projectName?: string | undefined }): boolean {
  const n = (name || '').trim();
  if (!n) return true;
  if (ctx?.id && n === ctx.id) return true; // è esattamente il project id
  if (ctx?.projectName && n === ctx.projectName) return true; // è esattamente lo slug del sottodominio
  if (/^site-[a-z0-9]{4,}$/i.test(n)) return true; // formato di newId(): 'site-' + base36
  return false;
}

/** Ripulisce un nome senza alterarlo: trim, spazi singoli, niente separatori penzolanti. */
function cleanName(s?: string | null): string {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[\s·,–—-]+|[\s·,–—-]+$/g, '')
    .trim();
}

/**
 * Nome da mostrare al pubblico, in ordine di priorità:
 *   1) businessName rilevato (se passato e non tecnico)
 *   2) titolo del sito (se non tecnico)
 *   3) fallback umano "La tua attività"
 * Non restituisce MAI un id/slug tecnico.
 */
export function publicBusinessName(opts: {
  title?: string | null;
  businessName?: string | null;
  id?: string | undefined;
  projectName?: string | undefined;
}): string {
  const ctx = { id: opts.id, projectName: opts.projectName };
  for (const cand of [opts.businessName, opts.title]) {
    const n = cleanName(cand);
    if (n && !isTechnicalName(n, ctx)) return n;
  }
  return 'La tua attività';
}

// ---------------------------------------------------------------------------
// 2) Sanitizer placeholder
// ---------------------------------------------------------------------------

/**
 * Pattern di SEGNAPOSTO inequivocabili. Volutamente specifici: niente euristiche
 * aggressive che rischierebbero di colpire dati reali (un numero vero, un indirizzo
 * vero, una parola comune). Ciò che non è chiaramente finto NON viene toccato.
 */
const PLACEHOLDER_RES: readonly RegExp[] = [
  // Telefoni fittizi citati + qualsiasi numero con molti zeri/sequenza ovvia
  /\b045[\s.\-]?000[\s.\-]?0000\b/gi,
  /\b0{3}[\s.\-]?0{3}[\s.\-]?0{4}\b/gi,
  /\b123[\s.\-]?456[\s.\-]?7890\b/gi,
  /(?:\+?\d{1,3}[\s.\-]?)?(?:0[\s.\-]?){6,}\d?\b/g, // ≥6 zeri separati = numero placeholder
  // Email fittizie
  /[a-z0-9._%+-]+@example\.(?:com|org|net|it)\b/gi,
  /\bemail@[a-z0-9.\-]+\.[a-z]{2,}\b/gi,
  // Domini/URL fittizi
  /(?:https?:\/\/)?(?:www\.)?example\.(?:com|org|net|it)\b/gi,
  // Indirizzo placeholder inequivocabile (NON "Via Roma 1": potrebbe essere reale)
  /\bVia\s+Esempio\b/gi,
  // Nomi segnaposto
  /\bNome\s+Pizzeria\b/gi,
  /\bLa\s+tua\s+pizzeria\b/gi,
  // Slug tecnico nel contenuto
  /\bsite-[a-z0-9]{4,}\b/gi,
  // Lorem ipsum (rimuove il testo fino al prossimo tag, senza toccare i tag)
  /lorem\s+ipsum[^<]*/gi,
  // Social fasulli (handle segnaposto noti)
  /\b(?:facebook|instagram|twitter|x|tiktok|linkedin)\.com\/(?:yourpage|username|example|tuonome|tua-?pagina|handle|profilo)\b/gi,
];

/** Vero se la stringa contiene almeno un segnaposto noto. */
function containsPlaceholder(s: string): boolean {
  if (!s) return false;
  return PLACEHOLDER_RES.some((re) => {
    re.lastIndex = 0; // le regex /g mantengono lastIndex: azzero prima di test()
    return re.test(s);
  });
}

/** Rimuove tutte le occorrenze di segnaposto dalla stringa (sostituzione con vuoto). */
function stripPlaceholders(s: string): string {
  let out = s;
  for (const re of PLACEHOLDER_RES) out = out.replace(re, '');
  return out;
}

/**
 * Gli <a> il cui href/testo contiene un segnaposto vengono "scollegati":
 * se resta del testo reale lo si conserva (senza link), altrimenti si rimuove tutto.
 * Così niente link mailto:/tel:/maps fasulli, ma il flusso del documento non si rompe.
 */
function unwrapPlaceholderAnchors(html: string): string {
  return html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (full, inner) => {
    if (!containsPlaceholder(full)) return full;
    const innerSan = stripPlaceholders(String(inner));
    const innerText = innerSan.replace(/<[^>]+>/g, '').trim();
    return innerText ? innerSan : ''; // tiene il testo senza link, o elimina l'anchor
  });
}

/**
 * Ripulisce l'HTML che va online dai segnaposto comuni. Pura e idempotente:
 * se non ci sono segnaposto, restituisce l'HTML invariato.
 */
export function sanitizePublicHtml(html: string): string {
  if (!html) return html;
  let out = unwrapPlaceholderAnchors(html);
  out = stripPlaceholders(out);
  return out;
}

/** Applica il sanitizer a una lista di pagine (per la catena di publish). */
export function withPublicSanitize<T extends { html: string }>(pages: readonly T[]): T[] {
  return pages.map((p) => ({ ...p, html: sanitizePublicHtml(p.html) }));
}
