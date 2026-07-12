/**
 * CRM interno per i siti prospect (Fase CRM v1).
 *
 * Data layer file-based, coerente col resto del progetto:
 *  - data/crm/index.json      → base statica per slug: { projectId, name, city, phone, url, publishedAt }
 *                               (rigenerata dallo script /root/brik_crm_import.mjs)
 *  - data/crm/<slug>.json     → stato mutabile per sito: { status, lastContact, notes, updatedAt }
 *                               (un file per slug → niente clobber tra operatori)
 *  - lo stato acceso/spento vive in data/local-hosting.json (isSubOff), non qui.
 *
 * Le righe mostrate dal CRM sono il merge di questi tre + campi calcolati (daysLive, expired).
 * Nessuna dipendenza esterna, nessun accesso a /root a runtime (l'import bakes tutto in index.json).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isSubOff } from './localHosting.js';

const dataRoot = fileURLToPath(new URL('../../data/', import.meta.url));
const CRM_DIR = join(dataRoot, 'crm');
const INDEX_PATH = join(CRM_DIR, 'index.json');

export const CRM_STATUSES = ['da_contattare', 'contattato', 'interessato', 'venduto', 'scaduto'] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];
function isStatus(s: unknown): s is CrmStatus { return typeof s === 'string' && (CRM_STATUSES as readonly string[]).includes(s); }

const EXPIRY_DAYS = 20;
const SAFE_SLUG = /^[a-z0-9-]{1,80}$/;

interface CrmIndexEntry { projectId: string; name: string; city: string; phone: string; url: string; publishedAt: string }
type CrmIndex = Record<string, CrmIndexEntry>;
interface CrmOverride { status?: CrmStatus; lastContact?: string; notes?: string; updatedAt?: string }

export interface CrmRow extends CrmIndexEntry {
  slug: string;
  status: CrmStatus;
  lastContact: string;
  notes: string;
  off: boolean;
  daysLive: number | null;
  expired: boolean;
}

function loadIndex(): CrmIndex {
  try { return existsSync(INDEX_PATH) ? (JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as CrmIndex) : {}; } catch { return {}; }
}
function overridePath(slug: string): string | null { return SAFE_SLUG.test(slug) ? join(CRM_DIR, slug + '.json') : null; }
function loadOverride(slug: string): CrmOverride {
  const p = overridePath(slug);
  if (!p) return {};
  try { return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as CrmOverride) : {}; } catch { return {}; }
}
function saveOverride(slug: string, patch: CrmOverride): boolean {
  const p = overridePath(slug);
  if (!p) return false;
  mkdirSync(CRM_DIR, { recursive: true });
  const next: CrmOverride = { ...loadOverride(slug), ...patch, updatedAt: new Date().toISOString() };
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(next));
  renameSync(tmp, p);
  return true;
}

function daysSince(iso: string): number | null {
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** True se il CRM è stato inizializzato (index.json presente e non vuoto). */
export function crmReady(): boolean { return Object.keys(loadIndex()).length > 0; }

/** Base statica di un sito per slug (projectId, nome, url…), o null se sconosciuto. Per il fulfillment vendite. */
export function crmIndexEntry(slug: string): (CrmIndexEntry & { slug: string }) | null {
  const e = loadIndex()[slug];
  return e ? { slug, ...e } : null;
}

/** Tutte le righe del CRM (base + stato + on/off + scadenza calcolata), ordinate per nome. */
export function crmRows(): CrmRow[] {
  const idx = loadIndex();
  const rows: CrmRow[] = [];
  for (const [slug, base] of Object.entries(idx)) {
    const ov = loadOverride(slug);
    const status: CrmStatus = isStatus(ov.status) ? ov.status : 'da_contattare';
    const d = daysSince(base.publishedAt);
    rows.push({
      slug,
      projectId: base.projectId, name: base.name, city: base.city, phone: base.phone, url: base.url, publishedAt: base.publishedAt,
      status,
      lastContact: ov.lastContact || '',
      notes: ov.notes || '',
      off: isSubOff(slug),
      daysLive: d,
      expired: d != null && d > EXPIRY_DAYS && status !== 'venduto',
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  return rows;
}

/** Aggiorna i campi mutabili di un sito. Ritorna false su slug/stato non validi. */
export function updateCrmRow(slug: string, patch: { status?: unknown; lastContact?: unknown; notes?: unknown }): boolean {
  if (!SAFE_SLUG.test(slug) || !loadIndex()[slug]) return false;
  const clean: CrmOverride = {};
  if (patch.status !== undefined) { if (!isStatus(patch.status)) return false; clean.status = patch.status; }
  if (patch.lastContact !== undefined) clean.lastContact = String(patch.lastContact).slice(0, 10); // 'YYYY-MM-DD' o ''
  if (patch.notes !== undefined) clean.notes = String(patch.notes).slice(0, 5000);
  return saveOverride(slug, clean);
}
