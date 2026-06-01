/**
 * Eval/regression harness (Fase 1, §21 del progetto).
 *
 * Gira un insieme di scenari attraverso un QaRunner e misura le KPI che
 * dicono se il prodotto migliora: in particolare il TASSO DI SUCCESSO AL
 * PRIMO COLPO (build riuscite / totali). Va eseguito a ogni cambio di
 * prompt/modello per intercettare regressioni prima che lo facciano gli utenti.
 */

import type { QaRunner, ProjectSpec, GeneratedProject } from '@core';

export interface EvalScenario {
  readonly name: string;
  readonly spec: ProjectSpec;
  readonly project: GeneratedProject;
  readonly runner: QaRunner;
}

export interface EvalRow {
  readonly name: string;
  readonly buildSucceeded: boolean;
  readonly l1Passed: number;
  readonly l1Total: number;
  readonly l2Passed: number;
  readonly l2Total: number;
  readonly flagged: number;
}

export interface EvalSummary {
  readonly rows: readonly EvalRow[];
  readonly firstPassRate: number; // 0..1
}

export async function runEval(scenarios: readonly EvalScenario[]): Promise<EvalSummary> {
  const rows: EvalRow[] = [];
  for (const sc of scenarios) {
    const res = await sc.runner.run(sc.project, sc.spec);
    if (!res.ok) {
      rows.push({ name: sc.name, buildSucceeded: false, l1Passed: 0, l1Total: 0, l2Passed: 0, l2Total: 0, flagged: 0 });
      continue;
    }
    const r = res.value;
    rows.push({
      name: sc.name,
      buildSucceeded: r.buildSucceeded,
      l1Passed: r.level1.filter((x) => x.passed).length,
      l1Total: r.level1.length,
      l2Passed: r.level2.filter((x) => x.passed).length,
      l2Total: r.level2.length,
      flagged: r.flagged.length,
    });
  }
  const succeeded = rows.filter((r) => r.buildSucceeded).length;
  return { rows, firstPassRate: rows.length ? succeeded / rows.length : 0 };
}
