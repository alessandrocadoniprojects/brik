/**
 * Auth di brik — passwordless (magic link via email) + sessioni server-side.
 *
 * Tutto file-based come il resto del progetto, e parametrizzato sulla cartella
 * (così è testabile in isolamento). Nessuna password da gestire.
 *
 *  - issueLoginToken / consumeLoginToken: token monouso a scadenza per il magic link.
 *  - createSession / getSession / deleteSession: sessioni a scadenza (cookie HttpOnly).
 *  - parseCookies / buildSessionCookie / clearSessionCookie: helper cookie (puri).
 *  - parseOperatorEmails / isOperator: ruolo operatore (tu + concierge) da env.
 *
 * I token e gli id di sessione vengono usati come NOMI DI FILE: il formato è
 * validato (solo hex) per impedire path traversal da input ostile.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface SessionUser {
  readonly email: string;
  readonly isOperator: boolean;
  readonly isAdmin: boolean;
}

const HEX = /^[a-f0-9]{32,}$/;
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const emailKey = (email: string): string => sha(email.trim().toLowerCase());
const randToken = (): string => randomBytes(32).toString('hex'); // 64 hex
const normEmail = (e: string): string => e.trim().toLowerCase();

// ---------- cookie (puri) ----------
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export const SESSION_COOKIE = 'brik_session';

export function buildSessionCookie(id: string, opts: { secure: boolean; maxAgeSec: number }): string {
  const bits = [`${SESSION_COOKIE}=${encodeURIComponent(id)}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`];
  if (opts.secure) bits.push('Secure');
  return bits.join('; ');
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export const GUEST_COOKIE = 'brik_guest';

export function buildGuestCookie(id: string, opts: { secure: boolean; maxAgeSec: number }): string {
  const bits = [`${GUEST_COOKIE}=${encodeURIComponent(id)}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`];
  if (opts.secure) bits.push('Secure');
  return bits.join('; ');
}

export function clearGuestCookie(): string {
  return `${GUEST_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// ---------- operatore ----------
export function parseOperatorEmails(s: string | undefined): Set<string> {
  return new Set((s || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export function isOperator(email: string | null | undefined, operators: Set<string>): boolean {
  return !!email && operators.has(normEmail(email));
}

// ---------- store (file-based) ----------
export interface GuestRecord {
  readonly createdAt: string;
  projectIds: string[];
  genCount: number;
}

export interface AuthStore {
  upsertUser(email: string): void;
  issueLoginToken(email: string, ttlMs: number, now?: number): string;
  consumeLoginToken(token: string, now?: number): string | null;
  createSession(email: string, ttlMs: number, now?: number): string;
  getSession(id: string, now?: number): { email: string } | null;
  deleteSession(id: string): void;
  // ospiti (flusso "prova senza login")
  createGuest(now?: number): string;
  getGuest(id: string): GuestRecord | null;
  saveGuest(id: string, rec: GuestRecord): void;
  // claim dei progetti ospite al login, legato al token del magic link
  setPendingClaim(token: string, projectIds: string[]): void;
  takePendingClaim(token: string): string[];
}

export function makeAuthStore(baseDir: string): AuthStore {
  const usersDir = join(baseDir, 'users');
  const tokensDir = join(baseDir, 'tokens');
  const sessionsDir = join(baseDir, 'sessions');
  const guestsDir = join(baseDir, 'guests');
  const claimsDir = join(baseDir, 'claims');
  const ensure = (): void => {
    for (const d of [usersDir, tokensDir, sessionsDir, guestsDir, claimsDir]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
  };
  const readJson = (p: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  function upsertUser(email: string): void {
    ensure();
    const e = normEmail(email);
    const p = join(usersDir, emailKey(e) + '.json');
    if (!existsSync(p)) writeFileSync(p, JSON.stringify({ email: e, createdAt: new Date().toISOString() }), 'utf8');
  }

  function issueLoginToken(email: string, ttlMs: number, now: number = Date.now()): string {
    ensure();
    const token = randToken();
    writeFileSync(join(tokensDir, token + '.json'), JSON.stringify({ email: normEmail(email), expiresAt: now + ttlMs }), 'utf8');
    return token;
  }

  function consumeLoginToken(token: string, now: number = Date.now()): string | null {
    if (!HEX.test(token)) return null; // formato non valido → niente accesso al filesystem
    const p = join(tokensDir, token + '.json');
    const rec = readJson(p);
    try {
      rmSync(p, { force: true });
    } catch {
      /* monouso: rimuovi comunque */
    }
    if (!rec || typeof rec.expiresAt !== 'number' || rec.expiresAt < now || typeof rec.email !== 'string') return null;
    upsertUser(rec.email);
    return rec.email;
  }

  function createSession(email: string, ttlMs: number, now: number = Date.now()): string {
    ensure();
    const id = randToken();
    writeFileSync(join(sessionsDir, id + '.json'), JSON.stringify({ email: normEmail(email), expiresAt: now + ttlMs }), 'utf8');
    return id;
  }

  function getSession(id: string, now: number = Date.now()): { email: string } | null {
    if (!HEX.test(id)) return null;
    const p = join(sessionsDir, id + '.json');
    const rec = readJson(p);
    if (!rec || typeof rec.expiresAt !== 'number' || typeof rec.email !== 'string') return null;
    if (rec.expiresAt < now) {
      try {
        rmSync(p, { force: true });
      } catch {
        /* scaduta: ripulisci */
      }
      return null;
    }
    return { email: rec.email };
  }

  function deleteSession(id: string): void {
    if (!HEX.test(id)) return;
    try {
      rmSync(join(sessionsDir, id + '.json'), { force: true });
    } catch {
      /* ignora */
    }
  }

  function createGuest(now: number = Date.now()): string {
    ensure();
    const id = randToken();
    const rec: GuestRecord = { createdAt: new Date(now).toISOString(), projectIds: [], genCount: 0 };
    writeFileSync(join(guestsDir, id + '.json'), JSON.stringify(rec), 'utf8');
    return id;
  }

  function getGuest(id: string): GuestRecord | null {
    if (!HEX.test(id)) return null;
    const rec = readJson(join(guestsDir, id + '.json'));
    if (!rec) return null;
    return {
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : '',
      projectIds: Array.isArray(rec.projectIds) ? (rec.projectIds as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      genCount: typeof rec.genCount === 'number' ? rec.genCount : 0,
    };
  }

  function saveGuest(id: string, rec: GuestRecord): void {
    if (!HEX.test(id)) return;
    ensure();
    writeFileSync(join(guestsDir, id + '.json'), JSON.stringify(rec), 'utf8');
  }

  function setPendingClaim(token: string, projectIds: string[]): void {
    if (!HEX.test(token) || !projectIds.length) return;
    ensure();
    writeFileSync(join(claimsDir, token + '.json'), JSON.stringify({ projectIds }), 'utf8');
  }

  function takePendingClaim(token: string): string[] {
    if (!HEX.test(token)) return [];
    const p = join(claimsDir, token + '.json');
    const rec = readJson(p);
    try {
      rmSync(p, { force: true });
    } catch {
      /* monouso */
    }
    return rec && Array.isArray(rec.projectIds) ? (rec.projectIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  }

  return { upsertUser, issueLoginToken, consumeLoginToken, createSession, getSession, deleteSession, createGuest, getGuest, saveGuest, setPendingClaim, takePendingClaim };
}
