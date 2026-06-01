/**
 * Smoke test DETERMINISTICO della eval matrix (no LLM, no browser).
 * Mock: il codegen genera HTML a cui MANCA l'ultima frase (giro 0 fallisce),
 * la "riparazione" reintegra tutte le frasi (giro 1 passa).
 * Atteso: ogni scenario first-pass=false, iterazioni=1, successo finale=true;
 * aggregato firstPassRate=0, finalSuccessRate=1, avgRepairs=1.
 *
 * Lancio:  npx tsx demo/test-eval.ts
 */
import { runMatrix, type EvalDeps } from '../src/eval/matrix.js';
import type { EvalScenario } from '../src/eval/scenarios.js';
import type {
  IntakeClassifier,
  CodeGenerator,
  LLMProvider,
  ProjectSpec,
  QaReport,
  CheckSpec,
  CheckResult,
  Result,
} from '../src/core/index.js';
import { ok } from '../src/core/index.js';

const scenarios: EvalScenario[] = [
  { id: 's1', category: 'business-landing', title: 'T1', description: 'd', knownRoutes: ['/'], statements: ['Mostra "Alpha"', 'Mostra "Beta"'] },
  { id: 's2', category: 'lead-landing', title: 'T2', description: 'd', knownRoutes: ['/'], statements: ['Mostra "Gamma"', 'Mostra "Delta"'] },
];

const quoted = (s: string): string => {
  const m = s.match(/"([^"]+)"/);
  return m ? m[1] : s;
};
const allQuoted = (s: string): string[] => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const classifier: IntakeClassifier = {
  async classify(statement): Promise<Result<CheckSpec | null>> {
    return ok({ kind: 'content-present', route: '/', text: quoted(statement) });
  },
};

// Genera HTML SENZA l'ultima frase -> il primo giro fallisce.
const codegen: CodeGenerator = {
  async generate(spec: ProjectSpec) {
    const texts = spec.criteria
      .map((c) => (c.check && c.check.kind === 'content-present' ? c.check.text : ''))
      .filter(Boolean);
    const body = texts.slice(0, -1).map((t) => '"' + t + '"').join(' ');
    return ok({ specId: spec.id, templateId: 'mock', files: [{ path: 'index.html', contents: `<!doctype html><html><body>${body}</body></html>` }] });
  },
};

// "Ripara": reintegra tutte le frasi citate trovate nel prompt (html + fallimenti).
const llm: LLMProvider = {
  name: 'mock',
  async complete(input) {
    const phrases = allQuoted(input.prompt);
    return ok({ text: `<!doctype html><html><body>${phrases.map((p) => '"' + p + '"').join(' ')}</body></html>` });
  },
};

const runQa = async (html: string, spec: ProjectSpec): Promise<Result<QaReport>> => {
  const level2: CheckResult[] = spec.criteria
    .filter((c) => c.check)
    .map((c) => {
      const ch = c.check as CheckSpec;
      if (ch.kind === 'content-present') {
        const passed = html.includes(ch.text);
        return { criterionId: c.id, kind: ch.kind, passed, ...(passed ? {} : { detail: `manca ${ch.text}` }) };
      }
      return { criterionId: c.id, kind: ch.kind, passed: true };
    });
  const level1: CheckResult[] = [{ criterionId: 'L1:/', kind: 'route-loads', passed: true }];
  const buildSucceeded = level1.every((x) => x.passed) && level2.every((x) => x.passed);
  return ok({ level1, level2, flagged: [], buildSucceeded });
};

const deps: EvalDeps = { classifier, codegen, llm, runQa, maxRepairs: 3 };

const { results, aggregate } = await runMatrix(scenarios, deps, (r) =>
  console.log(`   ${r.id}: firstPass=${r.firstPass} iter=${r.iterations} finale=${r.finalSuccess} (rotti0: ${r.initialFailKinds.join(',') || '-'})`),
);

console.log('\nAggregato:', JSON.stringify(aggregate, null, 2));
const okLogic =
  results.every((r) => !r.firstPass && r.iterations === 1 && r.finalSuccess) &&
  aggregate.firstPassRate === 0 &&
  aggregate.finalSuccessRate === 1 &&
  aggregate.avgRepairs === 1;
console.log(okLogic ? '\nLOGICA OK' : '\nLOGICA INATTESA');
