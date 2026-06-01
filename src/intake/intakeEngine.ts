/**
 * Motore di intake.
 *
 * Trasforma le frasi grezze dell'utente in criteri di accettazione: ognuna
 * viene classificata in un criterio tipizzato (testabile) o, se non
 * classificabile, marcata SENZA check — così il gate la segnalerà invece di
 * fingere una verifica. Produce le basi del ProjectSpec.
 *
 * In Fase 2 davanti a questo c'è l'intervista guidata progressiva + il mockup
 * visivo da approvare; la struttura qui non cambia.
 */

import {
  type IntakeClassifier,
  type IntakeContext,
  type AcceptanceCriterion,
  type Result,
  ok,
  err,
} from '@core';

export interface IntakeInput {
  readonly statements: readonly string[];
  readonly context: IntakeContext;
}

export async function buildCriteria(
  input: IntakeInput,
  classifier: IntakeClassifier,
): Promise<Result<AcceptanceCriterion[]>> {
  const criteria: AcceptanceCriterion[] = [];
  let i = 0;
  for (const statement of input.statements) {
    const res = await classifier.classify(statement, input.context);
    if (!res.ok) return err(res.error);
    i += 1;
    const id = `c${i}`;
    // confirmed: in Fase 2 lo conferma l'utente sul mockup; qui true.
    criteria.push(
      res.value
        ? { id, statement, confirmed: true, check: res.value }
        : { id, statement, confirmed: true },
    );
  }
  return ok(criteria);
}
