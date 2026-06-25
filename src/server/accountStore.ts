// Store account per-email: piano di pubblicazione (B2 gate).
// Persistenza su file: data/accounts/<emailSanificata>.json
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const accountsDir = fileURLToPath(new URL('../../data/accounts/', import.meta.url));

export interface AccountPlan {
  /** Numero massimo di siti pubblicabili dall'account. 0 = nessuna pubblicazione (default trial). */
  maxPublished: number;
  updatedAt: string;
}

const DEFAULT_PLAN: AccountPlan = { maxPublished: 0, updatedAt: '' };

function normEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

function fileFor(email: string): string {
  // sanifica l'email per usarla come nome file
  const safe = normEmail(email).replace(/[^a-z0-9._@-]/g, '_');
  return join(accountsDir, safe + '.json');
}

/** Legge il piano dell'account. Se non esiste, ritorna il default (maxPublished 0). */
export function getAccountPlan(email: string): AccountPlan {
  const e = normEmail(email);
  if (!e) return { ...DEFAULT_PLAN };
  try {
    const p = fileFor(e);
    if (!existsSync(p)) return { ...DEFAULT_PLAN };
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const max = Number(raw?.maxPublished);
    return { maxPublished: Number.isFinite(max) && max >= 0 ? max : 0, updatedAt: String(raw?.updatedAt ?? '') };
  } catch {
    return { ...DEFAULT_PLAN };
  }
}

/** Imposta maxPublished per l'account (operatore ora, Stripe in B3). */
export function setAccountMaxPublished(email: string, maxPublished: number): AccountPlan {
  const e = normEmail(email);
  if (!e) throw new Error('email mancante');
  if (!existsSync(accountsDir)) mkdirSync(accountsDir, { recursive: true });
  const max = Math.max(0, Math.floor(Number(maxPublished) || 0));
  const plan: AccountPlan = { maxPublished: max, updatedAt: new Date().toISOString() };
  writeFileSync(fileFor(e), JSON.stringify(plan), 'utf8');
  return plan;
}

/** Decisione pura del gate B2: un sito puo essere pubblicato? */
export function canPublish(args: { entitled: boolean; status: string; publishedCount: number; maxPublished: number }): boolean {
  // override operatore: un sito entitled si pubblica sempre.
  if (args.entitled) return true;
  // ri-pubblicazione di un sito gia 'published': e gia nel conteggio, non e un nuovo slot.
  if (args.status === 'published') return true;
  // nuovo slot: consentito solo se sotto il limite del piano.
  return args.publishedCount < args.maxPublished;
}
/** B3: maxPublished derivato dallo stato subscription Stripe. Puro, testabile. */
export function maxPublishedForSubscription(args: {
  eventType: string;
  status: string;
  priceId: string;
  priceToMax: Record<string, number>;
}): number {
  const dead = args.eventType === 'customer.subscription.deleted'
    || ['canceled', 'unpaid', 'incomplete_expired'].includes(args.status);
  if (dead || args.status === 'incomplete') return 0;
  // active / trialing / past_due (grace) -> concedi
  return args.priceToMax[args.priceId] ?? 0;
}
