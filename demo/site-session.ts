/**
 * DEMO live della sessione MULTI-PAGINA (Fase 3 / tappa 2).
 * Persiste in demo/sites/<id>.json e scrive le pagine in demo/sites/<id>/.
 *
 * Uso:
 *   npx tsx --env-file=.env demo/site-session.ts <id> create "descrizione del sito"
 *   npx tsx --env-file=.env demo/site-session.ts <id> show
 *   npx tsx --env-file=.env demo/site-session.ts <id> edit "istruzione"
 *   npx tsx --env-file=.env demo/site-session.ts <id> approve
 *   npx tsx --env-file=.env demo/site-session.ts <id> publish
 *   npx tsx --env-file=.env demo/site-session.ts <id> revert
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { makeAnthropicLLM } from '../src/adapters/index.js';
import { makeAnthropicSiteGenerator } from '../src/adapters/anthropic/siteGenerator.js';
import { makeAnthropicClassifier } from '../src/intake/index.js';
import { makePlaywrightQaRunner } from '../src/qa/playwrightRunner.js';
import { makeBasicSecurityScanner } from '../src/security/scanner.js';
import { makeCloudflarePagesHost } from '../src/adapters/hosting/cloudflarePages.js';
import { makeFileSiteStore } from '../src/project/siteStore.js';
import { summarizeSite } from '../src/project/site.js';
import {
  createProject,
  getProject,
  editProject,
  approveProject,
  publishProject,
  revertProject,
  type QaForSite,
} from '../src/project/siteSession.js';
import type { ProjectSpec, SitePage } from '../src/core/index.js';
import type { SiteState } from '../src/project/siteTypes.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('Manca ANTHROPIC_API_KEY.'); process.exit(1); }

const id = process.argv[2];
const cmd = process.argv[3];
if (!id || !cmd) {
  console.error('Uso: demo/site-session.ts <id> create|show|edit|approve|publish|revert ...');
  process.exit(1);
}

const dir = fileURLToPath(new URL('./sites/', import.meta.url));
const store = makeFileSiteStore(dir);

function writePages(state: SiteState): void {
  const outDir = fileURLToPath(new URL('./sites/' + state.id + '/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  for (const p of state.pages) {
    const file = p.route === '/' ? 'index.html' : p.route.replace(/^\//, '').replace(/\//g, '-') + '.html';
    writeFileSync(outDir + file, p.html);
  }
}

function printState(state: SiteState): void {
  const sm = summarizeSite(state.spec, state.routes);
  console.log('\nProgetto ' + state.id + ' | versione ' + state.version + ' | stato ' + state.status);
  for (const p of sm.pages) {
    console.log('  ' + p.route + ' (' + p.label + '):');
    for (const t of p.contents) console.log('    - "' + t + '"');
    if (p.form) console.log('    - form [' + p.form.fields.join(', ') + '] -> "' + p.form.confirmation + '"');
  }
}

// comandi senza QA
if (cmd === 'show') {
  const r = await getProject(store, id);
  if (!r.ok) { console.error(r.error.message); process.exit(1); }
  if (!r.value) { console.log('Nessun progetto "' + id + '".'); process.exit(0); }
  printState(r.value);
  console.log('Pagine in demo/sites/' + id + '/');
  process.exit(0);
}
if (cmd === 'approve') {
  const r = await approveProject(store, id);
  if (!r.ok) { console.error(r.error.message); process.exit(1); }
  console.log('Approvato (stato ' + r.value.status + ', versione ' + r.value.version + ').');
  process.exit(0);
}
if (cmd === 'publish') {
  const host = process.env.CLOUDFLARE_API_TOKEN ? makeCloudflarePagesHost() : undefined;
  if (!host) console.log('(Nessun CLOUDFLARE_API_TOKEN nel .env: pubblico solo in locale, senza URL online.)');
  const r = await publishProject({ store, id, scanner: makeBasicSecurityScanner(), host });
  if (!r.ok) { console.error(r.error.message); process.exit(1); }
  if (!r.value.published) {
    console.log('PUBBLICAZIONE BLOCCATA dal gate di sicurezza:');
    for (const pr of r.value.report.byRoute) for (const f of pr.findings) console.log('  - ' + pr.route + ' [' + f.severity + '] ' + f.code + ' x' + f.count);
    process.exit(0);
  }
  writePages(r.value.state);
  console.log('PUBBLICATO (versione ' + r.value.state.version + ', ' + r.value.state.publishedAt + ').');
  if (r.value.state.url) console.log('Online: ' + r.value.state.url);
  console.log('Pagine in demo/sites/' + id + '/');
  process.exit(0);
}
if (cmd === 'revert') {
  const r = await revertProject(store, id);
  if (!r.ok) { console.error(r.error.message); process.exit(1); }
  writePages(r.value);
  console.log('Ripristinata la versione precedente.');
  printState(r.value);
  process.exit(0);
}

// comandi con QA (server + browser)
const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });
const generator = makeAnthropicSiteGenerator(llm);

const pagesMap = new Map<string, string>();
const server = createServer((req, res) => {
  const u = (req.url ?? '/').split('?')[0];
  const k = u === '/index.html' ? '/' : u;
  const html = pagesMap.get(k);
  if (html !== undefined) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
  else { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); }
});
await new Promise<void>((r) => server.listen(0, r));
const baseUrl = 'http://localhost:' + (server.address() as AddressInfo).port;
const browser = await chromium.launch();

const runQa: QaForSite = (pages: readonly SitePage[], spec: ProjectSpec) => {
  pagesMap.clear();
  for (const p of pages) pagesMap.set(p.route, p.html);
  return makePlaywrightQaRunner(baseUrl, spec.criteria.flatMap((c) => (c.check && 'route' in c.check ? [c.check.route] : [])).concat('/'), { browser }).run(
    { specId: spec.id, templateId: 'site-session', files: [] },
    spec,
  );
};

try {
  if (cmd === 'create') {
    const description = process.argv.slice(4).join(' ');
    if (!description) { console.error('create "<descrizione>"'); process.exit(1); }
    console.log('Creo il sito da: ' + description + '\n');
    const r = await createProject({ store, id, ownerId: 'demo', description, llm, classifier, generator, runQa, maxRepairs: 3 });
    if (!r.ok) { console.error('create: ' + r.error.message); process.exit(1); }
    writePages(r.value.state);
    console.log('Creato. QA: ' + (r.value.report.buildSucceeded ? 'verde' : 'ROSSA'));
    printState(r.value.state);
    console.log('Apri demo/sites/' + id + '/index.html');
  } else if (cmd === 'edit') {
    const instruction = process.argv.slice(4).join(' ');
    if (!instruction) { console.error('edit "<istruzione>"'); process.exit(1); }
    const r = await editProject({ store, id, instruction, llm, generator, runQa });
    if (!r.ok) { console.error('edit: ' + r.error.message); process.exit(1); }
    if (r.value.accepted) {
      writePages(r.value.state);
      console.log('MODIFICA APPLICATA (versione ' + r.value.state.version + ').');
      if (r.value.changes.length) console.log('Contratto aggiornato: ' + r.value.changes.join('; '));
      printState(r.value.state);
    } else {
      console.log('MODIFICA RIFIUTATA — non ottiene o rompe il contratto:');
      for (const c of r.value.conflicts) console.log('  - [' + c.kind + '] ' + c.detail);
    }
  } else {
    console.error('Comando non valido: ' + cmd);
    process.exit(1);
  }
} finally {
  await browser.close();
  server.close();
}
