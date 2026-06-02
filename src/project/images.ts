/**
 * Risolutore immagini (deterministico).
 *
 * Il generatore emette segnaposto come:
 *   <img data-brik-img="forno a legna pizza" alt="..." class="hero-img" />
 * Questo modulo raccoglie le query uniche su tutte le pagine, chiede a una
 * ImageSource (es. Pexels) un URL per ciascuna, e inietta il `src`. Se per una
 * query non c'e foto, rimuove il tag (niente immagini rotte).
 *
 * Tenuto fuori dal generatore LLM perche sia testabile e indipendente dal provider.
 */
import type { SitePage } from '@core';
import type { ImageSource } from '../adapters/images/pexels.js';

const IMG_TAG = /<img\b[^>]*?\bdata-brik-img="([^"]*)"[^>]*?>/gi;

/** Estrae le query uniche dei segnaposto immagine (esportata per i test). */
export function extractImageQueries(pages: readonly SitePage[]): string[] {
  const set = new Set<string>();
  for (const p of pages) {
    IMG_TAG.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMG_TAG.exec(p.html)) !== null) {
      const q = (m[1] ?? '').trim();
      if (q) set.add(q);
    }
  }
  return [...set];
}

/** Inserisce il src risolto in un singolo tag <img data-brik-img="...">. */
function fillTag(tag: string, url: string): string {
  return tag
    .replace(/\sdata-brik-img="[^"]*"/i, '')
    .replace(/<img\b/i, '<img src="' + url + '" loading="lazy"');
}

export async function resolveImages(pages: readonly SitePage[], images: ImageSource): Promise<SitePage[]> {
  const queries = extractImageQueries(pages);
  if (queries.length === 0) return pages.map((p) => ({ ...p }));

  const urls = new Map<string, string | null>();
  await Promise.all(queries.map(async (q) => urls.set(q, await images.search(q))));

  return pages.map((p) => {
    IMG_TAG.lastIndex = 0;
    const html = p.html.replace(IMG_TAG, (tag: string, q: string) => {
      const url = urls.get((q ?? '').trim());
      return url ? fillTag(tag, url) : '';
    });
    return { ...p, html };
  });
}
