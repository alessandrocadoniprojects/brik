/**
 * Inietta nei siti generati ciò che manca nel <head>:
 *  - favicon (SVG data-URI con l'iniziale dell'attività, brandizzata sul cliente, non su brik)
 *  - apple-touch-icon
 *  - <meta name="description"> per pagina (dal primo paragrafo), se assente
 * Non sovrascrive favicon/description già presenti.
 */

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function initialOf(name: string): string {
  const m = (name || '').match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : '';
}

function faviconDataUri(name: string): string {
  const initial = initialOf(name);
  if (!initial) return '';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="14" fill="#111317"/>' +
    '<text x="32" y="45" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="36" font-weight="700" fill="#ffffff" text-anchor="middle">' +
    initial +
    '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function firstParagraph(html: string): string {
  const m = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const raw = m && m[1] ? m[1] : '';
  if (!raw) return '';
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 157 ? text.slice(0, 154).replace(/\s+\S*$/, '') + '…' : text;
}

export function injectSiteHead(html: string, opts: { name: string }): string {
  if (!html || html.indexOf('</head>') < 0) return html;
  let add = '';
  if (!/<link[^>]+rel=["'][^"']*icon/i.test(html)) {
    const fav = faviconDataUri(opts.name);
    if (fav) {
      add += '<link rel="icon" href="' + fav + '">';
      add += '<link rel="apple-touch-icon" href="' + fav + '">';
    }
  }
  if (!/<meta[^>]+name=["']description["']/i.test(html)) {
    const desc = firstParagraph(html);
    if (desc) add += '<meta name="description" content="' + escAttr(desc) + '">';
  }
  if (!add) return html;
  return html.replace('</head>', add + '</head>');
}

export function withSiteHead<T extends { html: string }>(pages: readonly T[], opts: { name: string }): T[] {
  return pages.map((p) => ({ ...p, html: injectSiteHead(p.html, opts) }));
}
