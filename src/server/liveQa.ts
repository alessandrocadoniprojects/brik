/**
 * QA live riutilizzabile (server effimero + Chromium).
 *
 * La stessa cablatura usata dalla demo multi-pagina, estratta come componente:
 * avvia UN server interno (serve le pagine candidate per route) e UN browser
 * Chromium, e restituisce un QaForSite riusabile a ogni richiesta + un close().
 *
 * Le chiamate sono SERIALIZZATE: la mappa delle pagine servite e condivisa, e
 * due build in parallelo la corromperebbero. Una piccola coda evita la race
 * senza complicare il resto (per l'MVP locale e piu che sufficiente).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { makePlaywrightQaRunner } from '../qa/playwrightRunner.js';
import type { QaForSite } from '../project/siteSession.js';
import type { ProjectSpec, SitePage } from '@core';

export interface LiveQa {
  readonly runQa: QaForSite;
  close(): Promise<void>;
}

/** Route note per la QA, derivate dai criteri (stessa fonte del generatore). */
function knownRoutesOf(spec: ProjectSpec): string[] {
  const routes = spec.criteria.flatMap((c) => (c.check && 'route' in c.check ? [c.check.route] : []));
  return Array.from(new Set([...routes, '/']));
}

export async function makeLiveQa(): Promise<LiveQa> {
  const pagesMap = new Map<string, string>();
  const server: Server = createServer((req, res) => {
    const u = (req.url ?? '/').split('?')[0];
    const k = u === '/index.html' ? '/' : u;
    const html = pagesMap.get(k);
    if (html !== undefined) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  const baseUrl = 'http://localhost:' + (server.address() as AddressInfo).port;
  const browser: Browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // coda di serializzazione
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const runQa: QaForSite = (pages: readonly SitePage[], spec: ProjectSpec) =>
    serialize(() => {
      pagesMap.clear();
      for (const p of pages) pagesMap.set(p.route, p.html);
      return makePlaywrightQaRunner(baseUrl, knownRoutesOf(spec), { browser }).run(
        { specId: spec.id, templateId: 'server', files: [] },
        spec,
      );
    });

  return {
    runQa,
    async close() {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
