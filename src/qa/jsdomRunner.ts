/**
 * Esecutore dei criteri tipizzati su jsdom.
 *
 * Poiché i criteri sono TIPIZZATI (CheckSpec), lo stesso criterio è eseguibile
 * da motori diversi: Playwright in produzione (browser reale), jsdom in
 * CI/locale (leggero, senza browser). Questo file è il motore leggero e
 * dimostra che un criterio fallisce davvero quando il sito non lo rispetta.
 *
 * Nota onesta sui limiti di jsdom: non calcola il layout, quindi `responsive`
 * qui è un PROXY (presenza del meta viewport). `content-present` e
 * `form-submission` sono invece eseguiti realmente (DOM + script inline).
 */

import { JSDOM } from 'jsdom';
import type { CheckSpec, CheckResult, ProjectSpec, AcceptanceCriterion } from '@core';

/** Risolve l'HTML di una route (in prod: fetch dell'app servita). */
export type HtmlResolver = (route: string) => string | undefined;

export function runChecksJsdom(spec: ProjectSpec, html: HtmlResolver): CheckResult[] {
  const out: CheckResult[] = [];
  for (const c of spec.criteria) {
    if (!c.check) continue; // i non-tipizzati li gestisce il gate (flagged)
    out.push(runOne(c, c.check, html));
  }
  return out;
}

function runOne(c: AcceptanceCriterion, check: CheckSpec, html: HtmlResolver): CheckResult {
  const base = { criterionId: c.id, kind: check.kind } as const;
  const pass = (): CheckResult => ({ ...base, passed: true });
  const fail = (detail: string): CheckResult => ({ ...base, passed: false, detail });

  const route = 'route' in check ? check.route : (check as { fromRoute: string }).fromRoute;
  const source = html(route);
  if (source === undefined) return fail(`Route non trovata: ${route}`);

  const dom = new JSDOM(source, { runScripts: 'dangerously' });
  const doc = dom.window.document;

  switch (check.kind) {
    case 'route-loads':
      return pass(); // se l'HTML esiste ed è parsato, la route carica

    case 'content-present':
      return doc.body.textContent?.includes(check.text)
        ? pass()
        : fail(`Testo non trovato: "${check.text}"`);

    case 'responsive': {
      const hasViewport = !!doc.querySelector('meta[name="viewport"]');
      return hasViewport ? pass() : fail('Meta viewport assente (proxy responsive).');
    }

    case 'navigation': {
      const link = [...doc.querySelectorAll('a')].find((a) =>
        a.textContent?.toLowerCase().includes(check.linkText.toLowerCase()),
      );
      const href = link?.getAttribute('href') ?? '';
      return new RegExp(check.toRoutePattern).test(href)
        ? pass()
        : fail(`Link "${check.linkText}" → "${href}" non combacia con ${check.toRoutePattern}`);
    }

    case 'form-submission': {
      // Compila i campi per label, invia, verifica la conferma.
      for (const f of check.fields) {
        const field = findFieldByLabel(doc, f.label);
        if (!field) return fail(`Campo non trovato per label: "${f.label}"`);
        (field as HTMLInputElement).value = f.value;
      }
      const form = doc.querySelector('form');
      if (!form) return fail('Form non trovato.');
      form.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
      const visible = [...doc.querySelectorAll('*')].some(
        (el) =>
          el.textContent?.includes(check.confirmationText) &&
          (el as HTMLElement).style.display !== 'none',
      );
      return visible ? pass() : fail(`Conferma non visibile: "${check.confirmationText}"`);
    }
  }
}

function findFieldByLabel(doc: Document, label: string): Element | null {
  const lc = label.toLowerCase();
  // 1) <label for=id>
  const lbl = [...doc.querySelectorAll('label')].find((l) =>
    l.textContent?.toLowerCase().includes(lc),
  );
  if (lbl) {
    const forId = lbl.getAttribute('for');
    if (forId) {
      const el = doc.getElementById(forId);
      if (el) return el;
    }
  }
  // 2) per attributo name/id/placeholder
  return (
    doc.querySelector(`[name="${lc}"]`) ??
    doc.querySelector(`#${lc}`) ??
    doc.querySelector(`[placeholder*="${lc}" i]`)
  );
}
