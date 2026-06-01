/**
 * Eval matrix — esegue ogni scenario attraverso il motore completo
 * (intake → codice → QA → auto-fix) e raccoglie metriche di QUALITÀ:
 *   - first-pass: passato al primo colpo (0 correzioni)
 *   - dopo auto-fix: passato entro maxRepairs
 *   - dove rompe: tipi di check falliti al giro 0 (modi di fallimento del modello)
 *   - quanti criteri vengono SEGNALATI all'intake (il motore "passa la mano")
 *
 * Le dipendenze sono iniettate (classifier, codegen, llm, runQa) per poter
 * testare la logica con mock e per scambiare il motore di QA (browser/jsdom).
 */
import {
  type IntakeClassifier,
  type CodeGenerator,
  type LLMProvider,
  type ProjectSpec,
  type QaReport,
  type ProjectCategory,
  type Result,
} from '../core/index.js';
import { repairLoop } from '../orchestrator/repair.js';
import type { EvalScenario } from './scenarios.js';
import { buildCriteria } from '../intake/index.js';

export interface EvalDeps {
  readonly classifier: IntakeClassifier;
  readonly codegen: CodeGenerator;
  readonly llm: LLMProvider;
  /** Esegue la QA su un HTML per un dato spec (server + browser li gestisce il chiamante). */
  readonly runQa: (html: string, spec: ProjectSpec) => Promise<Result<QaReport>>;
  readonly maxRepairs?: number;
}

export interface ScenarioResult {
  readonly id: string;
  readonly category: ProjectCategory;
  readonly criteriaTotal: number;
  readonly flagged: number; // criteri non testabili segnalati all'intake
  readonly firstPass: boolean; // verde al giro 0
  readonly iterations: number; // correzioni applicate
  readonly finalSuccess: boolean; // verde alla fine
  readonly initialFailKinds: readonly string[]; // cosa rompe al primo colpo
  readonly finalFailKinds: readonly string[]; // cosa resta rotto (se rosso)
  readonly durationMs: number;
  readonly error?: string;
  readonly finalHtml?: string;
}

export interface Aggregate {
  readonly total: number;
  readonly firstPassRate: number;
  readonly finalSuccessRate: number;
  readonly avgRepairs: number;
  readonly initialFailFreq: Record<string, number>;
  readonly stillRed: readonly string[];
  readonly errored: readonly string[];
}

const failKinds = (r: QaReport): string[] => {
  const s = new Set<string>();
  for (const x of [...r.level1, ...r.level2]) if (!x.passed) s.add(x.kind);
  return [...s];
};

export async function runScenario(s: EvalScenario, deps: EvalDeps): Promise<ScenarioResult> {
  const t0 = Date.now();
  const skeleton = (extra: Partial<ScenarioResult> = {}): ScenarioResult => ({
    id: s.id,
    category: s.category,
    criteriaTotal: 0,
    flagged: 0,
    firstPass: false,
    iterations: 0,
    finalSuccess: false,
    initialFailKinds: [],
    finalFailKinds: [],
    durationMs: Date.now() - t0,
    ...extra,
  });

  // 1) intake
  const crit = await buildCriteria(
    { statements: s.statements, context: { category: s.category, knownRoutes: s.knownRoutes } },
    deps.classifier,
  );
  if (!crit.ok) return skeleton({ error: 'intake: ' + crit.error.message });
  const criteria = crit.value;
  const flagged = criteria.filter((c) => !c.check).length;

  const spec: ProjectSpec = {
    id: s.id,
    ownerId: 'eval',
    category: s.category,
    title: s.title,
    description: s.description,
    criteria,
  };

  // 2) generazione iniziale
  const gen = await deps.codegen.generate(spec);
  if (!gen.ok) {
    return skeleton({ criteriaTotal: criteria.length, flagged, error: 'codegen: ' + gen.error.message });
  }
  const initialHtml = gen.value.files.find((f) => f.path === 'index.html')?.contents ?? '';

  // 3) auto-fix; catturo primo e ultimo report senza modificare repairLoop
  let firstReport: QaReport | undefined;
  let lastReport: QaReport | undefined;
  const wrapped = async (html: string): Promise<Result<QaReport>> => {
    const res = await deps.runQa(html, spec);
    if (res.ok) {
      if (!firstReport) firstReport = res.value;
      lastReport = res.value;
    }
    return res;
  };

  const outcome = await repairLoop({
    spec,
    llm: deps.llm,
    initialHtml,
    runQa: wrapped,
    maxRepairs: deps.maxRepairs ?? 3,
  });
  if (!outcome.ok) {
    return skeleton({ criteriaTotal: criteria.length, flagged, error: 'qa/repair: ' + outcome.error.message });
  }

  return skeleton({
    criteriaTotal: criteria.length,
    flagged,
    firstPass: firstReport?.buildSucceeded ?? false,
    iterations: outcome.value.iterations,
    finalSuccess: outcome.value.report.buildSucceeded,
    initialFailKinds: firstReport ? failKinds(firstReport) : [],
    finalFailKinds: lastReport && !lastReport.buildSucceeded ? failKinds(lastReport) : [],
    finalHtml: outcome.value.html,
  });
}

export async function runMatrix(
  scenarios: readonly EvalScenario[],
  deps: EvalDeps,
  onResult?: (r: ScenarioResult) => void,
): Promise<{ results: ScenarioResult[]; aggregate: Aggregate }> {
  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    const r = await runScenario(s, deps);
    results.push(r);
    onResult?.(r);
  }

  const ok = results.filter((r) => !r.error);
  const initialFailFreq: Record<string, number> = {};
  for (const r of ok) for (const k of r.initialFailKinds) initialFailFreq[k] = (initialFailFreq[k] ?? 0) + 1;

  const aggregate: Aggregate = {
    total: results.length,
    firstPassRate: results.length ? ok.filter((r) => r.firstPass).length / results.length : 0,
    finalSuccessRate: results.length ? ok.filter((r) => r.finalSuccess).length / results.length : 0,
    avgRepairs: ok.length ? ok.reduce((a, r) => a + r.iterations, 0) / ok.length : 0,
    initialFailFreq,
    stillRed: ok.filter((r) => !r.finalSuccess).map((r) => r.id),
    errored: results.filter((r) => r.error).map((r) => r.id),
  };

  return { results, aggregate };
}
