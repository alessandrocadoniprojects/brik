/**
 * Cleanup deterministico delle pagine prima di salvare la PREVIEW canonica.
 *
 * Obiettivo (Fase 3 — Step 1, integrità WYSIWYG): rimuovere alla fonte gli
 * anti-pattern correggibili senza LLM, così che la versione che l'utente vede in
 * preview — e che poi pubblica — sia già pulita. NON tocca struttura, copy,
 * layout, immagini, naming, CTA o direzione creativa: rimuove solo elementi
 * tecnici invisibili al senso del contenuto.
 *
 * Proprietà garantite: funzione PURA (nessun effetto collaterale), IDEMPOTENTE
 * (cleanup(cleanup(x)) === cleanup(x)) e conservativa sul markup attorno.
 *
 * NOTA sulla differenza col detector: il detector è un *segnalatore* e usa un
 * range emoji volutamente largo che include il blocco FRECCE (U+2190–U+21FF).
 * Qui invece *mutiamo* l'HTML, quindi siamo conservativi: NON rimuoviamo le
 * frecce (il design system usa "→" nelle CTA) né la punteggiatura tipografica
 * (· — × ecc.). Togliamo solo i pittogrammi emoji veri, i dingbat e i variation
 * selector. Eventuali simboli di confine restano segnalati dal detector ma non
 * vengono rimossi automaticamente.
 */
import type { SitePage } from '../core/index.js';

export type CleanupRule = 'strip-emoji' | 'strip-data-count';

export const DEFAULT_CLEANUP_RULES: readonly CleanupRule[] = ['strip-emoji', 'strip-data-count'];

// Pittogrammi emoji (piani 1F000–1FAFF), simboli vari + dingbat (2600–27BF) e
// variation selector (FE00–FE0F). Volutamente ESCLUSI: frecce (2190–21FF) e
// punteggiatura tipografica, usate dal design system.
const EMOJI_STRIP_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu;

// Attributo data-count (marcatore di animazione di brik), con o senza valore.
// Rimuoverlo lascia il numero/testo statico dentro lo span e disattiva
// l'animazione del contatore (lo script keya su [data-count]).
const DATA_COUNT_RE = /\s+data-count(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/gi;

/** Ripulisce una singola stringa HTML. Pura e idempotente. */
export function cleanupHtml(html: string, rules: readonly CleanupRule[] = DEFAULT_CLEANUP_RULES): string {
  if (!html) return html;
  let out = html;
  if (rules.includes('strip-emoji')) out = out.replace(EMOJI_STRIP_RE, '');
  if (rules.includes('strip-data-count')) out = out.replace(DATA_COUNT_RE, '');
  return out;
}

/** Applica cleanupHtml a tutte le pagine, preservando gli altri campi. */
export function cleanupPages(pages: readonly SitePage[], rules: readonly CleanupRule[] = DEFAULT_CLEANUP_RULES): SitePage[] {
  return pages.map((p) => (p.html ? { ...p, html: cleanupHtml(p.html, rules) } : { ...p }));
}
