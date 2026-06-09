/**
 * Parsing dell'HTML per l'import da URL (punto 2 — import da sito).
 *
 * Funzioni PURE (niente rete): estraggono titolo, testo leggibile e URL delle
 * immagini da una pagina HTML. Il fetch e le guardie di sicurezza stanno nel
 * server; qui solo manipolazione di stringhe, così è testabile in isolamento.
 */

/** Decodifica le entità HTML più comuni. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => { try { return String.fromCodePoint(Number(d)); } catch { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } });
}

/** Estrae titolo e testo leggibile da una pagina HTML, senza DOM. */
export function htmlToText(html: string): { title: string; text: string } {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeEntities((ogTitle?.[1] || titleTag?.[1] || '').trim()).slice(0, 200);
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|table|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text: s };
}

/** Da un srcset prende un URL rappresentativo (l'ultimo candidato, di solito il più grande). */
function pickFromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  const cands = srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
  return cands.length ? cands[cands.length - 1] : undefined;
}

/** Raccoglie gli URL immagine della pagina (assoluti, deduplicati, max 12). */
export function extractImageUrls(html: string, baseUrl: string): { url: string; alt?: string }[] {
  const urls = new Map<string, string>();
  const add = (raw: string | undefined, alt: string) => {
    if (!raw) return;
    let abs: string;
    try { abs = new URL(raw, baseUrl).toString(); } catch { return; }
    if (!/^https?:/i.test(abs) || /\.svg(\?|$)/i.test(abs)) return;
    if (!urls.has(abs)) urls.set(abs, (alt || '').trim());
  };
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og) add(og[1], '');
  let m: RegExpExecArray | null;
  // <img>: src, data-src o srcset
  const reImg = /<img\b[^>]*>/gi;
  while ((m = reImg.exec(html)) !== null && urls.size < 60) {
    const tag = m[0];
    const src =
      tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ||
      tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i)?.[1] ||
      pickFromSrcset(tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i)?.[1]) ||
      pickFromSrcset(tag.match(/\bdata-srcset\s*=\s*["']([^"']+)["']/i)?.[1]);
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    add(src, alt);
  }
  // <source srcset> dentro <picture>
  const reSource = /<source\b[^>]*>/gi;
  while ((m = reSource.exec(html)) !== null && urls.size < 60) {
    add(pickFromSrcset(m[0].match(/\bsrcset\s*=\s*["']([^"']+)["']/i)?.[1]), '');
  }
  // background-image / background: url(...) negli stili inline e nei blocchi <style>
  const reBg = /background(?:-image)?\s*:\s*[^;{}"']*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  while ((m = reBg.exec(html)) !== null && urls.size < 60) {
    add(m[1], '');
  }
  return [...urls.entries()].slice(0, 12).map(([url, alt]) => ({ url, ...(alt ? { alt: alt.slice(0, 120) } : {}) }));
}
