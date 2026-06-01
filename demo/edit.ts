/**
 * DEMO modifica + gate di regressione (Fase 2).
 *
 * Parte dall'anteprima già approvata (demo/preview-output/<id>.html), applica
 * una modifica in parole semplici e fa rigirare la QA sui criteri esistenti.
 *  - accettata -> scrive demo/edit-output/<id>.html
 *  - rifiutata -> elenca i conflitti col requisito; la pagina resta invariata
 *
 * Lancio:
 *   npx tsx --env-file=.env demo/preview.ts portfolio-photographer   (prima)
 *   npx tsx --env-file=.env demo/edit.ts portfolio-photographer "rendi il titolo piu grande"
 *   npx tsx --env-file=.env demo/edit.ts portfolio-photographer "togli il form contatti"
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { makeAnthropicLLM } from '../src/adapters/index.js';
import { makeAnthropicClassifier, buildCriteria } from '../src/intake/index.js';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import { applyChange } from '../src/orchestrator/edit.js';
import { SCENARIOS } from '../src/eval/scenarios.js';
import type { ProjectSpec } from '../src/core/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY.');
  process.exit(1);
}

const id = process.argv[2];
const instruction = process.argv.slice(3).join(' ');
if (!id || !instruction) {
  console.error('Uso: npx tsx --env-file=.env demo/edit.ts <scenario> "<istruzione di modifica>"');
  process.exit(1);
}
const s = SCENARIOS.find((x) => x.id === id);
if (!s) {
  console.error('Scenario non trovato: ' + id + '. Disponibili: ' + SCENARIOS.map((x) => x.id).join(', '));
  process.exit(1);
}

const previewPath = fileURLToPath(new URL('./preview-output/' + id + '.html', import.meta.url));
if (!existsSync(previewPath)) {
  console.error('Manca demo/preview-output/' + id + '.html. Lancia prima:\n  npx tsx --env-file=.env demo/preview.ts ' + id);
  process.exit(1);
}
const currentHtml = readFileSync(previewPath, 'utf8');

const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });
const crit = await buildCriteria(
  { statements: s.statements, context: { category: s.category, knownRoutes: s.knownRoutes } },
  classifier,
);
if (!crit.ok) {
  console.error('intake: ' + crit.error.message);
  process.exit(1);
}
const spec: ProjectSpec = {
  id: s.id,
  ownerId: 'edit',
  category: s.category,
  title: s.title,
  description: s.description,
  criteria: crit.value,
};

let served = currentHtml;
const server = createServer((req, res) => {
  const u = (req.url ?? '/').split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(served);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise<void>((r) => server.listen(0, r));
const baseUrl = 'http://localhost:' + (server.address() as AddressInfo).port;
const browser = await chromium.launch();

console.log('Modifica su "' + id + '": ' + instruction);

try {
  const runQa = (html: string) => {
    served = html;
    return makePlaywrightQaRunner(baseUrl, s.knownRoutes, { browser }).run(
      { specId: spec.id, templateId: 'edit', files: [] },
      spec,
    );
  };

  const out = await applyChange({ spec, currentHtml, instruction, llm, runQa });
  if (!out.ok) {
    console.error('edit: ' + out.error.message);
    process.exit(1);
  }

  if (out.value.accepted) {
    const outDir = new URL('./edit-output/', import.meta.url);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(new URL(id + '.html', outDir), out.value.html);
    console.log('\nMODIFICA APPLICATA — i criteri restano verdi.');
    console.log('Apri:  demo/edit-output/' + id + '.html');
  } else {
    console.log('\nMODIFICA RIFIUTATA — romperebbe il contratto (criteri confermati):');
    for (const c of out.value.conflicts) console.log('  - [' + c.kind + '] ' + c.detail);
    console.log('\nLa pagina resta invariata. Cambiare un requisito confermato richiede di aggiornarlo, non una modifica libera.');
  }
} finally {
  await browser.close();
  server.close();
}
