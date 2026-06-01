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
const SUBMIT_RE = /invia|inviare|spedisci|prenota|richiedi|iscriv|conferma|submit|manda|registra/i;

export function makePlaywrightQaRunner(
  baseUrl: string,
  knownRoutes: readonly string[],
  opts: { readonly browser?: Browser } = {},
): QaRunner {
  const url = (route: string): string => baseUrl.replace(/\/$/, '') + route;

  return {
    async run(_project, spec: ProjectSpec): Promise<Result<ReturnType<typeof buildGate>>> {
      const browser: Browser = opts.browser ?? (await chromium.launch());
      const ownBrowser = !opts.browser;
      try {
        const level1: CheckResult[] = [];
        for (const route of knownRoutes) {
          const page = await browser.newPage();
          try {
            const resp = await page.goto(url(route), { waitUntil: 'load' });
            const passed = !!resp && resp.ok();
            level1.push({
              criterionId: `L1:${route}`,
              kind: 'route-loads',
              passed,
              ...(passed ? {} : { detail: `Route non carica: ${route}` }),
            });
          } catch (e) {
            level1.push({ criterionId: `L1:${route}`, kind: 'route-loads', passed: false, detail: String(e) });
          } finally {
            await page.close();
          }
        }

        const level2: CheckResult[] = [];
        for (const c of spec.criteria) {
          if (!c.check) continue;
          const page = await browser.newPage();
          try {
            level2.push(await runOne(page, url, c.id, c.check));
          } catch (e) {
            level2.push({ criterionId: c.id, kind: c.check.kind, passed: false, detail: String(e).slice(0, 120) });
          } finally {
            await page.close();
          }
        }

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
      const resp = await page.goto(url(check.route), { waitUntil: 'load' });
      return resp && resp.ok() ? pass() : fail(`HTTP non ok per ${check.route}`);
    }

    case 'content-present': {
      await page.goto(url(check.route), { waitUntil: 'load' });
      const text = await page.evaluate(() => document.body.innerText || '');
      return norm(text).includes(norm(check.text)) ? pass() : fail(`Testo non visibile: "${check.text}"`);
    }

    case 'responsive': {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(url(check.route), { waitUntil: 'load' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      return overflow ? fail('Overflow orizzontale su mobile (375px).') : pass();
    }

    case 'navigation': {
      await page.goto(url(check.fromRoute), { waitUntil: 'load' });
      await page.getByRole('link', { name: new RegExp(rx(check.linkText), 'i') }).first().click();
      await page.waitForLoadState('load').catch(() => undefined);
      return new RegExp(check.toRoutePattern).test(page.url())
        ? pass()
        : fail(`URL dopo click: ${page.url()} non combacia con ${check.toRoutePattern}`);
    }

    case 'form-submission': {
      await page.goto(url(check.route), { waitUntil: 'load' });
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
