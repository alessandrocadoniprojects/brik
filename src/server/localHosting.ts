/**
 * Local hosting: serve i siti prospect come https://<sub>.thebrik.it direttamente
 * dal VPS, senza Cloudflare Pages (tetto 100 progetti/account raggiunto).
 *
 * Design (minimo indispensabile, riusa il flusso di publish esistente):
 *  - Adapter `makeLocalHostingHost(sub)` con la stessa interfaccia SiteHostingProvider
 *    di Cloudflare Pages: publishProject gli passa le pagine GIA' materializzate
 *    (stesso pipeline della pubblicazione Pages), che scriviamo su disco con lo
 *    stesso layout a cartelle di Pages (layoutFiles). Nessun banner/gate da preview
 *    perche' sono i byte pubblicati, identici a quelli che andrebbero su Pages.
 *  - Mappa persistente `data/local-hosting.json`: { "<sub>": { siteId, publishedAt } }.
 *    Caricata all'avvio (cache in memoria), aggiornata a runtime dal publish.
 *  - Il server serve per Host: se Host == <sub>.thebrik.it e <sub> e' nella mappa,
 *    risponde con il file statico corrispondente alla route.
 *
 * I clienti paganti restano su Cloudflare Pages: questo modulo entra in gioco solo
 * quando il publish riceve `hosting: "local"`.
 */
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type SiteHostingProvider, type SiteDeployResult, type Result, ok, err, appError } from '@core';
import { layoutFiles } from '../adapters/hosting/cloudflarePages.js';

/** Dominio di base per i siti prospect ospitati localmente. */
export const BASE_DOMAIN = 'thebrik.it';

const dataRoot = fileURLToPath(new URL('../../data/', import.meta.url));
const MAP_PATH = join(dataRoot, 'local-hosting.json');
const SITES_DIR = join(dataRoot, 'local-sites');

export interface LocalHostingEntry {
  readonly siteId: string;
  readonly publishedAt: string;
  readonly off?: boolean; // sito "spento" dal CRM: resta in mappa (file su disco intatti) ma non servito
}
type LocalHostingMap = Record<string, LocalHostingEntry>;

let cache: LocalHostingMap | null = null;

function loadMap(): LocalHostingMap {
  if (cache) return cache;
  try {
    cache = existsSync(MAP_PATH) ? (JSON.parse(readFileSync(MAP_PATH, 'utf8')) as LocalHostingMap) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persistMap(map: LocalHostingMap): void {
  mkdirSync(dataRoot, { recursive: true });
  const tmp = MAP_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(map, null, 2));
  renameSync(tmp, MAP_PATH); // scrittura atomica
  cache = map;
}

/** Carica la mappa all'avvio del server (log-friendly). Ritorna il numero di siti. */
export function initLocalHosting(): number {
  return Object.keys(loadMap()).length;
}

/** Sottodominio valido: minuscolo, alfanumerico e trattini, max 63 (un solo label). */
export function sanitizeSub(raw: string): string {
  const base = (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  const trimmed = (base || 'sito').slice(0, 63).replace(/-+$/g, '');
  return trimmed.length >= 1 ? trimmed : 'sito';
}

/** True se il sottodominio e' pubblicato localmente (usato dall'ask di Caddy on-demand TLS). */
export function isPublishedSub(sub: string): boolean {
  return Object.prototype.hasOwnProperty.call(loadMap(), sub);
}

/** True se il sito è stato "spento" dal CRM (resta in mappa, ma va servito come non disponibile). */
export function isSubOff(sub: string): boolean {
  const e = loadMap()[sub];
  return !!(e && e.off);
}

/** Spegne/riaccende un sito pubblicato localmente. I file NON vengono toccati. Ritorna false se il sub non esiste. */
export function setSubOff(sub: string, off: boolean): boolean {
  const map = loadMap();
  const e = map[sub];
  if (!e) return false;
  persistMap({ ...map, [sub]: { ...e, off } });
  return true;
}

/**
 * Estrae il sottodominio prospect da un header Host, se e' un <sub>.thebrik.it
 * pubblicato localmente. Ritorna null per il sito principale (thebrik.it), per
 * sottodomini non in mappa (es. www, relievo) e per host esterni.
 */
export function subForHost(hostHeader: string): string | null {
  const host = (hostHeader || '').toLowerCase().split(':')[0]?.replace(/\.$/, '') ?? '';
  const suffix = '.' + BASE_DOMAIN;
  if (!host.endsWith(suffix)) return null;
  const sub = host.slice(0, -suffix.length);
  if (!sub || sub.includes('.')) return null; // solo sottodomini a un livello
  return isPublishedSub(sub) ? sub : null;
}

/** Percorso del file statico per una route, stesso layout a cartelle di Pages. */
function fileForRoute(sub: string, pathname: string): string {
  let clean = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (clean.endsWith('/index.html')) clean = clean.slice(0, -'/index.html'.length);
  if (clean === '' || clean === 'index.html') return join(SITES_DIR, sub, 'index.html');
  return join(SITES_DIR, sub, clean, 'index.html');
}

/** Legge l'HTML pubblicato per (sub, route). Null se la route non esiste. */
export async function serveLocalSite(sub: string, pathname: string): Promise<string | null> {
  const baseDir = join(SITES_DIR, sub);
  const file = fileForRoute(sub, pathname);
  if (file !== baseDir && !file.startsWith(baseDir + '/')) return null; // anti path-traversal
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Adapter di hosting locale: stessa interfaccia di Cloudflare Pages, ma scrive i
 * file sul VPS e aggiorna la mappa invece di invocare wrangler. publishProject gli
 * passa le pagine gia' materializzate (identiche a quelle che andrebbero su Pages).
 */
export function makeLocalHostingHost(sub: string): SiteHostingProvider {
  const cleanSub = sanitizeSub(sub);
  return {
    async deploy(input): Promise<Result<SiteDeployResult>> {
      try {
        const dir = join(SITES_DIR, cleanSub);
        await rm(dir, { recursive: true, force: true }); // republish pulito
        for (const f of layoutFiles(input.pages)) {
          const full = join(dir, f.path);
          await mkdir(dirname(full), { recursive: true });
          await writeFile(full, f.contents, 'utf8');
        }
        const map = { ...loadMap(), [cleanSub]: { siteId: input.siteId, publishedAt: new Date().toISOString() } };
        persistMap(map);
        return ok({ url: `https://${cleanSub}.${BASE_DOMAIN}` });
      } catch (cause) {
        return err(appError('HOSTING_DEPLOY_FAILED', 'Deploy locale fallito: ' + String(cause).slice(0, 200), { retryable: true }));
      }
    },
  };
}
