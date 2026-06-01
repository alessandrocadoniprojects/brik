/**
 * Persistenza del progetto di sessione (Fase 2).
 *
 * Interfaccia separata dal ProjectStore del core (che salva solo lo spec):
 * qui si persiste l'intero stato (spec + html + stato + versione + history).
 * L'adapter su file scrive in modo ATOMICO (tmp + rename) e VALIDA lo schema in
 * lettura: un file corrotto o di schema incompatibile dà errore esplicito, non
 * un comportamento silenzioso.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Result, ok, err, appError } from '@core';
import type { ProjectFile } from './types.js';

export interface SessionStore {
  load(id: string): Promise<Result<ProjectFile | null>>;
  save(file: ProjectFile): Promise<Result<void>>;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Validazione runtime essenziale dello schema persistito. */
function validate(parsed: unknown): parsed is ProjectFile {
  if (!parsed || typeof parsed !== 'object') return false;
  const f = parsed as Record<string, unknown>;
  if (f.schemaVersion !== 1) return false;
  if (!Array.isArray(f.history)) return false;
  const st = f.state as Record<string, unknown> | undefined;
  if (!st || typeof st !== 'object') return false;
  if (typeof st.id !== 'string' || typeof st.html !== 'string') return false;
  if (typeof st.version !== 'number' || typeof st.updatedAt !== 'string') return false;
  if (st.status !== 'preview' && st.status !== 'approved') return false;
  if (!isStringArray(st.statements)) return false;
  const spec = st.spec as Record<string, unknown> | undefined;
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.criteria)) return false;
  return true;
}

export function makeFileSessionStore(dir: string): SessionStore {
  return {
    async load(id) {
      const path = join(dir, id + '.json');
      if (!existsSync(path)) return ok(null);
      try {
        const raw = await readFile(path, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (!validate(parsed)) {
          return err(appError('PROJECT_CORRUPT', 'project.json non valido o schema incompatibile.', { retryable: false }));
        }
        return ok(parsed);
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
        await rename(tmp, path); // atomico: o il vecchio o il nuovo, mai un file a metà
        return ok(undefined);
      } catch (e) {
        return err(appError('PROJECT_WRITE', 'Scrittura progetto fallita: ' + String(e).slice(0, 120), { retryable: true }));
      }
    },
  };
}
