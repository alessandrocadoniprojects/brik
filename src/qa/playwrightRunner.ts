/**
 * QaRunner su BROWSER REALE (Playwright/Chromium).
 *
 * Stessa porta del runner jsdom, ma esegue i criteri in un browser vero:
 *  - `responsive` testa DAVVERO l'overflow orizzontale (niente proxy);
 *  - il JavaScript della pagina gira come in produzione (scrollIntoView, ecc.);
 *  - form-submission compila, invia e attende la conferma VISIBILE.
 *
 * Riceve un baseUrl (un server che serve il sito generato) e le route note.
 * L'orchestratore non sa se sta usando questo runner o quello jsdom.
 *
 * Richiede: `npm install playwright` + `npx playwright install chromium`.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { type QaRunner, type CheckResult, type CheckSpec, type ProjectSpec, type Result, ok } from '@core';
import { buildGate } from './gate.js';

/** Escape per usare testo letterale dentro una RegExp. */
const rx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makePlaywrightQaRunner(baseUrl: string, knownRoutes: readonly string[]): QaRunner {
  const url = (route: string): string => baseUrl.replace(/\/$/, '') + route;

  return {
    async run(_project, spec: ProjectSpec): Promise<Result<ReturnType<typeof buildGate>>> {
      const browser: Browser = await chromium.launch();
      try {
        // Livello 1 — deterministico: ogni route nota deve caricare (HTTP ok).
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

        // Livello 2 — guidato dai criteri tipizzati.
        const level2: CheckResult[] = [];
        for (const c of spec.criteria) {
          if (!c.check) continue; // i non-tipizzati li gestisce il gate (flagged)
          const page = await browser.newPage();
          try {
            level2.push(await runOne(page, url, c.id, c.check));
          } catch (e) {
            level2.push({ criterionId: c.id, kind: c.check.kind, passed: false, detail: String(e) });
          } finally {
            await page.close();
          }
        }

        return ok(buildGate(spec, level1, level2));
      } finally {
        await browser.close();
      }
    },
  };
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
      const found = await page.evaluate(
        (t) => (document.body.innerText || '').includes(t),
        check.text,
      );
      return found ? pass() : fail(`Testo non visibile: "${check.text}"`);
    }

    case 'responsive': {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(url(check.route), { waitUntil: 'load' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
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
      for (const f of check.fields) {
        const field = page.getByLabel(new RegExp(rx(f.label), 'i')).first();
        const exists = (await field.count()) > 0;
        if (!exists) return fail(`Campo non trovato per label: "${f.label}"`);
        await field.fill(f.value);
      }
      await page.getByRole('button', { name: /invia|submit|manda|inviare|spedisci/i }).first().click();
      const ok2 = await page
        .getByText(check.confirmationText, { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      return ok2 ? pass() : fail(`Conferma non visibile dopo invio: "${check.confirmationText}"`);
    }
  }
}
