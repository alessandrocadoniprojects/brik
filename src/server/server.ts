/**
 * Server del prodotto (Fase 3 / tappa 3 — interfaccia).
 *
 * Espone, sopra le funzioni di sessione multi-pagina, una piccola API JSON e
 * serve il frontend statico (web/). L'anteprima del sito generato e servita su
 * /preview/:id/* riscrivendo i link interni assoluti ("/menu" -> "/preview/:id/menu")
 * cosi la navigazione resta dentro l'iframe.
 *
 * Niente build step: si lancia con tsx, come il resto del progetto.
 *   npx tsx --env-file=.env src/server/server.ts
 *
 * Le dipendenze (LLM, classificatore, generatore col recapito form, hosting,
 * scanner) sono cablate da .env esattamente come nella demo. Le operazioni
 * lunghe (create/edit) sono sincrone: il frontend mostra un'attesa. La QA e
 * serializzata (vedi liveQa), quindi una build per volta: adeguato all'uso
 * locale a utente singolo.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { makeAnthropicLLM } from '../adapters/index.js';
import { makeAnthropicSiteGenerator } from '../adapters/anthropic/siteGenerator.js';
import { makeCloudflarePagesHost } from '../adapters/hosting/cloudflarePages.js';
import { makeCloudflarePagesResendHost } from '../adapters/hosting/cloudflarePagesResend.js';
import { makeOwnedFormDelivery } from '../adapters/forms/owned.js';
import { makeAnthropicClassifier } from '../intake/index.js';
import { makeBasicSecurityScanner } from '../security/scanner.js';
import { makeFileSiteStore } from '../project/siteStore.js';
import { summarizeSite } from '../project/site.js';
import {
  createProject,
  getProject,
  editProject,
  approveProject,
  publishProject,
  revertProject,
} from '../project/siteSession.js';
import type { SiteState } from '../project/siteTypes.js';
import { makeLiveQa } from './liveQa.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY (usa: npx tsx --env-file=.env src/server/server.ts).');
  process.exit(1);
}
const PORT = Number(process.env.PORT ?? 4321);

// --- percorsi ---
const webDir = fileURLToPath(new URL('../../web/', import.meta.url));
const dataDir = fileURLToPath(new URL('../../data/sites/', import.meta.url));
const ownersDir = fileURLToPath(new URL('../../data/owners/', import.meta.url));

/** Email di recapito del form, per-sito (lato server, non nello stato del motore). */
function writeOwnerEmail(id: string, email: string): void {
  mkdirSync(ownersDir, { recursive: true });
  writeFileSync(join(ownersDir, id + '.json'), JSON.stringify({ email }), 'utf8');
}
function readOwnerEmail(id: string): string | null {
  try {
    const raw = readFileSync(join(ownersDir, id + '.json'), 'utf8');
    const v = JSON.parse(raw) as { email?: string };
    return typeof v.email === 'string' ? v.email : null;
  } catch {
    return null;
  }
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- dipendenze (come la demo) ---
const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });
const delivery = makeOwnedFormDelivery(); // il form fa POST a /api/contact
const generator = makeAnthropicSiteGenerator(llm, { delivery });
const plainHost = makeCloudflarePagesHost({}); // fallback senza recapito form
const scanner = makeBasicSecurityScanner({ allowedFormHosts: [] }); // form same-origin: niente host esterni
const store = makeFileSiteStore(dataDir);
const RESEND_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM;

const liveQa = await makeLiveQa();
const runQa = liveQa.runQa;

// --- utili HTTP ---
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(s);
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms)),
  ]);
}

// Errori di generazione tipicamente transitori (l'LLM ha omesso/garbled una pagina): si ritenta.
const GEN_RETRYABLE = new Set(['SITE_MISSING_PAGES', 'SITE_NO_FILES']);
type AnyResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
async function withGenRetry<R extends AnyResult>(label: string, attempts: number, fn: () => Promise<R>): Promise<R> {
  let last = await fn();
  let i = 1;
  while (!last.ok && GEN_RETRYABLE.has(last.error.code) && i < attempts) {
    console.log(`  \u21bb ${label}: ${last.error.code} — ritento (${i + 1}/${attempts})`);
    last = await fn();
    i++;
  }
  return last;
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) reject(new Error('body troppo grande'));
      else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        reject(new Error('JSON non valido'));
      }
    });
    req.on('error', reject);
  });
}

