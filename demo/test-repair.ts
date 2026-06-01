/**
 * Verifica DETERMINISTICA del loop di auto-fix, senza LLM né browser:
 *  - scenario A: la QA fallisce, la "correzione" produce un HTML che passa
 *    → atteso iterazioni=1, build riuscita;
 *  - scenario B: la "correzione" non risolve mai
 *    → atteso iterazioni=maxRepairs, build NON riuscita (si ferma, non cicla all'infinito).
 *
 * Lancio:  npx tsx demo/test-repair.ts
 */
import { repairLoop } from '../src/orchestrator/repair.js';
import type { ProjectSpec, QaReport, LLMProvider, Result } from '../src/core/index.js';
import { ok } from '../src/core/index.js';

const spec: ProjectSpec = {
  id: 'rep',
  ownerId: 't',
  category: 'business-landing',
  title: 'X',
  description: 'd',
  criteria: [{ id: 'c1', statement: 'Mostra "OK"', confirmed: true, check: { kind: 'content-present', route: '/', text: 'OK' } }],
};

const passing: QaReport = {
  level1: [{ criterionId: 'L1:/', kind: 'route-loads', passed: true }],
  level2: [{ criterionId: 'c1', kind: 'content-present', passed: true }],
  flagged: [],
  buildSucceeded: true,
};
const failing: QaReport = {
  level1: [{ criterionId: 'L1:/', kind: 'route-loads', passed: true }],
  level2: [{ criterionId: 'c1', kind: 'content-present', passed: false, detail: 'Testo non visibile: "OK"' }],
  flagged: [],
  buildSucceeded: false,
};

// La QA "passa" solo se l'HTML contiene FIXED.
const runQa = async (html: string): Promise<Result<QaReport>> => ok(html.includes('FIXED') ? passing : failing);

// LLM che corregge: restituisce HTML con FIXED.
const goodFixer: LLMProvider = {
  name: 'mock-good',
  async complete() {
    return ok({ text: '<!DOCTYPE html><html><body>OK FIXED</body></html>' });
  },
};
// LLM che NON corregge mai: restituisce HTML senza FIXED.
const badFixer: LLMProvider = {
  name: 'mock-bad',
  async complete() {
    return ok({ text: '<!DOCTYPE html><html><body>ancora rotto</body></html>' });
  },
};

const log = (i: { iteration: number; buildSucceeded: boolean; failing: number }) =>
  console.log(`   giro ${i.iteration}: build=${i.buildSucceeded} falliti=${i.failing}`);

console.log('Scenario A — la correzione risolve:');
const a = await repairLoop({ spec, llm: goodFixer, initialHtml: '<!DOCTYPE html><html><body>rotto</body></html>', runQa, maxRepairs: 3, onStep: log });
if (!a.ok) throw new Error(a.error.message);
console.log(`   => iterazioni=${a.value.iterations}, build riuscita=${a.value.report.buildSucceeded}`);
console.log(a.value.iterations === 1 && a.value.report.buildSucceeded ? '   ATTESO OK\n' : '   INATTESO\n');

console.log('Scenario B — la correzione non risolve mai (deve fermarsi):');
const b = await repairLoop({ spec, llm: badFixer, initialHtml: '<!DOCTYPE html><html><body>rotto</body></html>', runQa, maxRepairs: 3, onStep: log });
if (!b.ok) throw new Error(b.error.message);
console.log(`   => iterazioni=${b.value.iterations}, build riuscita=${b.value.report.buildSucceeded}`);
console.log(b.value.iterations === 3 && !b.value.report.buildSucceeded ? '   ATTESO OK' : '   INATTESO');
