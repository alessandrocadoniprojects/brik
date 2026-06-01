/**
 * Implementazione della porta QaRunner basata su jsdom (motore leggero).
 * In produzione esiste un PlaywrightQaRunner con la stessa interfaccia:
 * l'orchestratore non sa quale dei due sta usando.
 *
 * Riceve un HtmlResolver (come ottenere l'HTML renderizzato di una route).
 * In prod il resolver fa fetch dell'app servita dal build; qui, nei test,
 * restituisce HTML statico.
 */

import { type QaRunner, type CheckResult, type Result, ok } from '@core';
import { runChecksJsdom, type HtmlResolver } from './jsdomRunner.js';
import { buildGate } from './gate.js';

export function makeJsdomQaRunner(html: HtmlResolver, knownRoutes: readonly string[]): QaRunner {
  return {
    async run(_project, spec): Promise<Result<ReturnType<typeof buildGate>>> {
      // Livello 1 — deterministico: ogni route nota deve caricare.
      const level1: CheckResult[] = knownRoutes.map((route) => ({
        criterionId: `L1:${route}`,
        kind: 'route-loads',
        passed: html(route) !== undefined,
        ...(html(route) === undefined ? { detail: `Route assente: ${route}` } : {}),
      }));

      // Livello 2 — guidato dai criteri tipizzati.
      const level2 = runChecksJsdom(spec, html);

      return ok(buildGate(spec, level1, level2));
    },
  };
}