/** Vista compatta dello stato per il frontend. */
function stateView(state: SiteState) {
  return {
    id: state.id,
    status: state.status,
    version: state.version,
    url: state.url ?? null,
    publishedAt: state.publishedAt ?? null,
    routes: state.routes.map((r) => ({ route: r.route, label: r.label })),
  };
}

function withSummary(state: SiteState) {
  return { state: stateView(state), summary: summarizeSite(state.spec, state.routes) };
}

function newId(): string {
  return 'site-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

/** Riscrive i link interni assoluti perche puntino dentro l'anteprima. */
function prefixInternalLinks(html: string, base: string): string {
  return html.replace(
    /\b(href|src|action)\s*=\s*("|')(\/(?!\/)[^"']*)\2/gi,
    (_m, attr: string, q: string, path: string) => `${attr}=${q}${base}${path}${q}`,
  );
}

// --- static ---
const STATIC: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  const hit = STATIC[pathname];
  if (!hit) return false;
  try {
    const buf = await readFile(join(webDir, hit.file));
    res.writeHead(200, { 'content-type': hit.type, 'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('frontend non trovato');
  }
  return true;
}

function listProjectIds(): string[] {
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
    .map((f) => f.slice(0, -'.json'.length));
}

// --- routing ---
const server = createServer(async (req, res) => {
  try {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (!path.startsWith('/preview/') && !STATIC[path]) {
      console.log(new Date().toISOString().slice(11, 19), method, path);
    }

    if (method === 'GET' && (await serveStatic(res, path))) return;

    // Stub anteprima: il form dell'anteprima fa POST qui (stesso origin del server).
    // Sul sito pubblicato sara invece la Pages Function a recapitare davvero.
    if (path === '/api/contact' && method === 'POST') {
      return sendJson(res, 200, { ok: true, preview: true });
    }

    // ----- ANTEPRIMA: /preview/:id e /preview/:id/<route>
    if (method === 'GET' && path.startsWith('/preview/')) {
      const rest = path.slice('/preview/'.length);
      const slash = rest.indexOf('/');
      const id = slash === -1 ? rest : rest.slice(0, slash);
      let route = slash === -1 ? '/' : rest.slice(slash);
      if (route === '' || route === '/index.html') route = '/';
      const r = await getProject(store, id);
      if (!r.ok || !r.value) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><p>Anteprima non disponibile.</p>');
        return;
      }
      const page = r.value.pages.find((p) => p.route === route);
      if (!page) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><p>Pagina non trovata.</p>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(prefixInternalLinks(page.html, '/preview/' + id));
      return;
    }

    // ----- API
    if (path === '/api/projects' && method === 'GET') {
      const out: unknown[] = [];
      for (const id of listProjectIds()) {
        const r = await getProject(store, id);
        if (r.ok && r.value) out.push({ id, status: r.value.status, version: r.value.version, title: r.value.spec.title });
      }
      return sendJson(res, 200, { ok: true, projects: out });
    }

    if (path === '/api/projects' && method === 'POST') {
      const body = await readJsonBody(req);
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!description) return sendJson(res, 400, { ok: false, error: { code: 'NO_DESCRIPTION', message: 'Descrizione mancante.' } });
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { ok: false, error: { code: 'NO_EMAIL', message: 'Email di recapito mancante o non valida.' } });
      const id = newId();
      console.log('  → create: pianifico, genero le pagine, QA nel browser… (puo richiedere 1-3 min)');
      const t0 = Date.now();
      const r = await withTimeout(
        withGenRetry('create', 3, () =>
          createProject({ store, id, ownerId: 'web', description, llm, classifier, generator, runQa, maxRepairs: 3 }),
        ),
        420_000,
        'La build ha superato il tempo massimo ed e stata interrotta.',
      );
      if (!r.ok) {
        console.log('  ✗ create:', r.error.code, r.error.message);
        return sendJson(res, 400, { ok: false, error: r.error });
      }
      writeOwnerEmail(id, email);
      console.log('  ✓ create in', ((Date.now() - t0) / 1000).toFixed(1), 's — QA', r.value.report.buildSucceeded ? 'verde' : 'rossa');
      return sendJson(res, 200, { ok: true, id, ...withSummary(r.value.state), buildSucceeded: r.value.report.buildSucceeded });
    }

    const apiMatch = path.match(/^\/api\/projects\/([^/]+)(?:\/(edit|approve|publish|revert))?$/);
    if (apiMatch) {
      const id = decodeURIComponent(apiMatch[1] as string);
      const action = apiMatch[2];

      if (!action && method === 'GET') {
        const r = await getProject(store, id);
        if (!r.ok) return sendJson(res, 400, { ok: false, error: r.error });
        if (!r.value) return sendJson(res, 404, { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Progetto non trovato.' } });
        return sendJson(res, 200, { ok: true, ...withSummary(r.value) });
      }

      if (action === 'edit' && method === 'POST') {
        const body = await readJsonBody(req);
        const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
        if (!instruction) return sendJson(res, 400, { ok: false, error: { code: 'NO_INSTRUCTION', message: 'Istruzione mancante.' } });
        console.log('  → edit:', instruction);
        const t0 = Date.now();
        const r = await withTimeout(
          withGenRetry('edit', 3, () => editProject({ store, id, instruction, llm, generator, runQa })),
          420_000,
          'La modifica ha superato il tempo massimo ed e stata interrotta.',
        );
        if (!r.ok) {
          console.log('  ✗ edit:', r.error.code, r.error.message);
          return sendJson(res, 400, { ok: false, error: r.error });
        }
        console.log('  ✓ edit in', ((Date.now() - t0) / 1000).toFixed(1), 's —', r.value.accepted ? 'applicata' : 'rifiutata');
        return sendJson(res, 200, {
          ok: true,
          accepted: r.value.accepted,
          conflicts: r.value.conflicts,
          changes: r.value.changes ?? [],
          ...withSummary(r.value.state),
        });
      }

      if (action === 'approve' && method === 'POST') {
        const r = await approveProject(store, id);
        if (!r.ok) return sendJson(res, 400, { ok: false, error: r.error });
        return sendJson(res, 200, { ok: true, ...withSummary(r.value) });
      }

      if (action === 'revert' && method === 'POST') {
        const r = await revertProject(store, id);
        if (!r.ok) return sendJson(res, 400, { ok: false, error: r.error });
        return sendJson(res, 200, { ok: true, ...withSummary(r.value) });
      }

      if (action === 'publish' && method === 'POST') {
        const email = readOwnerEmail(id);
        const deliveryActive = !!(email && RESEND_KEY);
        const host = deliveryActive
          ? makeCloudflarePagesResendHost({ ownerEmail: email as string, resendKey: RESEND_KEY, resendFrom: RESEND_FROM })
          : plainHost;
        console.log('  → publish: scan + deploy su Cloudflare… (recapito form: ' + (deliveryActive ? 'attivo' : 'NON attivo') + ')');
        const t0 = Date.now();
        const r = await withTimeout(
          publishProject({ store, id, scanner, host }),
          180_000,
          'La pubblicazione ha superato i 3 minuti ed e stata interrotta.',
        );
        if (!r.ok) {
          console.log('  ✗ publish:', r.error.code, r.error.message);
          return sendJson(res, 400, { ok: false, error: r.error });
        }
        console.log('  ✓ publish in', ((Date.now() - t0) / 1000).toFixed(1), 's —', r.value.published ? 'online' : 'bloccato');
        const findings = r.value.report.byRoute.flatMap((br) =>
          br.findings.map((f) => ({ route: br.route, severity: f.severity, code: f.code, count: f.count })),
        );
        return sendJson(res, 200, { ok: true, published: r.value.published, deliveryActive, findings, ...withSummary(r.value.state) });
      }
    }

    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Risorsa non trovata.' } });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: { code: 'SERVER_ERROR', message: String(e instanceof Error ? e.message : e).slice(0, 200) } });
  }
});

// le build sono lunghe: niente timeout aggressivi
server.requestTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, () => {
  console.log('brik e attivo su http://localhost:' + PORT);
  console.log('Recapito form: ' + (process.env.RESEND_API_KEY ? 'attivo (Resend) — from: ' + (RESEND_FROM ?? 'onboarding@resend.dev') : 'NON configurato (imposta RESEND_API_KEY; senza, il sito pubblicato non recapita i messaggi)'));
  console.log('Hosting: ' + (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID ? 'Cloudflare Pages' : 'NON configurato (publish dara errore finche non imposti le chiavi)'));
});

async function shutdown() {
  await liveQa.close();
  await new Promise<void>((r) => server.close(() => r()));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
