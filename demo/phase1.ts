/**
 * Demo Fase 1 end-to-end (motore jsdom, senza browser/chiavi esterne):
 *   frasi utente → classificazione → criteri tipizzati (+ 1 segnalato)
 *   → QA (L1 + L2) → gate "build riuscita" → eval harness.
 */
import { readFileSync } from 'node:fs';
import type { ProjectSpec, GeneratedProject } from '../src/core/index.js';
import { buildCriteria, mockClassifier } from '../src/intake/index.js';
import { makeJsdomQaRunner } from '../src/qa/index.js';
import { runEval } from '../src/eval/harness.js';

const good = readFileSync(new URL('./app/index.html', import.meta.url), 'utf8');
const broken = good
  .replace('<h1>Trattoria da Mario</h1>', '<h1>Ristorante</h1>')
  .replace('Grazie! Ti ricontattiamo presto.', '');
const resolver = (html: string) => (route: string) => (route === '/' ? html : undefined);

async function main() {
  const statements = [
    'La home deve mostrare "Trattoria da Mario"',
    'Voglio un form contatti che invia e mostra una conferma',
    'Deve funzionare bene su mobile',
    'Vorrei un tono elegante e accogliente', // non testabile → segnalato
  ];
  const context = { category: 'business-landing', knownRoutes: ['/'] };

  const built = await buildCriteria({ statements, context }, mockClassifier);
  if (!built.ok) throw new Error(built.error.message);

  console.log('=== Intake → criteri ===');
  for (const c of built.value) {
    console.log(`${c.id}: ${c.check ? c.check.kind : 'SEGNALATO (non testabile)'} — "${c.statement}"`);
  }

  const spec: ProjectSpec = {
    id: 'prj_demo', ownerId: 'usr', category: 'business-landing',
    title: 'Trattoria da Mario', description: 'Vetrina + contatti',
    criteria: built.value,
  };
  const project: GeneratedProject = { specId: spec.id, templateId: 'tpl:business-landing', files: [] };

  const runner = makeJsdomQaRunner(resolver(good), ['/']);
  const report = await runner.run(project, spec);
  if (!report.ok) throw new Error(report.error.message);

  console.log('\n=== QA report (app corretta) ===');
  console.log('L1:', report.value.level1.map((r) => `${r.passed ? 'PASS' : 'FAIL'} ${r.kind}`).join(' | '));
  console.log('L2:', report.value.level2.map((r) => `${r.passed ? 'PASS' : 'FAIL'} ${r.criterionId}`).join(' | '));
  console.log('Segnalati:', report.value.flagged.map((f) => f.criterionId).join(', ') || '(nessuno)');
  console.log('BUILD RIUSCITA:', report.value.buildSucceeded);

  console.log('\n=== Eval harness (2 scenari) ===');
  const summary = await runEval([
    { name: 'app-corretta', spec, project, runner: makeJsdomQaRunner(resolver(good), ['/']) },
    { name: 'app-rotta', spec, project, runner: makeJsdomQaRunner(resolver(broken), ['/']) },
  ]);
  for (const r of summary.rows) {
    console.log(`${r.name}: build=${r.buildSucceeded} L2=${r.l2Passed}/${r.l2Total} segnalati=${r.flagged}`);
  }
  console.log(`first-pass success rate: ${(summary.firstPassRate * 100).toFixed(0)}%`);
}
void main();
