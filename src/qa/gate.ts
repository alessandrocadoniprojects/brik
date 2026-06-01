/**
 * Gate "build riuscita" (Definizione misurabile, §9 del progetto).
 *
 * build riuscita = TUTTI i check deterministici (L1) passano
 *               E  TUTTI i criteri testabili (L2) passano.
 * I criteri NON testabili (senza check) non bloccano il gate ma vengono
 * elencati come `flagged`: l'utente li verifica/accetta esplicitamente.
 * (In Fase 3 si aggiunge la soglia soggettiva del Livello 3 e lo scan
 * sicurezza della Fase 5, come ulteriori condizioni AND.)
 */

import type { ProjectSpec, CheckResult, QaReport, FlaggedCriterion } from '@core';

export function buildGate(
  spec: ProjectSpec,
  level1: readonly CheckResult[],
  level2: readonly CheckResult[],
): QaReport {
  const flagged: FlaggedCriterion[] = spec.criteria
    .filter((c) => c.check === undefined)
    .map((c) => ({
      criterionId: c.id,
      statement: c.statement,
      reason: 'Criterio non riconducibile a un tipo verificabile: richiede conferma manuale.',
    }));

  const l1ok = level1.every((r) => r.passed);
  const l2ok = level2.every((r) => r.passed);

  return { level1, level2, flagged, buildSucceeded: l1ok && l2ok };
}
