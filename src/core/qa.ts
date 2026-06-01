/**
 * Tipi e porte della verifica (QA).
 */

import type { Result } from './result.js';
import type { CheckSpec } from './criteria.js';
import type { GeneratedProject, ProjectSpec } from './domain.js';

/** Esito di un singolo check. */
export interface CheckResult {
  readonly criterionId: string;
  readonly kind: string;
  readonly passed: boolean;
  readonly detail?: string;
}

/** Criterio non auto-verificabile: si segnala all'utente, non si finge un test. */
export interface FlaggedCriterion {
  readonly criterionId: string;
  readonly statement: string;
  readonly reason: string;
}

/** Report completo della verifica di un progetto. */
export interface QaReport {
  readonly level1: readonly CheckResult[]; // deterministici
  readonly level2: readonly CheckResult[]; // guidati dai criteri
  readonly flagged: readonly FlaggedCriterion[];
  /** Gate composito "build riuscita" (vedi qa/gate). */
  readonly buildSucceeded: boolean;
}

/**
 * Porta — classifica una frase dell'utente in un criterio TIPIZZATO.
 * Ritorna null se non è riconducibile a un tipo noto (→ verrà segnalato).
 * Implementazioni: LLM reale (classificazione + estrazione parametri), mock.
 */
export interface IntakeClassifier {
  classify(userStatement: string, context: IntakeContext): Promise<Result<CheckSpec | null>>;
}

export interface IntakeContext {
  readonly category: string;
  /** Route note del progetto, per ancorare i check. */
  readonly knownRoutes: readonly string[];
}

/**
 * Porta — esegue la verifica su un progetto buildato.
 * Implementazioni: PlaywrightQaRunner (reale), mock per i test unitari.
 */
export interface QaRunner {
  run(project: GeneratedProject, spec: ProjectSpec): Promise<Result<QaReport>>;
}
