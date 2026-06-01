/**
 * Aggiornamento dei REQUISITI (Fase 2).
 *
 * A differenza della modifica libera (edit.ts), qui si cambia di proposito il
 * contratto: si modifica la lista delle frasi-requisito, si ri-derivano i
 * criteri (intake) e si riparte dalla PAGINA ATTUALE adeguandola ai nuovi
 * criteri con l'auto-fix. Ciò che già soddisfa i criteri resta invariato; solo
 * il requisito cambiato viene adattato. Il gate finale usa i NUOVI criteri.
 *
 * Nota: rimuovere una FRASE toglie il relativo check, ma non rimuove da sola
 * l'elemento dalla pagina (per quello serve anche una modifica libera).
 */

import {
  type ProjectSpec,
  type IntakeClassifier,
  type LLMProvider,
  type QaReport,
  type Result,
  ok,
  err,
} from '@core';
import { buildCriteria } from '../intake/index.js';
import { repairLoop, type RepairOutcome } from './repair.js';
import { summarizeSpec, type PreviewSummary } from './preview.js';

export interface RequirementUpdate {
  /** Nuovo spec coi criteri aggiornati. */
  readonly spec: ProjectSpec;
  /** Pagina adeguata + report finale (sui nuovi criteri). */
  readonly outcome: RepairOutcome;
  readonly summary: PreviewSummary;
}

export async function updateRequirements(args: {
  /** Spec attuale (per id/title/category…); i criteri vengono ri-derivati. */
  readonly base: ProjectSpec;
  readonly newStatements: readonly string[];
  readonly currentHtml: string;
  readonly classifier: IntakeClassifier;
  readonly llm: LLMProvider;
  /** QA per un dato HTML e spec (il chiamante gestisce server/browser). */
  readonly runQa: (html: string, spec: ProjectSpec) => Promise<Result<QaReport>>;
  readonly knownRoutes: readonly string[];
  readonly maxRepairs?: number;
}): Promise<Result<RequirementUpdate>> {
  const crit = await buildCriteria(
    { statements: args.newStatements, context: { category: args.base.category, knownRoutes: args.knownRoutes } },
    args.classifier,
  );
  if (!crit.ok) return err(crit.error);

  const spec: ProjectSpec = { ...args.base, criteria: crit.value };

  // Riparti dalla pagina attuale e portala a soddisfare i NUOVI criteri.
  const outcome = await repairLoop({
    spec,
    llm: args.llm,
    initialHtml: args.currentHtml,
    runQa: (html: string) => args.runQa(html, spec),
    maxRepairs: args.maxRepairs ?? 3,
  });
  if (!outcome.ok) return err(outcome.error);

  return ok({ spec, outcome: outcome.value, summary: summarizeSpec(spec) });
}
