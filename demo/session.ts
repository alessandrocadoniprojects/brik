/**
 * DEMO sessione progetto con persistenza (Fase 2).
 *
 * Persiste in demo/projects/<id>.json e scrive la pagina corrente in
 * demo/projects/<id>.html (da aprire). I criteri si creano UNA volta (create) e
 * vengono riusati; le modifiche non riclassificano, gli aggiornamenti
 * riclassificano solo le frasi cambiate.
 *
 * Uso:
 *   npx tsx --env-file=.env demo/session.ts <scenario> create
 *   npx tsx --env-file=.env demo/session.ts <scenario> show
 *   npx tsx --env-file=.env demo/session.ts <scenario> approve
 *   npx tsx --env-file=.env demo/session.ts <scenario> edit "<istruzione>"
 *   npx tsx --env-file=.env demo/session.ts <scenario> update replace <n> "<frase>"
 *   npx tsx --env-file=.env demo/session.ts <scenario> update add "<frase>"
 *   npx tsx --env-file=.env demo/session.ts <scenario> update remove <n>
 *   npx tsx --env-file=.env demo/session.ts <scenario> revert
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { makeAnthropicLLM, makeAnthropicCodeGenerator } from '../src/adapters/index.js';
import { makeAnthropicClassifier } from '../src/intake/index.js';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import { makeFileSessionStore } from '../src/project/store.js';
import { makeBasicSecurityScanner } from '../src/security/scanner.js';
import {
  createProject,
  getProject,
  approveProject,
  editProject,
  updateProjectRequirements,
  revertProject,
  publishProject,
  type QaFor,
} from '../src/project/session.js';
import { summarizeSpec } from '../src/orchestrator/preview.js';
import { SCENARIOS } from '../src/eval/scenarios.js';
import type { ProjectState } from '../src/project/types.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY.');
  process.exit(1);
}

const id = process.argv[2];
const cmd = process.argv[3];
const s = id ? SCENARIOS.find((x) => x.id === id) : undefined;
if (!s || !cmd) {
  console.error('Uso: npx tsx --env-file=.env demo/session.ts <scenario> create|show|approve|edit|update|revert ...');
  console.error('Scenari: ' + SCENARIOS.map((x) => x.id).join(', '));
  process.exit(1);
}

const projectsDir = fileURLToPath(new URL('./projects/', import.meta.url));
const store = makeFileSessionStore(projectsDir);

function writeHtml(state: ProjectState): void {
  mkdirSync(projectsDir, { recursive: true });
  writeFileSync(fileURLToPath(new URL('./projects/' + state.id + '.html', import.meta.url)), state.html);
}

function printState(state: ProjectState): void {
  const sm = summarizeSpec(state.spec);
  console.log('\nProgetto: ' + state.id + '  | versione ' + state.version + '  | stato ' + state.status);
  console.log('Contenuti:');
  for (const t of sm.contents) console.log('  - ' + t);
  if (sm.form) console.log('Form: [' + sm.form.fields.join(', ') + '] -> "' + sm.form.confirmation + '"');
  console.log('Mobile: ' + (sm.mobileChecked ? 'si' : 'no'));
  if (sm.manualConfirm.length) {
    console.log('Da confermare a mano:');
    for (const m of sm.manualConfirm) console.log('  - ' + m);
  }
}

// --- comandi senza QA (niente browser) ---
if (cmd === 'show') {
  const r = await getProject(store, id);
  if (!r.ok) {
    console.error(r.error.message);
    process.exit(1);
  }
  if (!r.value) {
    console.log('Nessun progetto "' + id + '". Crealo con: demo/session.ts ' + id + ' create');
    process.exit(0);
  }
  printState(r.value);
  console.log('Apri: demo/projects/' + id + '.html');
  process.exit(0);
}

if (cmd === 'approve') {
  const r = await approveProject(store, id);
  if (!r.ok) {
    console.error(r.error.message);
    process.exit(1);
  }
  console.log('Approvato. Stato: ' + r.value.status + ' (versione ' + r.value.version + ').');
  process.exit(0);
}

if (cmd === 'revert') {
  const r = await revertProject(store, id);
  if (!r.ok) {
    console.error(r.error.message);
    process.exit(1);
  }
  writeHtml(r.value);
  console.log('Ripristinata la versione precedente.');
  printState(r.value);
  console.log('Apri: demo/projects/' + id + '.html');
  process.exit(0);
}

if (cmd === 'scan') {
  const r = await getProject(store, id);
  if (!r.ok) {
    console.error(r.error.message);
    process.exit(1);
  }
  if (!r.value) {
    console.log('Nessun progetto "' + id + '".');
    process.exit(0);
  }
  const rep = makeBasicSecurityScanner().scan(r.value.html);
  if (rep.findings.length === 0) console.log('Scan: nessun problema.');
  else {
    console.log('Scan (' + (rep.blocked ? 'BLOCCA la pubblicazione' : 'solo avvisi') + '):');
    for (const f of rep.findings) console.log('  - [' + f.severity + '] ' + f.code + ' x' + f.count + ' — ' + f.message);
  }
  console.log('Pubblicabile: ' + (rep.blocked ? 'no' : 'si'));
  process.exit(0);
}

if (cmd === 'publish') {
  const r = await publishProject({ store, id, scanner: makeBasicSecurityScanner() });
  if (!r.ok) {
    console.error(r.error.message);
    process.exit(1);
  }
  if (!r.value.published) {
    console.log('PUBBLICAZIONE BLOCCATA dal gate di sicurezza:');
    for (const f of r.value.report.findings) console.log('  - [' + f.severity + '] ' + f.code + ' x' + f.count + ' — ' + f.message);
    process.exit(0);
  }
  mkdirSync(projectsDir, { recursive: true });
  writeFileSync(fileURLToPath(new URL('./projects/' + id + '.published.html', import.meta.url)), r.value.state.html);
  console.log('PUBBLICATO (versione ' + r.value.state.version + ', ' + r.value.state.publishedAt + ').');
  console.log('Artefatto: demo/projects/' + id + '.published.html');
  process.exit(0);
}

// --- comandi con QA (server + browser) ---
const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });
const codegen = makeAnthropicCodeGenerator(llm);

let served = '';
const server: Server = createServer((req, res) => {
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
const browser: Browser = await chromium.launch();

const runQa: QaFor = (html, spec) => {
  served = html;
  return makePlaywrightQaRunner(baseUrl, s.knownRoutes, { browser }).run(
    { specId: spec.id, templateId: 'session', files: [] },
    spec,
  );
};

try {
  if (cmd === 'create') {
    const r = await createProject({
      store,
      id,
      statements: s.statements,
      meta: { ownerId: 'demo', category: s.category, title: s.title, description: s.description, knownRoutes: s.knownRoutes },
      classifier,
      codegen,
      llm,
      runQa,
      maxRepairs: 3,
    });
    if (!r.ok) {
      console.error(r.error.message);
      process.exit(1);
    }
    writeHtml(r.value.state);
    console.log('Progetto creato. QA: ' + (r.value.report.buildSucceeded ? 'verde' : 'ROSSA'));
    printState(r.value.state);
    console.log('Apri: demo/projects/' + id + '.html');
  } else if (cmd === 'edit') {
    const instruction = process.argv.slice(4).join(' ');
    if (!instruction) {
      console.error('edit "<istruzione>"');
      process.exit(1);
    }
    const r = await editProject({ store, id, instruction, llm, runQa });
    if (!r.ok) {
      console.error(r.error.message);
      process.exit(1);
    }
    if (r.value.accepted) {
      writeHtml(r.value.state);
      console.log('MODIFICA APPLICATA (versione ' + r.value.state.version + ').');
      console.log('Apri: demo/projects/' + id + '.html');
    } else {
      console.log('MODIFICA RIFIUTATA — conflitti col contratto:');
      for (const c of r.value.conflicts) console.log('  - [' + c.kind + '] ' + c.detail);
    }
  } else if (cmd === 'update') {
    const action = process.argv[4];
    const cur = await getProject(store, id);
    if (!cur.ok || !cur.value) {
      console.error('Crea prima il progetto: demo/session.ts ' + id + ' create');
      process.exit(1);
    }
    const old = [...cur.value.statements];
    let next: string[];
    if (action === 'replace') {
      const n = Number(process.argv[5]);
      const text = process.argv.slice(6).join(' ');
      if (!Number.isInteger(n) || n < 1 || n > old.length || !text) {
        console.error('update replace <n> "<frase>" (n 1..' + old.length + ')');
        process.exit(1);
      }
      next = old.map((st, i) => (i === n - 1 ? text : st));
    } else if (action === 'add') {
      const text = process.argv.slice(5).join(' ');
      if (!text) {
        console.error('update add "<frase>"');
        process.exit(1);
      }
      next = [...old, text];
    } else if (action === 'remove') {
      const n = Number(process.argv[5]);
      if (!Number.isInteger(n) || n < 1 || n > old.length) {
        console.error('update remove <n> (n 1..' + old.length + ')');
        process.exit(1);
      }
      next = old.filter((_, i) => i !== n - 1);
    } else {
      console.error('update replace|add|remove ...');
      process.exit(1);
    }
    console.log('Requisiti nuovi:');
    next.forEach((st, i) => console.log('  ' + (i + 1) + '. ' + st));
    const r = await updateProjectRequirements({ store, id, newStatements: next, classifier, llm, runQa, knownRoutes: s.knownRoutes, maxRepairs: 3 });
    if (!r.ok) {
      console.error(r.error.message);
      process.exit(1);
    }
    writeHtml(r.value.state);
    console.log('\nREQUISITI AGGIORNATI (riclassificate ' + r.value.reclassified + ' frasi su ' + next.length + ', QA ' + (r.value.report.buildSucceeded ? 'verde' : 'ROSSA') + ', versione ' + r.value.state.version + ').');
    printState(r.value.state);
    console.log('Apri: demo/projects/' + id + '.html');
  } else {
    console.error('Comando non valido: ' + cmd);
    process.exit(1);
  }
} finally {
  await browser.close();
  server.close();
}
