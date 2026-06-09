/**
 * Rendering di una pagina con browser headless (Playwright).
 *
 * Serve per i siti JS/SPA (es. Lovable, React, Vue): l'HTML iniziale è quasi
 * vuoto e i contenuti li monta il JavaScript, quindi il fetch tradizionale non
 * vede nulla. Qui apriamo la pagina in Chromium headless, aspettiamo che si
 * popoli e leggiamo testo visibile + immagini (anche quelle di sfondo CSS).
 *
 * Riusa Playwright (già usato dalla QA). Il browser è un singleton lazy.
 */
import { chromium, type Browser } from 'playwright';

let browserP: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browserP) browserP = chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const b = await browserP;
  if (!b.isConnected()) { browserP = chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); return browserP; }
  return b;
}

export interface RenderedPage {
  readonly title: string;
  readonly text: string;
  readonly images: { url: string; alt?: string }[];
}

// Eseguito NEL browser: estrae titolo, testo visibile e URL immagine (img + background-image).
const EXTRACT = `(() => {
  const out = { title: '', text: '', images: [] };
  try {
    const ogt = document.querySelector('meta[property="og:title"]');
    out.title = String(document.title || (ogt && ogt.getAttribute('content')) || '').slice(0, 200);
    var _main = document.querySelector('main, [role="main"], article');
    var _bodyTxt = (document.body && document.body.innerText) ? document.body.innerText : '';
    var _mainTxt = (_main && _main.innerText) ? _main.innerText : '';
    out.text = ((_mainTxt && _mainTxt.length > 200 ? _mainTxt : _bodyTxt) || '').trim();
    const seen = new Set();
    const push = (u, alt) => {
      if (!u) return;
      try {
        const abs = new URL(u, location.href).toString();
        if (!/^https?:/.test(abs) || /\\.svg(\\?|$)/i.test(abs)) return;
        if (seen.has(abs)) return; seen.add(abs);
        out.images.push({ url: abs, alt: String(alt || '').slice(0, 120) });
      } catch (e) {}
    };
    const ogi = document.querySelector('meta[property="og:image"]');
    if (ogi) push(ogi.getAttribute('content'), '');
    document.querySelectorAll('img').forEach((im) => push(im.currentSrc || im.src, im.alt || ''));
    const els = Array.from(document.querySelectorAll('section,header,div,a,[style*="background"],[class*="hero"]')).slice(0, 500);
    for (const el of els) {
      if (out.images.length > 24) break;
      const bg = getComputedStyle(el).backgroundImage;
      const m = bg && bg.indexOf('url(') >= 0 ? bg.match(/url\\(["']?([^"')]+)["']?\\)/) : null;
      if (m) push(m[1], '');
    }
    out.images = out.images.slice(0, 12);
  } catch (e) {}
  return out;
})()`;

// Eseguito NEL browser: scorre tutta la pagina per innescare il lazy-load, poi torna su.
const SCROLL = `(async () => {
  await new Promise((resolve) => {
    let y = 0, n = 0;
    const step = () => {
      window.scrollTo(0, y);
      y += Math.max(window.innerHeight, 400);
      n += 1;
      if (n < 40 && y < document.body.scrollHeight) setTimeout(step, 120);
      else { window.scrollTo(0, 0); resolve(); }
    };
    step();
  });
})()`;

export async function renderPageContent(url: string, timeoutMs = 20_000): Promise<RenderedPage> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: 'brik/1.0 (+content import)' });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs }).catch(() => {});
    await page.waitForTimeout(800); // un attimo per l'hydration
    await page.evaluate(SCROLL as unknown as () => unknown).catch(() => {}); // innesca il lazy-load
    await page.waitForTimeout(400);
    const data = (await page.evaluate(EXTRACT as unknown as () => unknown)) as RenderedPage;
    return { title: (data && data.title) || '', text: (data && data.text) || '', images: (data && data.images) || [] };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function closeRenderBrowser(): Promise<void> {
  if (browserP) {
    try { (await browserP).close(); } catch { /* ignore */ }
    browserP = null;
  }
}
