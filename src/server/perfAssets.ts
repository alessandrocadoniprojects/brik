/**
 * Ottimizzazioni di rendering per i siti pubblicati (local hosting + anteprima),
 * applicate come post-processing sull'HTML già generato — la generazione NON cambia.
 *
 *  1) Font esterni: i temi incorporano i woff2 come data-URI base64 (~100KB per pagina,
 *     incomprimibili, bloccano il primo render). Qui li ri-serviamo come file statici
 *     condivisi su `/_brik-fonts/<key>-<hash>.woff2` con cache immutabile di un anno:
 *     il browser li scarica una volta sola e li riusa su tutte le pagine e tutti i siti.
 *     Il `font-display:swap` resta quello del @font-face di origine.
 *  2) <img>: aggiungiamo `loading="lazy"` (tranne la prima immagine, sopra la piega,
 *     che resta eager per non penalizzare l'LCP), `decoding="async"` e — quando la
 *     dimensione è deducibile dai parametri URL (es. Pexels ?w=1200&h=627) — width/height
 *     per prevenire il layout shift. Attributi già presenti non vengono toccati.
 */
import { createHash } from 'node:crypto';
import { FONT_DATA } from '../adapters/anthropic/designSystem.js';
import { BASE_DOMAIN } from './localHosting.js';

/** Prefisso di route con cui il server risponde ai file di font condivisi. */
export const FONT_ROUTE_PREFIX = '/_brik-fonts/';

/** Host che serve i font: sempre il dominio principale, così vale anche per i siti
 *  su Cloudflare Pages e per i sottodomini prospect (cross-origin, con CORS aperto). */
const FONT_HOST = 'https://' + BASE_DOMAIN;

interface FontFile {
  readonly bytes: Buffer;
  readonly url: string;
  readonly file: string;
}

const byBase64 = new Map<string, FontFile>(); // base64 esatto del data-URI -> file
const byFile = new Map<string, Buffer>();      // nome file richiesto -> byte

for (const [key, b64] of Object.entries(FONT_DATA)) {
  const bytes = Buffer.from(b64, 'base64');
  const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 10);
  const file = key + '-' + hash + '.woff2'; // hash nel nome => cache immutabile sicura
  const info: FontFile = { bytes, url: FONT_HOST + FONT_ROUTE_PREFIX + file, file };
  byBase64.set(b64, info);
  byFile.set(file, bytes);
}

/** Byte del font per una route `/_brik-fonts/...`, o null se il file non esiste. */
export function serveFont(pathname: string): Buffer | null {
  if (!pathname.startsWith(FONT_ROUTE_PREFIX)) return null;
  return byFile.get(pathname.slice(FONT_ROUTE_PREFIX.length)) ?? null;
}

const FONT_URI_RE = /data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g;

/** Sostituisce i data-URI woff2 conosciuti con l'URL del file statico condiviso. */
export function externalizeFonts(html: string): string {
  if (html.indexOf('data:font/woff2;base64,') < 0) return html;
  return html.replace(FONT_URI_RE, (whole, b64: string) => byBase64.get(b64)?.url ?? whole);
}

/** Aggiunge loading/decoding e (dove deducibile) width/height alle <img> che non li hanno. */
export function enhanceImages(html: string): string {
  let n = 0;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    n += 1;
    let out = tag;
    if (!/\bloading\s*=/i.test(out)) out = out.replace(/<img\b/i, '<img loading="' + (n === 1 ? 'eager' : 'lazy') + '"');
    if (!/\bdecoding\s*=/i.test(out)) out = out.replace(/<img\b/i, '<img decoding="async"');
    if (!/\b(?:width|height)\s*=/i.test(out)) {
      const sm = out.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      const src = sm && sm[1] ? sm[1] : '';
      const w = src.match(/[?&](?:w|width)=(\d{2,4})(?:&|$)/i);
      const h = src.match(/[?&](?:h|height)=(\d{2,4})(?:&|$)/i);
      if (w && h) out = out.replace(/<img\b/i, '<img width="' + w[1] + '" height="' + h[1] + '"');
    }
    return out;
  });
}

/** Post-processing completo di una singola pagina pubblicata. */
export function optimizePublishedHtml(html: string): string {
  return enhanceImages(externalizeFonts(html));
}

/** Variante multi-pagina per il pipeline di pubblicazione. */
export function withPerf<T extends { html: string }>(pages: readonly T[]): T[] {
  return pages.map((p) => ({ ...p, html: optimizePublishedHtml(p.html) }));
}
