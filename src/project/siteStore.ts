/**
 * Persistenza del progetto-sito (Fase 3 / tappa 2).
 *
 * Scrittura ATOMICA (tmp+rename), validazione schema in lettura, e MIGRAZIONE
 * trasparente dei progetti single-page v1 (campo html) al modello multi-pagina
 * v2 (pages + routes): un progetto vecchio diventa un sito di una sola pagina.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Result, ok, err, appError } from '@core';
import type { SiteFile, SiteState } from './siteTypes.js';

export interface SiteStore {
  load(id: string): Promise<Result<SiteFile | null>>;
  save(file: SiteFile): Promise<Result<void>>;
}

function isStrArr(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validateState(st: unknown): st is SiteState {
  if (!st || typeof st !== 'object') return false;
  const s = st as Record<string, unknown>;
  if (typeof s.id !== 'string') return false;
  if (typeof s.version !== 'number' || typeof s.updatedAt !== 'string') return false;
  if (s.status !== 'preview' && s.status !== 'approved' && s.status !== 'published') return false;
  if (!isStrArr(s.statements)) return false;
  if (!Array.isArray(s.routes) || !Array.isArray(s.pages)) return false;
  if (!s.pages.every((p) => p && typeof (p as Record<string, unknown>).route === 'string' && typeof (p as Record<string, unknown>).html === 'string')) return false;
  const spec = s.spec as Record<string, unknown> | undefined;
  if (!spec || !Array.isArray(spec.criteria)) return false;
  return true;
}

/** Converte un file v1 single-page (state.html) in un SiteFile v2 a una pagina. */
function migrateV1(parsed: Record<string, unknown>): SiteFile | null {
  const st = parsed.state as Record<string, unknown> | undefined;
  if (!st || typeof st.html !== 'string' || typeof st.id !== 'string') return null;
  const spec = st.spec as Record<string, unknown> | undefined;
  if (!spec) return null;
  const state: SiteState = {
    id: st.id,
    spec: spec as unknown as SiteState['spec'],
    statements: isStrArr(st.statements) ? st.statements : [],
    routes: [{ route: '/', label: 'Home' }],
    pages: [{ route: '/', html: st.html }],
    status: st.status === 'approved' || st.status === 'published' ? st.status : 'preview',
    version: typeof st.version === 'number' ? st.version : 1,
    updatedAt: typeof st.updatedAt === 'string' ? st.updatedAt : new Date().toISOString(),
  };
  return { schemaVersion: 2, state, history: [] };
}

export function makeFileSiteStore(dir: string): SiteStore {
  return {
    async load(id) {
      const path = join(dir, id + '.json');
      if (!existsSync(path)) return ok(null);
      try {
        const raw = await readFile(path, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.schemaVersion === 1) {
          const migrated = migrateV1(parsed);
          if (!migrated) return err(appError('PROJECT_CORRUPT', 'Progetto v1 non migrabile.', { retryable: false }));
          return ok(migrated);
        }
        if (parsed.schemaVersion !== 2 || !validateState((parsed as Record<string, unknown>).state) || !Array.isArray((parsed as Record<string, unknown>).history)) {
          return err(appError('PROJECT_CORRUPT', 'project.json non valido o schema incompatibile.', { retryable: false }));
        }
        return ok(parsed as unknown as SiteFile);
      } catch (e) {
        return err(appError('PROJECT_READ', 'Lettura progetto fallita: ' + String(e).slice(0, 120), { retryable: false }));
      }
    },
    async save(file) {
      try {
        await mkdir(dir, { recursive: true });
        const path = join(dir, file.state.id + '.json');
        const tmp = path + '.tmp';
        await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
        await rename(tmp, path);
        return ok(undefined);
      } catch (e) {
        return err(appError('PROJECT_WRITE', 'Scrittura progetto fallita: ' + String(e).slice(0, 120), { retryable: true }));
      }
    },
  };
}
