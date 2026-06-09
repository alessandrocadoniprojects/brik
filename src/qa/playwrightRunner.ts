/**
 * QaRunner su BROWSER REALE (Playwright/Chromium) — versione robusta.
 *
 * Verifica i criteri come farebbe un utente vero, evitando falsi negativi:
 *  - compila i campi in base al TIPO dell'input (email/date/number/tel/select),
 *    non con valori arbitrari;
 *  - se il form è in una sezione nascosta (es. tab SPA), prova a RIVELARLO
 *    cliccando un link/bottone della sezione;
 *  - confronta testo e conferma in modo tollerante ad accenti, maiuscole e
 *    spazi (la sostanza resta esatta);
 *  - `responsive` resta severo: overflow orizzontale reale a 375px.
 *
 * Richiede: `npm install playwright` + `npx playwright install chromium`.
 */

import { chromium, type Browser, type Page, type Locator } from 'playwright';
import { type QaRunner, type CheckResult, type CheckSpec, type ProjectSpec, type Result, ok } from '@core';
import { buildGate } from './gate.js';

/** Escape per usare testo letterale dentro una RegExp. */
const rx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Normalizza: toglie accenti, abbassa, collassa gli spazi. */
const norm = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const REVEAL_RE = /contatt|prenot|appuntament|scriv|richiest|prenotazione|contact/i;
const SUBMIT_RE = /invia|inviare|spedisci|prenota|richiedi|iscriv|conferma|submit|manda|registra|aggiungi|salva|crea/i;

/** Quante pagine al massimo aperte contemporaneamente durante la QA. */
const QA_CONCURRENCY = 4;

/**
 * Esegue `fn` su ogni elemento con al massimo `limit` esecuzioni in parallelo.
 * I risultati mantengono l'ORDINE degli input (results[i] = fn(items[i])), così
 * il gate riceve gli stessi array della versione sequenziale: stessa diagnosi,
 * solo piu veloce. Ogni `fn` apre e chiude la PROPRIA pagina: nessuno stato
 * condiviso tra i controlli.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

/**
 * Pagina QA: la verifica guarda DOM / testo / layout (CSS inline), non il rendering
 * delle immagini. Blocchiamo immagini, media e font remoti (le foto Pexels) cosi le
 * navigazioni NON aspettano download di rete — e' la causa principale di lentezza.
 * Timeout espliciti per evitare che una risorsa lenta blocchi il check.
 */
async function newQaPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(15000);
  page.setDefaultTimeout(15000);
  await page.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return route.abort();
    return route.continue();
  });
  return page;
}

export function makePlaywrightQaRunner(
  baseUrl: string,
  knownRoutes: readonly string[],
  opts: { readonly browser?: Browser } = {},
): QaRunner {
  const url = (route: string): string => baseUrl.replace(/\/$/, '') + route;

  return {
    async run(_project, spec: ProjectSpec): Promise<Result<ReturnType<typeof buildGate>>> {
      const browser: Browser = opts.browser ?? (await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
      const ownBrowser = !opts.browser;
      try {
        // Livello 1: ogni route si apre? Pagine indipendenti, in parallelo (tetto QA_CONCURRENCY).
        const level1 = await mapLimit(knownRoutes, QA_CONCURRENCY, async (route): Promise<CheckResult> => {
          const page = await newQaPage(browser);
          try {
            const resp = await page.goto(url(route), { waitUntil: 'domcontentloaded' });
            const passed = !!resp && resp.ok();
            return {
              criterionId: `L1:${route}`,
              kind: 'route-loads',
              passed,
              ...(passed ? {} : { detail: `Route non carica: ${route}` }),
            };
          } catch (e) {
            return { criterionId: `L1:${route}`, kind: 'route-loads', passed: false, detail: String(e) };
          } finally {
            await page.close();
          }
        });

        // Livello 2: un criterio per pagina, anch'essi in parallelo (ognuno apre/chiude la sua pagina).
        const checks = spec.criteria.flatMap((c) => (c.check ? [{ id: c.id, check: c.check }] : []));
        const level2 = await mapLimit(checks, QA_CONCURRENCY, async ({ id, check }): Promise<CheckResult> => {
          const page = await newQaPage(browser);
          try {
            return await runOne(page, url, id, check);
          } catch (e) {
            return { criterionId: id, kind: check.kind, passed: false, detail: String(e).slice(0, 120) };
          } finally {
            await page.close();
          }
        });

        return ok(buildGate(spec, level1, level2));
      } finally {
        if (ownBrowser) await browser.close();
      }
    },
  };
}

/** Valore di test adatto al tipo dell'input. */
function valueForType(type: string): string {
  switch (type) {
    case 'email':
      return 'mario.rossi@example.com';
    case 'date':
      return '2025-12-31';
    case 'number':
      return '2';
    case 'tel':
      return '3331234567';
    case 'time':
      return '10:30';
    case 'url':
      return 'https://example.com';
    default:
      return 'Mario Rossi';
  }
}

/** Localizza un campo per label, con fallback su placeholder e name/id. */
function locateField(page: Page, label: string): Locator {
  const re = new RegExp(rx(label), 'i');
  const token = label.split(/\s+/)[0] ?? label;
  return page
    .getByLabel(re)
    .or(page.getByPlaceholder(re))
    .or(page.locator(`input[name*="${token}" i], input[id*="${token}" i], textarea[name*="${token}" i], select[name*="${token}" i]`))
    .first();
}

/** Se il form è nascosto (tab SPA), prova a rivelarlo cliccando la sua sezione. */
async function revealIfHidden(page: Page, field: Locator): Promise<void> {
  if (await field.isVisible().catch(() => false)) return;
  const revealer = page
    .getByRole('link', { name: REVEAL_RE })
    .or(page.getByRole('button', { name: REVEAL_RE }));
  const n = Math.min(await revealer.count().catch(() => 0), 4);
  for (let i = 0; i < n; i++) {
    await revealer.nth(i).click().catch(() => undefined);
    await page.waitForTimeout(150);
    if (await field.isVisible().catch(() => false)) return;
  }
}

/** Form bersaglio: quello che contiene un submit, altrimenti il primo della pagina. */
function targetForm(page: Page): Locator {
  return page
    .locator('form:has(button[type="submit"]), form:has(input[type="submit"])')
    .or(page.locator('form'))
    .first();
}

/**
 * Riempie TUTTI i campi compilabili del form in base al tipo: così l'invio
 * supera la validazione anche quando il form richiede campi non elencati nel
 * criterio (es. un textarea "messaggio" obbligatorio). Spunta i checkbox
 * richiesti (es. consenso privacy) e seleziona la prima opzione delle select.
 */
async function fillForm(page: Page, form: Locator): Promise<void> {
  const fields = form.locator('input, textarea, select');
  const n = await fields.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = fields.nth(i);
    const meta = await el
      .evaluate((node) => {
        const f = node as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
        const style = getComputedStyle(f);
        return {
          tag: f.tagName.toLowerCase(),
          type: (f.getAttribute('type') || 'text').toLowerCase(),
          skip: !!f.disabled || (f as HTMLInputElement).readOnly === true || style.display === 'none' || style.visibility === 'hidden',
          value: typeof f.value === 'string' ? f.value : '',
          checked: !!f.checked,
        };
      })
      .catch(() => null);
    if (!meta || meta.skip) continue;
    if (['hidden', 'submit', 'button', 'reset', 'file', 'image'].includes(meta.type)) continue;
    try {
      if (meta.type === 'checkbox' || meta.type === 'radio') {
        if (!meta.checked) await el.check();
      } else if (meta.tag === 'select') {
        await el.selectOption({ index: 1 }).catch(async () => {
          await el.selectOption({ index: 0 }).catch(() => undefined);
        });
      } else if (meta.value.trim() === '') {
        await el.fill(valueForType(meta.type));
      }
    } catch {
      /* ignora il singolo campo e prosegue */
    }
  }
}

async function clickSubmit(page: Page): Promise<void> {
  const inForm = page.locator('form button[type="submit"], form input[type="submit"]').first();
  if ((await inForm.count().catch(() => 0)) > 0) {
    await inForm.click();
    return;
  }
  const byText = page.getByRole('button', { name: SUBMIT_RE }).first();
  if ((await byText.count().catch(() => 0)) > 0) {
    await byText.click();
    return;
  }
  await page.locator('button[type="submit"], [type="submit"], form button').first().click();
}

async function runOne(
  page: Page,
  url: (route: string) => string,
  id: string,
  check: CheckSpec,
): Promise<CheckResult> {
  const base = { criterionId: id, kind: check.kind } as const;
  const pass = (): CheckResult => ({ ...base, passed: true });
  const fail = (detail: string): CheckResult => ({ ...base, passed: false, detail });

  switch (check.kind) {
    case 'route-loads': {
      const resp = await page.goto(url(check.route), { waitUntil: 'domcontentloaded' });
      return resp && resp.ok() ? pass() : fail(`HTTP non ok per ${check.route}`);
    }

    case 'content-present': {
      await page.goto(url(check.route), { waitUntil: 'domcontentloaded' });
      const text = await page.evaluate(() => document.body.innerText || '');
      return norm(text).includes(norm(check.text)) ? pass() : fail(`Testo non visibile: "${check.text}"`);
    }

    case 'responsive': {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(url(check.route), { waitUntil: 'domcontentloaded' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      return overflow ? fail('Overflow orizzontale su mobile (375px).') : pass();
    }

    case 'navigation': {
      await page.goto(url(check.fromRoute), { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: new RegExp(rx(check.linkText), 'i') }).first().click();
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      return new RegExp(check.toRoutePattern).test(page.url())
        ? pass()
        : fail(`URL dopo click: ${page.url()} non combacia con ${check.toRoutePattern}`);
    }

    case 'form-submission': {
      await page.goto(url(check.route), { waitUntil: 'domcontentloaded' });
      // se il form fosse in una sezione nascosta, prova a rivelarlo usando il primo campo come sonda
      const firstField = check.fields[0];
      if (firstField) {
        const probe = locateField(page, firstField.label);
        if ((await probe.count().catch(() => 0)) > 0) await revealIfHidden(page, probe);
      }
      const form = targetForm(page);
      if ((await form.count().catch(() => 0)) === 0) return fail('Nessun form trovato nella pagina.');
      await fillForm(page, form);
      await clickSubmit(page);
      // attendi la conferma (testo normalizzato) visibile, fino a ~4s
      const target = norm(check.confirmationText);
      let seen = false;
      for (let i = 0; i < 20; i++) {
        const t = await page.evaluate(() => document.body.innerText || '');
        if (norm(t).includes(target)) {
          seen = true;
          break;
        }
        await page.waitForTimeout(200);
      }
      return seen ? pass() : fail(`Conferma non visibile dopo invio: "${check.confirmationText}"`);
    }
  }
}
