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
import Stripe from 'stripe';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, appendFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { makeAnthropicLLM } from '../adapters/index.js';
import { makeAnthropicSiteGenerator } from '../adapters/anthropic/siteGenerator.js';
import { injectDesignSystem, deInjectDesignSystem, themeOfPages, isTheme } from '../adapters/anthropic/designSystem.js';
import { makeCloudflarePagesHost } from '../adapters/hosting/cloudflarePages.js';
import { makeCloudflarePagesResendHost } from '../adapters/hosting/cloudflarePagesResend.js';
import { makeOwnedFormDelivery } from '../adapters/forms/owned.js';
import { makePexelsImageSource } from '../adapters/images/pexels.js';
import { makeAnthropicClassifier } from '../intake/index.js';
import { planIntakeQuestions } from '../intake/intakeQuestions.js';
import { planEditClarification } from '../intake/editClarify.js';
import { makeBasicSecurityScanner } from '../security/scanner.js';
import { makeFileSiteStore } from '../project/siteStore.js';
import { getAccountPlan, setAccountMaxPublished, setAccountSubscription, canPublish, maxPublishedForSubscription, nextTier } from './accountStore.js';
import { summarizeSite } from '../project/site.js';
import {
  createProject,
  createHome,
  completePages,
  refineHome,
  finalizePendingRoutes,
  pendingRoutesOf,
  isRenderableHtml,
  isPlaceholderHtml,
  isFallbackHtml,
  getProject,
  editProject,
  approveProject,
  publishProject,
  finalizeProject,
  revertProject,
  lockProject,
  unlockProject,
  trialPhase,
} from '../project/siteSession.js';
import type { SiteState } from '../project/siteTypes.js';
import { makeLiveQa } from './liveQa.js';
import { extractAttachmentText } from './ingest.js';
import { makeAssetStore } from '../project/assets.js';
import { htmlToText, extractImageUrls } from './htmlImport.js';
import { renderPageContent, closeRenderBrowser } from './renderPage.js';
import { withLegal, legalDataToProfile, type LegalData } from './legal.js';
import { validateLegalProfile, type LegalPurposes, type LegalCollectedData, type LegalThirdPartyServices, type CookieMode } from './legalProfile.js';
import { injectVideoFacade, withVideoFacade } from './videoFacade.js';
import { withContactLinks, linkifyContacts } from './contacts.js';
import { injectBlockAssets, withBlockAssets } from './blocks.js';
import { withSiteHead } from './siteHead.js';
import { publicBusinessName, withPublicSanitize } from './publicSanitizer.js';
import { extractPizzeriaBusinessProfile, type BusinessProfile } from './pizzeriaProfile.js';
import { withPizzeriaProfile } from './pizzeriaApply.js';
import { buildPizzeriaLocalSeo, withPizzeriaSeo } from './pizzeriaLocalSeo.js';
import { applyPizzeriaProfileEdit } from './pizzeriaProfileEdits.js';
import { normalizeStartingPoint, mergeStartingPointIntoProfile, type StartingPointIntake } from './startingPoint.js';
import { planPizzeriaIntake, applyPizzeriaIntakeAnswers, ensurePizzeriaProfile, type PizzeriaIntakeAnswers } from './pizzeriaVerticalIntake.js';
import { pizzeriaCreativeNotes, pizzeriaRecommendedTheme } from './pizzeriaGenome.js';
import { getCategory, renderCategoryPage, sitemapXml } from './seoCategories.js';
import { makeAuthStore, parseCookies, buildSessionCookie, clearSessionCookie, buildGuestCookie, clearGuestCookie, GUEST_COOKIE, parseOperatorEmails, isOperator, SESSION_COOKIE, type SessionUser } from './auth.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY (usa: npx tsx --env-file=.env src/server/server.ts).');
  process.exit(1);
}
const PORT = Number(process.env.PORT ?? 4321);

// --- percorsi ---
const webDir = fileURLToPath(new URL('../../web/', import.meta.url));
const dataDir = fileURLToPath(new URL('../../data/sites/', import.meta.url));
const assetsDir = fileURLToPath(new URL('../../data/assets/', import.meta.url));
const ownersDir = fileURLToPath(new URL('../../data/owners/', import.meta.url));
const conciergeDir = fileURLToPath(new URL('../../data/concierge/', import.meta.url));
const genDir = fileURLToPath(new URL('../../data/gen/', import.meta.url)); // marker dei job di generazione asincroni
const authDir = fileURLToPath(new URL('../../data/auth/', import.meta.url));
const chatsDir = fileURLToPath(new URL('../../data/chats/', import.meta.url)); // transcript chat cliente↔AI, per il supporto operatori
const authStore = makeAuthStore(authDir);

// --- Log chat cliente↔AI (per il supporto operatori) ---
// Append-only, una riga JSON per messaggio. L'id è usato come nome file: validato per evitare path traversal.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
function chatPath(id: string): string | null {
  if (!SAFE_ID.test(id)) return null;
  return join(chatsDir, id + '.jsonl');
}
function appendChat(id: string, role: 'user' | 'assistant', text: string): void {
  const p = chatPath(id);
  if (!p || !text) return;
  try {
    if (!existsSync(chatsDir)) mkdirSync(chatsDir, { recursive: true });
    appendFileSync(p, JSON.stringify({ role, text: String(text).slice(0, 4000), at: new Date().toISOString() }) + '\n', 'utf8');
  } catch (e) { console.log('  ✗ chat append', id, errStr(e)); }
}
function readChat(id: string, limit = 1000): Array<{ role: string; text: string; at: string }> {
  const p = chatPath(id);
  if (!p || !existsSync(p)) return [];
  try {
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const out: Array<{ role: string; text: string; at: string }> = [];
    for (const ln of lines.slice(-limit)) {
      try {
        const m = JSON.parse(ln) as { role?: string; text?: string; at?: string };
        if (m && typeof m.text === 'string') out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', text: m.text, at: typeof m.at === 'string' ? m.at : '' });
      } catch { /* salta riga corrotta */ }
    }
    return out;
  } catch { return []; }
}
/** Cancella i transcript inattivi da oltre CHAT_TTL_DAYS (mtime del file = ultima attività). */
function pruneChats(): void {
  if (CHAT_TTL_DAYS <= 0 || !existsSync(chatsDir)) return;
  const cutoff = Date.now() - CHAT_TTL_DAYS * 86_400_000;
  for (const f of readdirSync(chatsDir)) {
    if (!f.endsWith('.jsonl')) continue;
    try { if (statSync(join(chatsDir, f)).mtimeMs < cutoff) rmSync(join(chatsDir, f), { force: true }); } catch { /* ignora */ }
  }
}
const OPERATORS = parseOperatorEmails(process.env.OPERATOR_EMAILS); // tu + concierge
const APP_URL = (process.env.APP_URL || ('http://localhost:' + PORT)).replace(/\/$/, '');
const COOKIE_SECURE = APP_URL.startsWith('https'); // su localhost (http) il cookie Secure non verrebbe accettato
const LOGIN_TTL_MS = 15 * 60_000;        // magic link valido 15 minuti
const SESSION_TTL_MS = 30 * 86_400_000;  // sessione 30 giorni
const SESSION_MAXAGE_SEC = 30 * 86_400;
const AUTH_REQUIRED = /^(1|true|yes|on)$/i.test(process.env.AUTH_REQUIRED ?? ''); // OFF di default: comportamento attuale invariato
const ANON_TRIAL = /^(1|true|yes|on)$/i.test(process.env.ANON_TRIAL ?? ''); // prova senza login: 1 generazione + 1 modifica da ospite, poi auth
const DIRECTOR_REVIEW = !/^(0|false|no|off)$/i.test(process.env.DIRECTOR_REVIEW ?? ''); // gate qualità "direttore creativo": ON di default
const DIRECTOR_MIN_SCORE = Number(process.env.DIRECTOR_MIN_SCORE ?? 7); // soglia di promozione 0-10
const DIRECTOR_FINALIZE = /^(1|true|yes|on)$/i.test(process.env.DIRECTOR_FINALIZE ?? ''); // rigenerazione creativa al publish: OFF di default (WYSIWYG). Opt-in con DIRECTOR_FINALIZE=on
const GUEST_MAXAGE_SEC = 30 * 86_400;
const ANON_GEN_PER_IP_HOUR = Number(process.env.ANON_GEN_PER_IP_HOUR ?? 5); // throttle generazioni anonime per IP/ora (<=0 = nessuno)
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
// Prezzi per-account (B3): un price ricorrente per tier -> maxPublished.
const STRIPE_PRICE_BASE = process.env.STRIPE_PRICE_BASE || '';
const STRIPE_PRICE_PLUS = process.env.STRIPE_PRICE_PLUS || '';
const STRIPE_PRICE_PRO = process.env.STRIPE_PRICE_PRO || '';
const PRICE_TO_MAX: Record<string, number> = {
  ...(STRIPE_PRICE_BASE ? { [STRIPE_PRICE_BASE]: 3 } : {}),
  ...(STRIPE_PRICE_PLUS ? { [STRIPE_PRICE_PLUS]: 10 } : {}),
  ...(STRIPE_PRICE_PRO ? { [STRIPE_PRICE_PRO]: 30 } : {}),
};
// Scala tier per l'upgrade self-service (ordinata per max crescente). Solo i tier con env valorizzata.
const TIER_LADDER: { price: string; max: number }[] = [
  ...(STRIPE_PRICE_BASE ? [{ price: STRIPE_PRICE_BASE, max: 3 }] : []),
  ...(STRIPE_PRICE_PLUS ? [{ price: STRIPE_PRICE_PLUS, max: 10 }] : []),
  ...(STRIPE_PRICE_PRO ? [{ price: STRIPE_PRICE_PRO, max: 30 }] : []),
];
const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;
const STRIPE_READY = !!stripe && !!STRIPE_WEBHOOK_SECRET && !!STRIPE_PRICE_BASE;

// --- Meta Conversions API (tracking server-side degli eventi, es. Purchase) ---
const META_PIXEL_ID = process.env.META_PIXEL_ID || '1611471957649385';
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN || '';
function _sha256(s: string): string { return createHash('sha256').update(s.trim().toLowerCase()).digest('hex'); }
/** Invia un evento alla Conversions API di Meta. Fire-and-forget: non blocca il chiamante. */
async function sendMetaCapi(eventName: string, opts: { value?: number; currency?: string; eventId?: string; email?: string } = {}): Promise<void> {
  if (!META_CAPI_TOKEN) return; // token non configurato: no-op
  try {
    const user_data: Record<string, unknown> = {};
    if (opts.email) user_data.em = [_sha256(opts.email)];
    const payload = {
      data: [{
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        ...(opts.eventId ? { event_id: opts.eventId } : {}),
        ...(Object.keys(user_data).length ? { user_data } : {}),
        custom_data: { ...(opts.value != null ? { value: opts.value } : {}), currency: (opts.currency || 'EUR').toUpperCase() },
      }],
    };
    const res = await fetch('https://graph.facebook.com/v21.0/' + META_PIXEL_ID + '/events?access_token=' + encodeURIComponent(META_CAPI_TOKEN), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) console.log('  ✗ meta capi', eventName, res.status);
    else console.log('  ✓ meta capi', eventName + (opts.value != null ? ' · ' + opts.value + (opts.currency || 'EUR') : ''));
  } catch (e) { console.log('  ✗ meta capi', eventName, errStr(e)); }
}

function sessionUserOf(req: IncomingMessage): SessionUser | null {
  const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!id) return null;
  const sess = authStore.getSession(id);
  if (!sess) return null;
  const admin = isOperator(sess.email, OPERATORS); // operatore da env = fondatore
  return { email: sess.email, isOperator: admin || isStaff(sess.email), isAdmin: admin };
}

/** Dati per-sito su disco (owners/{id}.json): email recapito form, guest, dati legali. */
interface OwnerFile { email?: string; guestId?: string; legal?: LegalData; businessProfile?: BusinessProfile; startingPoint?: StartingPointIntake }
function readOwnerFile(id: string): OwnerFile {
  try { return JSON.parse(readFileSync(join(ownersDir, id + '.json'), 'utf8')) as OwnerFile; } catch { return {}; }
}
function writeOwnerFile(id: string, patch: Partial<OwnerFile>): void {
  mkdirSync(ownersDir, { recursive: true });
  writeFileSync(join(ownersDir, id + '.json'), JSON.stringify({ ...readOwnerFile(id), ...patch }), 'utf8');
}
function writeOwnerEmail(id: string, email: string): void { writeOwnerFile(id, { email }); }
function readOwnerEmail(id: string): string | null { const e = readOwnerFile(id).email; return typeof e === 'string' ? e : null; }
function readLegal(id: string): LegalData { return readOwnerFile(id).legal || {}; }
function writeLegal(id: string, legal: LegalData): void { writeOwnerFile(id, { legal }); }
function readBusinessProfile(id: string): BusinessProfile | undefined { return readOwnerFile(id).businessProfile; }
function writeBusinessProfile(id: string, businessProfile: BusinessProfile): void { writeOwnerFile(id, { businessProfile }); }
function readStartingPoint(id: string): StartingPointIntake | undefined { return readOwnerFile(id).startingPoint; }
function writeStartingPoint(id: string, startingPoint: StartingPointIntake): void { writeOwnerFile(id, { startingPoint }); }
// --- proprietà "ospite" (flusso prova senza login): owners/{id}.json = { guestId } ---
function guestIdOf(req: IncomingMessage): string | null {
  const id = parseCookies(req.headers.cookie)[GUEST_COOKIE];
  return id && /^[a-f0-9]{32,}$/.test(id) ? id : null;
}
function writeOwnerGuest(id: string, guestId: string): void { writeOwnerFile(id, { guestId }); }
function readOwnerGuest(id: string): string | null { const g = readOwnerFile(id).guestId; return typeof g === 'string' ? g : null; }
// Throttle in-memory delle generazioni anonime per IP (anti svuota-cookie). Si azzera al restart.
const anonGenHits = new Map<string, { count: number; windowStart: number }>();
function ipOf(req: IncomingMessage): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined) || '';
  return (fwd.split(',')[0] || '').trim() || req.socket.remoteAddress || 'unknown';
}
function anonGenAllowed(req: IncomingMessage, now: number = Date.now()): boolean {
  if (ANON_GEN_PER_IP_HOUR <= 0) return true;
  const ip = ipOf(req);
  const h = anonGenHits.get(ip);
  if (!h || now - h.windowStart > 3_600_000) { anonGenHits.set(ip, { count: 1, windowStart: now }); return true; }
  if (h.count >= ANON_GEN_PER_IP_HOUR) return false;
  h.count += 1;
  return true;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- dipendenze (come la demo) ---
const llm = makeAnthropicLLM({ apiKey: key });
const classifier = makeAnthropicClassifier({ apiKey: key });
const delivery = makeOwnedFormDelivery({ baseUrl: APP_URL }); // il form fa POST a {APP_URL}/api/contact con pid
const images = makePexelsImageSource(); // foto stock reali nei siti (PEXELS_API_KEY)
const generator = makeAnthropicSiteGenerator(llm, { delivery, images });
// Il form di recapito che brik inietta fa POST a {APP_URL}/api/contact (action assoluta,
// perché il sito vive su *.pages.dev e l'API su brik). Quell'host è FIDATO perché lo mette
// brik, non l'utente: lo aggiungo all'allowlist così lo scanner non blocca la pubblicazione.
// L'host è derivato da APP_URL (stessa fonte del form), non scritto a mano. Tutto il resto
// dello scanner resta invariato: script esterni, eval, iframe esterni, chiavi e altri host
// di form NON consentiti continuano a bloccare.
const FORM_HOST = (() => { try { return new URL(APP_URL).host; } catch { return ''; } })();
const scanner = makeBasicSecurityScanner({ allowedFormHosts: FORM_HOST ? [FORM_HOST] : [] });
const store = makeFileSiteStore(dataDir);
const assetStore = makeAssetStore(assetsDir);
const RESEND_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM;
const CONCIERGE_EMAIL = process.env.CONCIERGE_EMAIL || RESEND_FROM || '';
// Gating "trial poi lock": giorni di prova, frequenza dello sweep, token per riattivare (pre-Stripe).
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 14);
const EDIT_CAP = Number(process.env.EDIT_CAP ?? 10); // modifiche incluse nella prova (<=0 = nessun limite)
const SWEEP_MINUTES = Number(process.env.LOCK_SWEEP_MINUTES ?? 60);
const CHAT_TTL_DAYS = Number(process.env.CHAT_TTL_DAYS ?? 30); // dopo N giorni dall'ultima attività il transcript viene cancellato (0 = mai)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// ── Stripe: lettura raw body (per la firma) + entitlement ───────────────
function errStr(e: unknown): string { return String(e instanceof Error ? e.message : e); }
function readRawBody(req: IncomingMessage, max = 1_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function setEntitled(id: string, value: boolean): Promise<void> {
  const f = await store.load(id);
  if (!f.ok || !f.value) return;
  const state = { ...f.value.state, entitled: value, updatedAt: new Date().toISOString() };
  await store.save({ ...f.value, state });
}
async function setCustomDomain(id: string, domain: string | null): Promise<void> {
  const f = await store.load(id);
  if (!f.ok || !f.value) return;
  const { customDomain: _drop, ...rest } = f.value.state;
  const state = domain ? { ...rest, customDomain: domain, updatedAt: new Date().toISOString() } : { ...rest, updatedAt: new Date().toISOString() };
  await store.save({ ...f.value, state });
}
async function grantEntitlement(id: string): Promise<void> {
  try {
    await setEntitled(id, true);
    const pr = await getProject(store, id);
    if (pr.ok && pr.value && pr.value.status === 'locked') {
      const host = deliveryHostFor(pr.value);
      await unlockProject({ store, id, host, materialize: (pages) => assetStore.materialize(pages, id) });
    }
  } catch (e) { console.log('  ✗ stripe grant', id, errStr(e)); }
}
async function revokeEntitlement(id: string): Promise<void> {
  try {
    await setEntitled(id, false);
    const pr = await getProject(store, id);
    if (pr.ok && pr.value && pr.value.status !== 'locked') {
      const host = makeCloudflarePagesHost({ projectName: projectNameOf(pr.value) });
      await lockProject({ store, id, host, placeholderPages: pausedPages(pr.value) });
    }
  } catch (e) { console.log('  ✗ stripe revoke', id, errStr(e)); }
}

// --- Account "gratis" a livello email: tutti i siti di quell'email sono entitled (e i futuri, alla pubblicazione). ---
const freeEmailsFile = fileURLToPath(new URL('../../data/free_emails.json', import.meta.url));
function readFreeSet(): Set<string> {
  try { return new Set((JSON.parse(readFileSync(freeEmailsFile, 'utf8')) as string[]).map((e) => e.toLowerCase())); } catch { return new Set(); }
}
function writeFreeSet(s: Set<string>): void {
  try { writeFileSync(freeEmailsFile, JSON.stringify([...s]), 'utf8'); } catch (e) { console.log('  ✗ free write', errStr(e)); }
}
function isFreeEmail(email: string | null | undefined): boolean {
  return !!email && readFreeSet().has(email.toLowerCase());
}
async function addFreeEmail(email: string): Promise<void> {
  const e = email.toLowerCase();
  const s = readFreeSet(); s.add(e); writeFreeSet(s);
  for (const id of listProjectIds()) { if ((readOwnerEmail(id) || '').toLowerCase() === e) await grantEntitlement(id); }
}
async function removeFreeEmail(email: string): Promise<void> {
  const e = email.toLowerCase();
  const s = readFreeSet(); s.delete(e); writeFreeSet(s);
  // "Disattiva" toglie SOLO il gratis (non mette in pausa i siti).
  for (const id of listProjectIds()) { if ((readOwnerEmail(id) || '').toLowerCase() === e) await setEntitled(id, false); }
}

// --- Account bloccati (per email): non possono creare/modificare siti (stop costi AI). Gli operatori non sono bloccabili. ---
const blockedEmailsFile = fileURLToPath(new URL('../../data/blocked_emails.json', import.meta.url));
function readBlockedSet(): Set<string> {
  try { return new Set((JSON.parse(readFileSync(blockedEmailsFile, 'utf8')) as string[]).map((e) => e.toLowerCase())); } catch { return new Set(); }
}
function writeBlockedSet(s: Set<string>): void {
  try { writeFileSync(blockedEmailsFile, JSON.stringify([...s]), 'utf8'); } catch (e) { console.log('  ✗ blocked write', errStr(e)); }
}
function isBlockedEmail(email: string | null | undefined): boolean {
  return !!email && readBlockedSet().has(email.toLowerCase());
}
function setBlocked(email: string, v: boolean): void {
  const e = email.toLowerCase(); const s = readBlockedSet(); if (v) s.add(e); else s.delete(e); writeBlockedSet(s);
}

// --- Staff: operatori aggiuntivi gestiti dalla dashboard. Accedono al pannello e ricevono le richieste. Solo l'admin (operatore da env) li gestisce. ---
const staffFile = fileURLToPath(new URL('../../data/staff.json', import.meta.url));
function readStaffSet(): Set<string> {
  try { return new Set((JSON.parse(readFileSync(staffFile, 'utf8')) as string[]).map((e) => e.toLowerCase())); } catch { return new Set(); }
}
function writeStaffSet(s: Set<string>): void {
  try { writeFileSync(staffFile, JSON.stringify([...s]), 'utf8'); } catch (e) { console.log('  ✗ staff write', errStr(e)); }
}
function isStaff(email: string | null | undefined): boolean {
  return !!email && readStaffSet().has(email.toLowerCase());
}
function setStaff(email: string, v: boolean): void {
  const e = email.toLowerCase(); const s = readStaffSet(); if (v) s.add(e); else s.delete(e); writeStaffSet(s);
}

// --- Richieste non soddisfatte: modifiche chieste ma non applicate, per capire cosa manca e implementarlo. ---
interface Feedback { id: string; at: string; kind: string; text: string; projectId?: string; email?: string }
const feedbackFile = fileURLToPath(new URL('../../data/feedback.json', import.meta.url));
function readFeedback(): Feedback[] {
  try { const a = JSON.parse(readFileSync(feedbackFile, 'utf8')) as Feedback[]; return Array.isArray(a) ? a : []; } catch { return []; }
}
function writeFeedback(a: Feedback[]): void {
  try { writeFileSync(feedbackFile, JSON.stringify(a), 'utf8'); } catch (e) { console.log('  ✗ feedback write', errStr(e)); }
}
function addFeedback(f: Omit<Feedback, 'id' | 'at'>): void {
  try { const a = readFeedback(); a.unshift({ id: randomBytes(6).toString('hex'), at: new Date().toISOString(), ...f }); writeFeedback(a.slice(0, 500)); } catch { /* best-effort */ }
}
function removeFeedback(id: string): void {
  try { writeFeedback(readFeedback().filter((f) => f.id !== id)); } catch { /* best-effort */ }
}

// --- Inviti gratis: token con scadenza. Chi si logga e riscatta entro la scadenza diventa account gratis. ---
interface Invite { token: string; createdAt: number; expiresAt: number; redeemedBy: string[]; revoked?: boolean }
const invitesFile = fileURLToPath(new URL('../../data/invites.json', import.meta.url));
function readInvites(): Record<string, Invite> {
  try { return JSON.parse(readFileSync(invitesFile, 'utf8')) as Record<string, Invite>; } catch { return {}; }
}
function writeInvites(m: Record<string, Invite>): void {
  try { writeFileSync(invitesFile, JSON.stringify(m), 'utf8'); } catch (e) { console.log('  ✗ invites write', errStr(e)); }
}
function inviteValid(inv: Invite | undefined, now: number = Date.now()): boolean {
  return !!inv && !inv.revoked && inv.expiresAt > now;
}
function createInvite(hours: number): Invite {
  const now = Date.now();
  const token = randomBytes(12).toString('hex');
  const inv: Invite = { token, createdAt: now, expiresAt: now + Math.max(1, hours) * 3_600_000, redeemedBy: [] };
  const m = readInvites(); m[token] = inv; writeInvites(m);
  return inv;
}
async function redeemInvite(token: string, email: string): Promise<{ ok: boolean; error?: string }> {
  const m = readInvites(); const inv = m[token];
  if (!inviteValid(inv)) return { ok: false, error: 'Link non valido o scaduto.' };
  const e = email.toLowerCase();
  await addFreeEmail(e);
  if (!inv!.redeemedBy.includes(e)) { inv!.redeemedBy.push(e); writeInvites(m); }
  return { ok: true };
}

// --- Metriche prodotto: contatori giornalieri + categorie. Solo aggregati, nessun dato personale. ---
interface MetricsFile { hours: Record<string, Record<string, number>>; cats: Record<string, Record<string, number>> }
const metricsFile = fileURLToPath(new URL('../../data/metrics.json', import.meta.url));
function readMetrics(): MetricsFile {
  let raw: { hours?: Record<string, Record<string, number>>; cats?: Record<string, Record<string, number>>; days?: Record<string, Record<string, number>> } = {};
  try { raw = JSON.parse(readFileSync(metricsFile, 'utf8')); } catch { raw = {}; }
  const hours: Record<string, Record<string, number>> = raw.hours || {};
  const cats: Record<string, Record<string, number>> = raw.cats || {};
  // Migrazione dai vecchi bucket giornalieri (dati pre-orari): ogni giorno → ora 00.
  if (raw.days && !raw.hours) { for (const [d, b] of Object.entries(raw.days)) hours[d + 'T00'] = b; }
  return { hours, cats };
}
function writeMetrics(m: MetricsFile): void {
  try { writeFileSync(metricsFile, JSON.stringify(m), 'utf8'); } catch (e) { console.log('  ✗ metrics write', errStr(e)); }
}
function dayKey(d: number = Date.now()): string { return new Date(d).toISOString().slice(0, 10); }
function hourKey(d: number = Date.now()): string { return new Date(d).toISOString().slice(0, 13); } // 'YYYY-MM-DDTHH' (UTC)
function metricInc(event: string, n: number = 1): void {
  try {
    const m = readMetrics(); const k = hourKey();
    const h = m.hours[k] || (m.hours[k] = {});
    h[event] = (h[event] || 0) + n;
    writeMetrics(m);
  } catch (e) { console.log('  ✗ metric', event, errStr(e)); }
}
function catInc(cat: string | null | undefined): void {
  try {
    const c = (cat || 'altro').toString().toLowerCase().trim().slice(0, 40) || 'altro';
    const m = readMetrics(); const k = hourKey();
    const h = m.cats[k] || (m.cats[k] = {});
    h[c] = (h[c] || 0) + 1; writeMetrics(m);
  } catch { /* best-effort */ }
}
const FUNNEL_KEYS = ['views', 'visitors', 'promptStarted', 'created', 'edited', 'login', 'published'] as const;
function hourStartMs(key: string): number { return Date.parse(key + ':00:00Z'); }
function sumRange(fromMs: number, toMs: number): { funnel: Record<string, number>; categories: Array<{ name: string; count: number }>; series: Array<Record<string, number | string>> } {
  const m = readMetrics();
  const funnel: Record<string, number> = {}; for (const e of FUNNEL_KEYS) funnel[e] = 0;
  const perDay: Record<string, Record<string, number>> = {};
  for (const [k, b] of Object.entries(m.hours)) {
    const ms = hourStartMs(k); if (isNaN(ms) || ms < fromMs || ms >= toMs) continue;
    const day = k.slice(0, 10);
    const pd = perDay[day] || (perDay[day] = {});
    for (const e of FUNNEL_KEYS) { const v = b[e] || 0; funnel[e] = (funnel[e] || 0) + v; pd[e] = (pd[e] || 0) + v; }
  }
  const catAgg: Record<string, number> = {};
  for (const [k, b] of Object.entries(m.cats)) {
    const ms = hourStartMs(k); if (isNaN(ms) || ms < fromMs || ms >= toMs) continue;
    for (const [c, n] of Object.entries(b)) catAgg[c] = (catAgg[c] || 0) + n;
  }
  const categories = Object.entries(catAgg).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count }));
  const series = Object.keys(perDay).sort().map((day) => ({ day, ...(perDay[day] || {}) }));
  return { funnel, categories, series };
}

/** Invia un'email via Resend dal server (Node fetch). Restituisce true se inviata. */
async function sendEmail(to: string | string[], subject: string, html: string, replyTo?: string): Promise<boolean> {
  const recipients = (Array.isArray(to) ? to : [to]).map((x) => (x || '').trim()).filter(Boolean);
  if (!RESEND_KEY || !RESEND_FROM || recipients.length === 0) return false;
  try {
    const payload: Record<string, unknown> = { from: RESEND_FROM, to: recipients, subject, html };
    if (replyTo) payload.reply_to = replyTo;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
// ----- Helper modulo di contatto (form dei siti pubblicati) -----
function readTextBody(req: IncomingMessage, maxBytes = 200_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) reject(new Error('body troppo grande'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
// Rate-limit invii form per IP (sliding window in-memory; si azzera al restart).
const leadHits = new Map<string, number[]>();
function leadRateOk(ip: string): boolean {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 8;
  const arr = (leadHits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    leadHits.set(ip, arr);
    return false;
  }
  arr.push(now);
  leadHits.set(ip, arr);
  return true;
}
function corsHead(req: IncomingMessage): Record<string, string> {
  const origin = (req.headers.origin as string | undefined) || '*';
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'access-control-max-age': '86400',
  };
}
function corsJson(res: ServerResponse, req: IncomingMessage, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...corsHead(req) });
  res.end(JSON.stringify(body));
}

const PEXELS_KEY = process.env.PEXELS_API_KEY;

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

function readJsonBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) reject(new Error('body troppo grande'));
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

/** Blocca host privati/loopback (anti-SSRF di base). L'URL viene comunque dall'utente. */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  return false;
}
async function fetchUrl(url: string, accept: string, timeoutMs = 15000): Promise<{ ok: true; res: Response } | { ok: false; message: string }> {
  let host = '';
  try { host = new URL(url).hostname; } catch { return { ok: false, message: 'Indirizzo non valido.' }; }
  if (isBlockedHost(host)) return { ok: false, message: 'Indirizzo non consentito.' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'brik/1.0 (+content import)', accept } });
    return { ok: true, res };
  } catch (e) {
    return { ok: false, message: String(e instanceof Error ? e.message : e).slice(0, 150) };
  } finally {
    clearTimeout(to);
  }
}

/** Estrae le foto caricate dal body: [{ mime, dataBase64, alt? }] -> byte. Già ridimensionate dal browser. */
function parseUploadedImages(body: Record<string, unknown>): { mime: string; alt?: string; bytes: Buffer }[] {
  const raw = Array.isArray(body.images) ? body.images : [];
  const out: { mime: string; alt?: string; bytes: Buffer }[] = [];
  for (const it of raw) {
    if (out.length >= 6) break;
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const mime = typeof o.mime === 'string' ? o.mime : '';
    const dataBase64 = typeof o.dataBase64 === 'string' ? o.dataBase64 : '';
    if (!mime.startsWith('image/') || !dataBase64) continue;
    const bytes = Buffer.from(dataBase64, 'base64');
    if (bytes.length === 0 || bytes.length > 6 * 1024 * 1024) continue;
    out.push({ mime, bytes, ...(typeof o.alt === 'string' && o.alt.trim() ? { alt: o.alt.trim() } : {}) });
  }
  return out;
}
/** Generatore con le foto utente cucite nel prompt (per-richiesta); altrimenti quello globale. */
function generatorWith(userPhotos: readonly { id: string; alt?: string; isNew?: boolean }[]) {
  return userPhotos.length ? makeAnthropicSiteGenerator(llm, { delivery, images, userPhotos }) : generator;
}

/** Vista compatta dello stato per il frontend. */
function stateView(state: SiteState) {
  const tp = trialPhase(state);
  return {
    id: state.id,
    status: state.status,
    version: state.version,
    url: state.url ?? null,
    publishedAt: state.publishedAt ?? null,
    routes: state.routes.map((r) => ({ route: r.route, label: r.label })),
    pendingRoutes: pendingRoutesOf(state),
    entitled: !!state.entitled,
    // Piano account attivo (Stripe): il frontend lo usa per non mostrare il banner trial ai paganti.
    planActive: getAccountPlan(readOwnerEmail(state.id) || '').maxPublished > 0,
    trialEndsAt: state.trialEndsAt ?? null,
    customDomain: state.customDomain ?? null,
    trialPhase: tp.phase,
    trialDaysLeft: tp.daysLeft,
    editCount: state.editCount ?? 0,
    editCap: EDIT_CAP,
    editsLeft: state.entitled || EDIT_CAP <= 0 ? null : Math.max(0, EDIT_CAP - (state.editCount ?? 0)),
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Inverso di prefixInternalLinks: toglie /preview/<id> dagli attributi (per salvare le modifiche dirette). */
function stripPreviewPrefix(html: string, id: string): string {
  const re = new RegExp('(\\b(?:href|src|action)\\s*=\\s*["\\\'])/preview/' + escapeRegExp(id), 'gi');
  return html.replace(re, '$1');
}

const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
/** Imposta (o rimuove) un override del colore accento, sempre dopo lo stile del tema. */
function setAccent(html: string, accent: string | null): string {
  let out = html.replace(/<style data-brik-accent>[\s\S]*?<\/style>\s*/i, '');
  if (accent && ACCENT_RE.test(accent)) {
    const css = `<style data-brik-accent>:root{--accent:${accent};--accent-soft:color-mix(in srgb, ${accent} 16%, transparent)}</style>`;
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, css + '</head>') : css + out;
  }
  return out;
}

/** Ricerca foto su Pexels (più risultati) per la sostituzione immagini. */
async function searchPexels(query: string, n: number): Promise<{ src: string; thumb: string; alt: string }[]> {
  if (!PEXELS_KEY || !query) return [];
  try {
    const u = 'https://api.pexels.com/v1/search?per_page=' + n + '&orientation=landscape&query=' + encodeURIComponent(query);
    const r = await fetch(u, { headers: { Authorization: PEXELS_KEY } });
    if (!r.ok) return [];
    const data = (await r.json()) as { photos?: { src?: Record<string, string>; alt?: string }[] };
    return (data.photos ?? [])
      .map((p) => ({
        src: p.src?.landscape ?? p.src?.large ?? p.src?.medium ?? '',
        thumb: p.src?.tiny ?? p.src?.small ?? p.src?.medium ?? '',
        alt: p.alt ?? '',
      }))
      .filter((x) => x.src);
  } catch {
    return [];
  }
}

// --- static ---
/** Versione asset: cambia a ogni avvio del processo (= a ogni deploy/restart) → invalida la cache. */
const ASSET_VERSION = Date.now().toString(36);
/** Aggiunge ?v=<versione> agli asset LOCALI .css/.js dentro una pagina HTML (no esterni, no immagini, no doppioni). */
function bustAssets(html: string): string {
  return html.replace(/(\s(?:href|src)=")(\/[^"?]+\.(?:css|js))"/g, (_m, pre, url) => pre + url + '?v=' + ASSET_VERSION + '"');
}

const STATIC: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
  '/brik-logo.png': { file: 'brik-logo.png', type: 'image/png' },
  '/favicon.png': { file: 'favicon.png', type: 'image/png' },
  '/robots.txt': { file: 'robots.txt', type: 'text/plain; charset=utf-8' },
  '/brik-logo-light.png': { file: 'brik-logo-light.png', type: 'image/png' },
  '/brik-logo-email.png': { file: 'brik-logo-email.png', type: 'image/png' },
  '/marketing.css': { file: 'marketing.css', type: 'text/css; charset=utf-8' },
  '/marketing.js': { file: 'marketing.js', type: 'text/javascript; charset=utf-8' },
  '/how-it-works': { file: 'how-it-works.html', type: 'text/html; charset=utf-8' },
  '/pricing': { file: 'pricing.html', type: 'text/html; charset=utf-8' },
  '/templates': { file: 'templates.html', type: 'text/html; charset=utf-8' },
  '/dentisti': { file: 'dentisti.html', type: 'text/html; charset=utf-8' },
  '/dentisti.html': { file: 'dentisti.html', type: 'text/html; charset=utf-8' },
  '/dentisti.css': { file: 'dentisti.css', type: 'text/css; charset=utf-8' },
  '/pizzerie': { file: 'pizzerie.html', type: 'text/html; charset=utf-8' },
  '/pizzerie.html': { file: 'pizzerie.html', type: 'text/html; charset=utf-8' },
  '/pizzerie.css': { file: 'pizzerie.css', type: 'text/css; charset=utf-8' },
  '/pizzerie.js': { file: 'pizzerie.js', type: 'text/javascript; charset=utf-8' },
  '/pizzerie-styles.webp': { file: 'pizzerie-styles.webp', type: 'image/webp' },
};

async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  const sample = pathname.match(/^\/style-samples\/([a-z-]+)\.html$/);
  if (sample && isTheme(sample[1]!)) {
    try {
      const buf = await readFile(join(webDir, 'style-samples', sample[1]! + '.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('campione non trovato');
    }
    return true;
  }
  if (pathname === '/sitemap.xml') {
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    res.end(sitemapXml());
    return true;
  }
  const catSlug = pathname.match(/^\/templates\/([a-z0-9-]+)$/);
  if (catSlug) {
    const c = getCategory(catSlug[1]!);
    if (!c) return false; // categoria inesistente → 404 a valle
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(bustAssets(renderCategoryPage(c)));
    return true;
  }
  // Icone delle sezioni (cubi 3D del picker): una regola serve tutta la cartella.
  const secIcon = pathname.match(/^\/assets\/sections\/([a-z]+)\.png$/);
  if (secIcon) {
    try {
      const buf = await readFile(join(webDir, 'assets', 'sections', secIcon[1]! + '.png'));
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('icona non trovata');
    }
    return true;
  }
  const hit = STATIC[pathname];
  if (!hit) return false;
  try {
    const buf = await readFile(join(webDir, hit.file));
    const body = hit.type.startsWith('text/html') ? bustAssets(buf.toString('utf8')) : buf;
    res.writeHead(200, { 'content-type': hit.type, 'cache-control': 'no-store' });
    res.end(body);
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

/** Conta i siti gia 'published' di un owner (per il gate di piano B2). */
async function publishedCountForOwner(ownerEmail: string): Promise<number> {
  const e=(ownerEmail||'').toLowerCase().trim(); if(!e) return 0;
  let n=0;
  for (const pid of listProjectIds()) {
    if ((readOwnerEmail(pid)||'').toLowerCase()!==e) continue;
    try { const pr=await getProject(store, pid); if (pr.ok && pr.value && pr.value.status==='published') n++; } catch { /* best-effort */ }
  }
  return n;
}

// --- Stato dei job di generazione asincroni (create) -------------------------
// La generazione non viene piu attesa dentro la richiesta HTTP: parte in background
// e il client fa polling su GET /api/projects/{id}. Lo stato vive in memoria E su
// disco, cosi il polling sopravvive a un reload del client. Uno stato 'generating'
// piu vecchio di GEN_STALE_MS = il server e stato riavviato a meta build → lo
// trattiamo come errore (niente polling infinito).
type GenJob = { status: 'generating' | 'error'; error?: { code: string; message: string }; startedAt: number; finishedAt?: number };
const genJobs = new Map<string, GenJob>();
const GEN_STALE_MS = 15 * 60_000;
function genPath(id: string): string { return join(genDir, id + '.json'); }
function writeGenJob(id: string, job: GenJob): void {
  genJobs.set(id, job);
  try { mkdirSync(genDir, { recursive: true }); writeFileSync(genPath(id), JSON.stringify(job), 'utf8'); } catch {}
}
function readGenJob(id: string): GenJob | null {
  let job = genJobs.get(id) ?? null;
  if (!job) {
    try { if (existsSync(genPath(id))) job = JSON.parse(readFileSync(genPath(id), 'utf8')) as GenJob; } catch { job = null; }
  }
  if (!job) return null;
  if (job.status === 'generating' && Date.now() - job.startedAt > GEN_STALE_MS) {
    return { status: 'error', error: { code: 'GEN_INTERRUPTED', message: 'La generazione si e interrotta (riavvio del server). Riprova.' }, startedAt: job.startedAt, finishedAt: Date.now() };
  }
  return job;
}
function clearGenJob(id: string): void {
  genJobs.delete(id);
  try { rmSync(genPath(id), { force: true }); } catch {}
}

/** Richieste dominio (concierge) salvate su disco, più recenti prima. Difensivo: salta i file illeggibili. */
function readDomainRequests(limit = 50): unknown[] {
  if (!existsSync(conciergeDir)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const f of readdirSync(conciergeDir).filter((x) => x.endsWith('.json'))) {
    try { out.push(JSON.parse(readFileSync(join(conciergeDir, f), 'utf8')) as Record<string, unknown>); } catch { /* salta */ }
  }
  out.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  return out.slice(0, limit);
}

// --- gating "trial poi lock" ---
const CF_READY = !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

// --- Domini personalizzati su Cloudflare Pages (self-service, solo CNAME) ---
const CF_DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
function cfDomainsBase(projectName: string): string {
  return 'https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT + '/pages/projects/' + encodeURIComponent(projectName) + '/domains';
}
function cfHeaders(): Record<string, string> { return { authorization: 'Bearer ' + CF_TOKEN, 'content-type': 'application/json' }; }
/** Aggiunge un dominio al progetto Pages. Idempotente: 409/già presente non è un errore. */
async function cfAddDomain(projectName: string, domain: string): Promise<{ ok: boolean; status?: string; message?: string }> {
  try {
    const res = await fetch(cfDomainsBase(projectName), { method: 'POST', headers: cfHeaders(), body: JSON.stringify({ name: domain }) });
    const j = await res.json().catch(() => ({})) as { success?: boolean; result?: { status?: string }; errors?: Array<{ code?: number; message?: string }> };
    if (j.success) return { ok: true, ...(j.result?.status ? { status: j.result.status } : {}) };
    const already = (j.errors || []).some((e) => e.code === 8000000 || /already|exist/i.test(e.message || ''));
    if (already) return { ok: true, status: 'pending' };
    return { ok: false, message: (j.errors && j.errors[0] && j.errors[0].message) || 'Cloudflare ha rifiutato il dominio.' };
  } catch (e) { return { ok: false, message: errStr(e) }; }
}
/** Stato di un dominio del progetto: status (pending/active) + stato certificato. */
async function cfGetDomain(projectName: string, domain: string): Promise<{ ok: boolean; status?: string; message?: string }> {
  try {
    const res = await fetch(cfDomainsBase(projectName) + '/' + encodeURIComponent(domain), { headers: cfHeaders() });
    const j = await res.json().catch(() => ({})) as { success?: boolean; result?: { status?: string; certificate_authority?: string; validation_data?: { status?: string } }; errors?: Array<{ message?: string }> };
    if (j.success && j.result) return { ok: true, ...(j.result.status ? { status: j.result.status } : {}) };
    return { ok: false, message: (j.errors && j.errors[0] && j.errors[0].message) || 'Dominio non trovato.' };
  } catch (e) { return { ok: false, message: errStr(e) }; }
}
async function cfDeleteDomain(projectName: string, domain: string): Promise<boolean> {
  try {
    const res = await fetch(cfDomainsBase(projectName) + '/' + encodeURIComponent(domain), { method: 'DELETE', headers: cfHeaders() });
    return res.ok;
  } catch { return false; }
}
/** True se il dominio è un apex (2 sole label, es. studioxyz.it) → non supportato via CNAME. */
function looksLikeApex(domain: string): boolean { return domain.split('.').length <= 2; }


/** Nome del progetto Cloudflare: dal sottodominio gia pubblicato, altrimenti l'id. */
function projectNameOf(state: SiteState): string {
  const m = (state.url || '').match(/https:\/\/([a-z0-9-]+)\.pages\.dev/i);
  return m && m[1] ? m[1] : state.id;
}

/** Host per riattivare: con recapito form (Resend) se c'e un'email, altrimenti semplice. */
function deliveryHostFor(state: SiteState) {
  const email = readOwnerEmail(state.id);
  const projectName = projectNameOf(state);
  return email
    ? makeCloudflarePagesResendHost({ ownerEmail: email, projectName })
    : makeCloudflarePagesHost({ projectName });
}

/** Pagina "in pausa" deployata al posto del sito quando va in lock (reversibile). */
function pausedPages(state: SiteState) {
  const title = esc(state.spec.title || 'Questo sito');
  const html =
    '<!doctype html><html lang="it"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' — non disponibile</title>' +
    '<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;' +
    'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed;' +
    'text-align:center;padding:24px}.card{max-width:34rem}h1{font-size:1.6rem;margin:0 0 .6rem}' +
    'p{opacity:.78;line-height:1.55;margin:.3rem 0}</style></head><body><div class="card">' +
    '<h1>' + title + ' è temporaneamente non disponibile</h1>' +
    '<p>Il sito è in pausa e tornerà presto online.</p></div></body></html>';
  return [{ route: '/', html }];
}

/** Inietta meta OpenGraph/Twitter nel <head> delle pagine pubblicate → anteprima link su WhatsApp, iMessage, ecc. */
function withOgMeta<T extends { route: string; html: string }>(pages: readonly T[], baseUrl: string): T[] {
  const attr = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const grab = (html: string, re: RegExp): string => { const m = html.match(re); const v = m && m[1]; return v ? v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''; };
  return pages.map((p) => {
    try {
      if (/property=["']og:title["']/i.test(p.html)) return p;
      const headEnd = p.html.search(/<\/head>/i);
      if (headEnd < 0) return p;
      const title = grab(p.html, /<title[^>]*>([\s\S]*?)<\/title>/i) || 'Sito';
      let desc = grab(p.html, /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) || grab(p.html, /<p[^>]*>([\s\S]*?)<\/p>/i);
      if (desc.length > 160) desc = desc.slice(0, 157).trimEnd() + '…';
      const imgM = p.html.match(/https?:\/\/[^"'()\s]+\.(?:jpe?g|png|webp)/i);
      const img = imgM && imgM[0] ? imgM[0] : '';
      const url = baseUrl + (p.route === '/' ? '' : p.route);
      const tags =
        '<meta property="og:type" content="website">' +
        '<meta property="og:site_name" content="' + attr(title) + '">' +
        '<meta property="og:title" content="' + attr(title) + '">' +
        (desc ? '<meta property="og:description" content="' + attr(desc) + '">' : '') +
        '<meta property="og:url" content="' + attr(url) + '">' +
        (img ? '<meta property="og:image" content="' + attr(img) + '">' : '') +
        '<meta name="twitter:card" content="' + (img ? 'summary_large_image' : 'summary') + '">' +
        '<meta name="twitter:title" content="' + attr(title) + '">' +
        (desc ? '<meta name="twitter:description" content="' + attr(desc) + '">' : '') +
        (img ? '<meta name="twitter:image" content="' + attr(img) + '">' : '');
      return { ...p, html: p.html.slice(0, headEnd) + tags + p.html.slice(headEnd) };
    } catch { return p; }
  });
}

/** Garanzia anti-scroll-orizzontale iniettata in anteprima e pubblicazione (vale anche per i siti già generati). */
const GUARD_STYLE =
  '<style data-brik-guard>html,body{overflow-x:hidden !important;max-width:100%}img,svg,video,iframe,table,pre{max-width:100%}</style>';
function guardHtml(html: string): string {
  if (html.includes('data-brik-guard')) return html;
  const i = html.search(/<\/head>/i);
  return i < 0 ? html : html.slice(0, i) + GUARD_STYLE + html.slice(i);
}
function withGuard<T extends { html: string }>(pages: readonly T[]): T[] {
  return pages.map((p) => ({ ...p, html: guardHtml(p.html) }));
}

/** Sweep periodico: mette in pausa i siti pubblicati con prova scaduta e non abilitati. */
async function sweepTrials(): Promise<void> {
  for (const id of listProjectIds()) {
    try {
      const pr = await getProject(store, id);
      if (!pr.ok || !pr.value) continue;
      const st = pr.value;
      if (st.status !== 'published' && st.status !== 'preview' && st.status !== 'approved') continue;
      if (trialPhase(st).phase !== 'expired') continue;
      const onCf = st.status === 'published';
      const r = await lockProject({ store, id, ...(onCf ? { host: makeCloudflarePagesHost({ projectName: projectNameOf(st) }) } : {}), placeholderPages: onCf ? pausedPages(st) : [] });
      if (r.ok) console.log('  ⏸ lock (prova scaduta):', id);
      else console.log('  ✗ lock', id, r.error.code);
    } catch (e) {
      console.log('  ✗ sweep', id, String(e).slice(0, 100));
    }
  }
  // pulizia marker di generazione: errori vecchi e build interrotte (oltre 1h) non servono piu
  try {
    if (existsSync(genDir)) {
      for (const f of readdirSync(genDir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const j = JSON.parse(readFileSync(join(genDir, f), 'utf8')) as GenJob;
          if (j.status === 'error' || Date.now() - (j.startedAt || 0) > 60 * 60_000) rmSync(join(genDir, f), { force: true });
        } catch { rmSync(join(genDir, f), { force: true }); }
      }
    }
  } catch {}
  pruneChats();
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

    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      metricInc('views');
      try {
        const today = dayKey();
        if (parseCookies(req.headers.cookie)['brik_v'] !== today) {
          metricInc('visitors');
          res.setHeader('Set-Cookie', `brik_v=${today}; Path=/; Max-Age=34560000; SameSite=Lax${COOKIE_SECURE ? '; Secure' : ''}`);
        }
      } catch { /* conteggio best-effort */ }
    }
    if (method === 'GET' && (await serveStatic(res, path))) return;

    // Stub anteprima: il form dell'anteprima fa POST qui (stesso origin del server).
    // Sul sito pubblicato sara invece la Pages Function a recapitare davvero.
    if (path === '/api/contact' && method === 'OPTIONS') {
      res.writeHead(204, corsHead(req));
      res.end();
      return;
    }
    if (path === '/api/contact' && method === 'POST') {
      let raw = '';
      try { raw = await readTextBody(req); } catch { return corsJson(res, req, 200, { ok: true }); }
      const params = new URLSearchParams(raw);
      // 1) honeypot: il checkbox nascosto non deve mai essere valorizzato
      if ((params.get('botcheck') || '').trim() !== '') return corsJson(res, req, 200, { ok: true });
      // 2) invio sospettosamente rapido = bot
      const dt = parseInt(params.get('_dt') || '0', 10);
      if (dt > 0 && dt < 1200) return corsJson(res, req, 200, { ok: true });
      // 3) rate-limit per IP
      if (!leadRateOk(ipOf(req))) return corsJson(res, req, 429, { ok: false, error: { code: 'RATE', message: 'Troppi invii, riprova più tardi.' } });
      const pid = (params.get('pid') || '').trim();
      if (!pid) return corsJson(res, req, 400, { ok: false });
      const to = readOwnerEmail(pid);
      if (!to) return corsJson(res, req, 200, { ok: true }); // titolare senza email: niente da recapitare
      let title = '';
      try { const pr = await getProject(store, pid); if (pr.ok && pr.value && pr.value.spec) title = pr.value.spec.title || ''; } catch { /* best-effort */ }
      const skip = new Set(['pid', 'botcheck', '_dt']);
      let visitorEmail = '';
      const rows: string[] = [];
      for (const [k, v] of params) {
        if (skip.has(k)) continue;
        const val = (v || '').toString().slice(0, 5000).trim();
        if (!val) continue;
        if (!visitorEmail && /mail/i.test(k) && /.+@.+\..+/.test(val)) visitorEmail = val;
        const label = (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' ');
        rows.push('<tr><td style="padding:6px 14px;font-weight:600;vertical-align:top;color:#444">' + esc(label) + '</td><td style="padding:6px 14px;white-space:pre-wrap">' + esc(val) + '</td></tr>');
      }
      if (!rows.length) return corsJson(res, req, 400, { ok: false });
      const subject = 'Nuovo messaggio dal tuo sito' + (title ? ' · ' + title : '');
      const html =
        '<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:560px">' +
        '<h2 style="margin:0 0 12px">Nuovo messaggio dal modulo di contatto</h2>' +
        (title ? '<p style="margin:0 0 12px;color:#666">Sito: ' + esc(title) + '</p>' : '') +
        '<table style="border-collapse:collapse;font-size:14px;width:100%">' + rows.join('') + '</table>' +
        '<p style="margin:18px 0 0;color:#999;font-size:12px">Inviato dal modulo di contatto del tuo sito (brik).</p></div>';
      const sent = await sendEmail(to, subject, html, visitorEmail || undefined);
      return corsJson(res, req, sent ? 200 : 502, { ok: sent });
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
      const html = page.html.includes('data-brik-img="user:')
        ? (assetStore.materialize([{ route: page.route, html: page.html }], id)[0]?.html ?? page.html)
        : page.html;
      res.end(prefixInternalLinks(linkifyContacts(injectVideoFacade(injectBlockAssets(guardHtml(html)))), '/preview/' + id));
      return;
    }

    // ----- API
    if (path === '/api/projects' && method === 'GET') {
      let me2: SessionUser | null = null;
      if (AUTH_REQUIRED) {
        me2 = sessionUserOf(req);
        if (!me2) return sendJson(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Accesso richiesto.' } });
      }
      const out: unknown[] = [];
      for (const id of listProjectIds()) {
        const r = await getProject(store, id);
        if (!r.ok || !r.value) continue;
        if (me2 && !me2.isOperator && (readOwnerEmail(id) || '').toLowerCase() !== me2.email) continue; // solo i propri siti
        out.push({ id, status: r.value.status, version: r.value.version, title: r.value.spec.title });
      }
      return sendJson(res, 200, { ok: true, projects: out });
    }

    // Dashboard attività: tutti i progetti con stato/prova + le richieste dominio. Solo dati locali.
    // Transcript chat di un progetto (operatori): per il supporto durante la costruzione.
    if (path === '/api/activity/chat' && method === 'GET') {
      if (AUTH_REQUIRED) {
        const me2 = sessionUserOf(req);
        if (!me2) return sendJson(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Accesso richiesto.' } });
        if (!me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
      }
      const cid = url.searchParams.get('id') || '';
      const messages = readChat(cid);
      let title = cid;
      try { const r = await getProject(store, cid); if (r.ok && r.value) title = r.value.spec.title || cid; } catch { /* best-effort */ }
      return sendJson(res, 200, { ok: true, id: cid, title, messages });
    }

    if (path === '/api/activity' && method === 'GET') {
      if (AUTH_REQUIRED) {
        const me2 = sessionUserOf(req);
        if (!me2) return sendJson(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Accesso richiesto.' } });
        if (!me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
      }
      const projects: Array<{ owner?: string; [k: string]: unknown }> = [];
      let sitesPublished = 0, totalEdits = 0;
      for (const id of listProjectIds()) {
        const r = await getProject(store, id);
        if (r.ok && r.value) {
          if (r.value.status === 'published') sitesPublished++;
          totalEdits += r.value.editCount ?? 0;
          projects.push({ ...stateView(r.value), title: r.value.spec.title, updatedAt: r.value.updatedAt, owner: readOwnerEmail(id) || (readOwnerGuest(id) ? 'ospite' : '') });
        }
      }
      const sitesCreated = projects.length;
      let totalUsers = 0;
      try { totalUsers = readdirSync(join(authDir, 'users')).filter((f) => f.endsWith('.json')).length; } catch { /* dir vuota */ }
      const freeAccounts = [...readFreeSet()].map((email) => ({ email, sites: projects.filter((p) => (p.owner || '').toLowerCase() === email).length }));
      const stats = { users: totalUsers, sitesCreated, sitesPublished, totalEdits, avgEdits: sitesCreated ? Math.round((totalEdits / sitesCreated) * 10) / 10 : 0 };
      const nowTs = Date.now();
      const invites = Object.values(readInvites())
        .filter((i) => !i.revoked && i.expiresAt > nowTs)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((i) => ({ token: i.token, url: APP_URL + '/?free=' + i.token, expiresAt: i.expiresAt, redeemed: i.redeemedBy.length }));
      // Ospiti (pre-login): un record nasce al primo tentativo di creazione.
      let guestsTotal = 0, guestsCreated = 0, guestsNew7 = 0;
      const wk = nowTs - 7 * 86_400_000;
      try {
        for (const f of readdirSync(join(authDir, 'guests'))) {
          if (!f.endsWith('.json')) continue;
          try {
            const g = JSON.parse(readFileSync(join(authDir, 'guests', f), 'utf8')) as { createdAt?: string; projectIds?: string[]; genCount?: number };
            guestsTotal++;
            if ((g.genCount || 0) >= 1 || (g.projectIds || []).length >= 1) guestsCreated++;
            if (g.createdAt && new Date(g.createdAt).getTime() >= wk) guestsNew7++;
          } catch { /* record illeggibile */ }
        }
      } catch { /* nessuna dir ospiti */ }
      const guestSites = projects.filter((p) => p.owner === 'ospite').length;
      const guests = { total: guestsTotal, created: guestsCreated, new7: guestsNew7, sites: guestSites, conversion: guestsCreated ? Math.round((totalUsers / guestsCreated) * 100) : 0 };
      return sendJson(res, 200, { ok: true, stats, freeAccounts, invites, guests, staff: [...readStaffSet()], feedback: readFeedback().slice(0, 100), projects, domainRequests: readDomainRequests() });
    }

    // Metriche per intervallo arbitrario (from/to in ms). Funnel + categorie + serie per giorno.
    if (path === '/api/metrics' && method === 'GET') {
      const me2 = sessionUserOf(req);
      if (!me2 || !me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
      const u = new URL(req.url || '/', APP_URL);
      const now = Date.now();
      const to = Number(u.searchParams.get('to')) || now;
      const from = Number(u.searchParams.get('from')) || (to - 7 * 86_400_000);
      const out = sumRange(from, to);
      return sendJson(res, 200, { ok: true, from, to, ...out });
    }

    // Attiva/disattiva un ACCOUNT gratis (per email) — riservato agli operatori.
    if (path === '/api/admin/free' && method === 'POST') {
      const me2 = sessionUserOf(req);
      if (!me2 || !me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
      const body = await readJsonBody(req);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email || !EMAIL_RE.test(email)) return sendJson(res, 400, { ok: false, error: { code: 'BAD_EMAIL', message: 'Email non valida.' } });
      const value = body.value === true || body.value === 1 || body.value === '1';
      if (value) await addFreeEmail(email); else await removeFreeEmail(email);
      return sendJson(res, 200, { ok: true, email, free: value });
    }

    // B2: imposta il piano (maxPublished siti) di un ACCOUNT per email — solo operatori.
    // A regime lo scrivera il webhook Stripe (B3); per ora attivazione manuale.
    if (path === '/api/admin/plan' && method === 'POST') {
      const me2 = sessionUserOf(req);
      if (!me2 || !me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
      const body = await readJsonBody(req);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email || !EMAIL_RE.test(email)) return sendJson(res, 400, { ok: false, error: { code: 'BAD_EMAIL', message: 'Email non valida.' } });
      const maxPublished = Number(body.maxPublished);
      if (!Number.isFinite(maxPublished) || maxPublished < 0) return sendJson(res, 400, { ok: false, error: { code: 'BAD_PLAN', message: 'maxPublished deve essere un numero >= 0.' } });
      const plan = setAccountMaxPublished(email, maxPublished);
      console.log('  \u2713 plan_set: ' + email + ' \u00b7 maxPublished ' + plan.maxPublished);
      return sendJson(res, 200, { ok: true, email, plan });
    }

    // Elenco utenti iscritti + stato (operatori).
    if (path === '/api/admin/users' && method === 'GET') {
      const me2 = sessionUserOf(req);
      if (!me2 || !me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
      const freeSet = readFreeSet(); const blockedSet = readBlockedSet();
      const siteCount: Record<string, number> = {};
      for (const id of listProjectIds()) { const o = (readOwnerEmail(id) || '').toLowerCase(); if (o) siteCount[o] = (siteCount[o] || 0) + 1; }
      let files: string[] = [];
      try { files = readdirSync(join(authDir, 'users')).filter((f) => f.endsWith('.json')); } catch { /* dir vuota */ }
      const users = files.map((f) => {
        let email = ''; let createdAt = '';
        try { const u = JSON.parse(readFileSync(join(authDir, 'users', f), 'utf8')) as { email?: string; createdAt?: string }; email = (u.email || '').toLowerCase(); createdAt = u.createdAt || ''; } catch { /* file illeggibile */ }
        return { email, createdAt, sites: siteCount[email] || 0, free: freeSet.has(email), blocked: blockedSet.has(email), operator: isOperator(email, OPERATORS) };
      }).filter((u) => u.email).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return sendJson(res, 200, { ok: true, users });
    }

    // Blocca/sblocca un account (operatori). Gli operatori non sono bloccabili.
    if (path === '/api/admin/block' && method === 'POST') {
      const me2 = sessionUserOf(req);
      if (!me2 || !me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
      const body = await readJsonBody(req);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email || !EMAIL_RE.test(email)) return sendJson(res, 400, { ok: false, error: { code: 'BAD_EMAIL', message: 'Email non valida.' } });
      const value = body.value === true || body.value === 1 || body.value === '1';
      if (value && isOperator(email, OPERATORS)) return sendJson(res, 400, { ok: false, error: { code: 'IS_OPERATOR', message: 'Non puoi bloccare un operatore.' } });
      setBlocked(email, value);
      return sendJson(res, 200, { ok: true, email, blocked: value });
    }

    // Gestione staff (solo admin/fondatore). Lo staff diventa operatore: pannello + notifiche richieste.
    if (path === '/api/admin/staff' && method === 'POST') {
      const me2 = sessionUserOf(req);
      if (!me2 || !me2.isAdmin) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo il titolare può gestire lo staff.' } });
      const body = await readJsonBody(req);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email || !EMAIL_RE.test(email)) return sendJson(res, 400, { ok: false, error: { code: 'BAD_EMAIL', message: 'Email non valida.' } });
      if (isOperator(email, OPERATORS)) return sendJson(res, 400, { ok: false, error: { code: 'IS_ADMIN', message: 'È già il titolare.' } });
      const value = body.value === true || body.value === 1 || body.value === '1';
      setStaff(email, value);
      return sendJson(res, 200, { ok: true, email, staff: value });
    }

    // Elimina una richiesta non soddisfatta (operatori).
    if (path === '/api/admin/feedback/dismiss' && method === 'POST') {
      const me2 = sessionUserOf(req);
      if (!me2 || !me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
      const body = await readJsonBody(req);
      const id = typeof body.id === 'string' ? body.id : '';
      if (id) removeFeedback(id);
      return sendJson(res, 200, { ok: true });
    }

    // Genera un link di accesso gratuito con scadenza (operatori).
    if (path === '/api/admin/invite' && method === 'POST') {
      const me2 = sessionUserOf(req);
      if (!me2 || !me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
      const body = await readJsonBody(req);
      const hours = Math.min(8760, Math.max(1, Number(body.hours) || 24));
      const inv = createInvite(hours);
      return sendJson(res, 200, { ok: true, token: inv.token, url: APP_URL + '/?free=' + inv.token, expiresAt: inv.expiresAt });
    }

    // Disattiva un link di invito (operatori).
    if (path === '/api/admin/invite/revoke' && method === 'POST') {
      const me2 = sessionUserOf(req);
      if (!me2 || !me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
      const body = await readJsonBody(req);
      const token = typeof body.token === 'string' ? body.token : '';
      const m = readInvites(); if (m[token]) { m[token].revoked = true; writeInvites(m); }
      return sendJson(res, 200, { ok: true });
    }

    // Riscatto invito: l'utente LOGGATO diventa account gratis. Non serve operatore: il token è il segreto.
    if (path === '/api/free/redeem' && method === 'POST') {
      const me2 = sessionUserOf(req);
      if (!me2) return sendJson(res, 401, { ok: false, error: { code: 'NEEDS_AUTH', message: 'Accedi per attivare l\'accesso gratuito.' } });
      const body = await readJsonBody(req);
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      const r = await redeemInvite(token, me2.email);
      if (!r.ok) return sendJson(res, 400, { ok: false, error: { code: 'INVALID_INVITE', message: r.error || 'Link non valido.' } });
      return sendJson(res, 200, { ok: true });
    }

    // Evento prodotto leggero dal client (solo nomi consentiti, nessun dato personale).
    if (path === '/api/ev' && method === 'POST') {
      try { const b = await readJsonBody(req); if (b && b.name === 'promptStarted') metricInc('promptStarted'); } catch { /* ignora */ }
      return sendJson(res, 200, { ok: true });
    }

    // --- AUTH passwordless (magic link). Per ora SENZA enforcement: non protegge ancora nulla. ---
    if (path === '/api/auth/request' && method === 'POST') {
      const body = await readJsonBody(req);
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!email || !EMAIL_RE.test(email)) return sendJson(res, 400, { ok: false, error: { code: 'BAD_EMAIL', message: 'Email non valida.' } });
      const token = authStore.issueLoginToken(email, LOGIN_TTL_MS);
      // se è un ospite con progetti, lega il claim a questo token (vale anche da un altro device)
      if (ANON_TRIAL) {
        const gid = guestIdOf(req);
        const g = gid ? authStore.getGuest(gid) : null;
        if (g && g.projectIds.length) authStore.setPendingClaim(token, g.projectIds);
      }
      const link = APP_URL + '/api/auth/verify?token=' + token;
      const logo = APP_URL + '/brik-logo-email.png';
      const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  @media (prefers-color-scheme: dark) {
    .brik-bg { background:#0b0b14 !important; }
    .brik-card { background:#15151f !important; border-color:#2a2a36 !important; }
    .brik-title { color:#ffffff !important; }
    .brik-text { color:#c8c8d4 !important; }
    .brik-fine { color:#8a93a6 !important; }
    .brik-foot { border-top-color:#2a2a36 !important; }
  }
</style>
</head>
<body class="brik-bg" style="margin:0;padding:0;background:#eef0f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef0f4" class="brik-bg" style="background:#eef0f4;margin:0;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" class="brik-card" style="width:480px;max-width:92%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e6ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr><td align="center" bgcolor="#0d0f15" style="background:#0d0f15;padding:24px;">
        <img src="${esc(logo)}" alt="brik" width="210" style="display:block;width:210px;max-width:72%;height:auto;border:0;" />
      </td></tr>
      <tr><td style="padding:32px 30px 8px;text-align:center;">
        <h1 class="brik-title" style="margin:0 0 8px;font-size:20px;font-weight:700;color:#15151f;">Accedi a brik</h1>
        <p class="brik-text" style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#4a4a57;">Per entrare nel tuo account, clicca il pulsante qui sotto.<br/>Il link è valido 15 minuti.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px;">
          <tr><td align="center" bgcolor="#5b5bf0" style="border-radius:10px;">
            <a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">Entra in brik</a>
          </td></tr>
        </table>
        <p class="brik-fine" style="margin:0 0 4px;font-size:12px;color:#9aa3b2;">Se il pulsante non funziona, copia e incolla questo indirizzo:</p>
        <p style="margin:0 0 8px;font-size:12px;color:#7b74ff;word-break:break-all;">${esc(link)}</p>
      </td></tr>
      <tr><td class="brik-foot" style="padding:18px 30px 28px;text-align:center;border-top:1px solid #eef0f4;">
        <p class="brik-fine" style="margin:0;font-size:12px;color:#9aa3b2;line-height:1.5;">Se non hai richiesto tu l'accesso, ignora questa email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
      await sendEmail(email, 'brik · link di accesso', html);
      console.log('  → auth: link di accesso inviato a', email);
      return sendJson(res, 200, { ok: true }); // risposta sempre uguale: non rivela se l'email esiste
    }
    if (path === '/api/auth/verify' && method === 'GET') {
      const token = url.searchParams.get('token') || '';
      const email = authStore.consumeLoginToken(token);
      if (!email) { res.writeHead(302, { Location: '/?login=expired' }); res.end(); return; }
      // Aggancia all'account i progetti creati da ospite e conserva
      // l'ultimo progetto per riaprirlo dopo il magic link.
      let claimedProjectIds: string[] = [];
      if (ANON_TRIAL) {
        claimedProjectIds = authStore.takePendingClaim(token);
        for (const pid of claimedProjectIds) {
          if (readOwnerGuest(pid)) writeOwnerEmail(pid, email);
        }
      }
      const sid = authStore.createSession(email, SESSION_TTL_MS);
      metricInc('login');
      const cookies = [buildSessionCookie(sid, { secure: COOKIE_SECURE, maxAgeSec: SESSION_MAXAGE_SEC }), clearGuestCookie()];
      const claimedProjectId = claimedProjectIds.length
        ? claimedProjectIds[claimedProjectIds.length - 1]
        : '';
      const redirectLocation = claimedProjectId
        ? '/?site=' + encodeURIComponent(claimedProjectId)
        : '/';
      res.writeHead(302, { Location: redirectLocation, 'Set-Cookie': cookies });
      res.end();
      return;
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (id) authStore.deleteSession(id);
      res.setHeader('Set-Cookie', clearSessionCookie());
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/auth/me' && method === 'GET') {
      return sendJson(res, 200, { ok: true, authRequired: AUTH_REQUIRED, anonTrial: ANON_TRIAL, user: sessionUserOf(req) });
    }

    if (path === '/api/intake' && method === 'POST') {
      const body = await readJsonBody(req);
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!description) return sendJson(res, 400, { ok: false, error: { code: 'NO_DESCRIPTION', message: 'Descrizione mancante.' } });
      const r = await planIntakeQuestions({ description, llm });
      const v = r.ok ? r.value : { questions: [], recommendedStyle: null };
      return sendJson(res, 200, { ok: true, questions: v.questions, recommendedStyle: v.recommendedStyle });
    }

    // Pizzeria Pack 5: piano domande verticali pizzeria (deterministico, adattivo, pre-create).
    if (path === '/api/pizzeria-intake' && method === 'POST') {
      const body = await readJsonBody(req);
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const startingPoint = normalizeStartingPoint((body as Record<string, unknown>).startingPoint) || undefined;
      const profile = description ? ensurePizzeriaProfile(description) : undefined;
      const plan = planPizzeriaIntake({ description, ...(profile ? { profile } : {}), ...(startingPoint ? { startingPoint } : {}) });
      return sendJson(res, 200, { ok: true, active: plan.active, questions: plan.questions });
    }

    // Allegato -> testo. Riceve { name, mime, dataBase64 } e restituisce il testo estratto.
    // L'estrazione è locale (nessuna chiave). Il testo torna al client, che lo rimanda
    // alla create dentro `sources`: così il body della create resta piccolo.
    if (path === '/api/ingest' && method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req, 22_000_000); // ~16MB di file in base64
      } catch {
        return sendJson(res, 413, { ok: false, error: { code: 'TOO_LARGE', message: 'File troppo grande (max ~16MB).' } });
      }
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const mime = typeof body.mime === 'string' ? body.mime : '';
      const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
      if (!name || !dataBase64) return sendJson(res, 400, { ok: false, error: { code: 'NO_FILE', message: 'File mancante.' } });
      const buf = Buffer.from(dataBase64, 'base64');
      if (buf.length === 0) return sendJson(res, 400, { ok: false, error: { code: 'EMPTY_FILE', message: 'File vuoto o non leggibile.' } });
      if (buf.length > 16 * 1024 * 1024) return sendJson(res, 413, { ok: false, error: { code: 'TOO_LARGE', message: 'File troppo grande (max 16MB).' } });
      try {
        const out = await extractAttachmentText(name, mime, buf);
        if (!out.text) {
          return sendJson(res, 200, { ok: true, name, kind: out.kind, text: '', chars: 0, truncated: false, empty: true });
        }
        console.log('  → ingest:', name, '(' + out.kind + ',', out.chars, 'caratteri' + (out.truncated ? ', troncato' : '') + ')');
        return sendJson(res, 200, { ok: true, name, kind: out.kind, text: out.text, chars: out.chars, truncated: out.truncated, empty: false });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: { code: 'EXTRACT_FAILED', message: String(e instanceof Error ? e.message : e).slice(0, 200) } });
      }
    }

    // Importa contenuti da un sito esistente: testo + URL delle immagini (l'utente sceglie cosa importare).
    if (path === '/api/import' && method === 'POST') {
      const body = await readJsonBody(req);
      let url = typeof body.url === 'string' ? body.url.trim() : '';
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      if (!url || !/^https?:\/\//i.test(url)) return sendJson(res, 400, { ok: false, error: { code: 'BAD_URL', message: 'Indirizzo non valido.' } });
      const f = await fetchUrl(url, 'text/html,application/xhtml+xml');
      if (!f.ok) return sendJson(res, 400, { ok: false, error: { code: 'FETCH_FAILED', message: 'Non riesco a leggere quell\'indirizzo: ' + f.message } });
      const ct = (f.res.headers.get('content-type') || '').toLowerCase();
      if (!/text\/html|application\/xhtml|text\/plain/.test(ct)) {
        return sendJson(res, 400, { ok: false, error: { code: 'NOT_HTML', message: 'L\'indirizzo non è una pagina web (tipo: ' + (ct.split(';')[0] || 'sconosciuto') + ').' } });
      }
      const buf = Buffer.from(await f.res.arrayBuffer());
      const html = buf.subarray(0, 4_000_000).toString('utf8');
      const finalUrl = f.res.url || url;
      let { title, text } = htmlToText(html);
      let images = extractImageUrls(html, finalUrl);
      // Siti renderizzati lato client (Lovable, v0, Framer, Webflow, Wix, React/Next/Vue/Nuxt…):
      // l'HTML statico è un guscio quasi vuoto. Rileviamo lo shell SPA e rendiamo col browser.
      const spa = /\bid=["'](root|app|__next|__nuxt|svelte)["']|__NEXT_DATA__|window\.__NUXT__|data-server-rendered|__remixContext|__sveltekit|data-framer|framerusercontent|data-wf-page|_wixCss|wixsite/i.test(html);
      if (spa || text.trim().length < 600 || images.length < 4) {
        console.log('  → import: ' + (spa ? 'shell SPA rilevato' : 'HTML statico scarso') + ' (' + text.trim().length + ' char, ' + images.length + ' img), renderizzo con browser headless…');
        try {
          const r = await renderPageContent(finalUrl);
          if (r.text.trim().length > text.trim().length) { text = r.text; if (r.title) title = r.title; }
          if (r.images.length > images.length) images = r.images;
          console.log('    render ok (' + r.text.trim().length + ' char, ' + r.images.length + ' img)');
        } catch (e) {
          console.log('    ⚠ render fallito (controlla CHROMIUM_PATH):', String(e instanceof Error ? e.message : e).slice(0, 140));
        }
      }
      const clamped = text.slice(0, 12_000);
      console.log('  → import da', url, '(' + clamped.length + ' caratteri,', images.length, 'immagini)');
      return sendJson(res, 200, { ok: true, url: finalUrl, title, text: clamped, chars: clamped.length, truncated: text.length > clamped.length, images });
    }

    // Proxy byte di una singola immagine (stesso-origine per il ridimensionamento via canvas nel browser).
    if (path === '/api/fetch-image' && method === 'POST') {
      const body = await readJsonBody(req);
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) return sendJson(res, 400, { ok: false, error: { code: 'BAD_URL', message: 'URL non valido.' } });
      const f = await fetchUrl(url, 'image/*');
      if (!f.ok) return sendJson(res, 400, { ok: false, error: { code: 'IMG_FETCH_FAILED', message: f.message } });
      const ct = (f.res.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('image/')) return sendJson(res, 400, { ok: false, error: { code: 'NOT_IMAGE', message: 'Non è un\'immagine.' } });
      const buf = Buffer.from(await f.res.arrayBuffer());
      if (buf.length === 0 || buf.length > 12 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: { code: 'IMG_SIZE', message: 'Immagine vuota o troppo grande.' } });
      return sendJson(res, 200, { ok: true, mime: ct.split(';')[0] || 'image/jpeg', dataBase64: buf.toString('base64') });
    }

    if (path === '/api/images' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return sendJson(res, 400, { ok: false, error: { code: 'NO_QUERY', message: 'Query mancante.' } });
      const images = await searchPexels(q, 12);
      return sendJson(res, 200, { ok: true, images, configured: !!PEXELS_KEY });
    }

    // Webhook Stripe: firmato (raw body), nessuna auth. Attiva/disattiva il sito.
    if (path === '/api/stripe/webhook' && method === 'POST') {
      if (!stripe || !STRIPE_WEBHOOK_SECRET) { res.writeHead(503); res.end('stripe off'); return; }
      let event: Stripe.Event;
      try {
        const raw = await readRawBody(req);
        const sig = (req.headers['stripe-signature'] as string) || '';
        event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
      } catch (e) {
        console.log('  ✗ stripe webhook (firma):', errStr(e));
        res.writeHead(400); res.end('bad signature'); return;
      }
      try {
        if (event.type === 'checkout.session.completed') {
          const cs = event.data.object as Stripe.Checkout.Session;
          const _amt = typeof cs.amount_total === 'number' ? cs.amount_total / 100 : undefined;
          const _em = (cs.customer_details && cs.customer_details.email) || cs.customer_email || '';
          void sendMetaCapi('Purchase', { ...(_amt != null ? { value: _amt } : {}), currency: (cs.currency || 'eur').toUpperCase(), eventId: 'purchase_' + cs.id, ...(_em ? { email: _em } : {}) });
          console.log('  ✓ stripe: checkout completato ->', _em || '(email mancante)');
        } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
          const sub = event.data.object as Stripe.Subscription;
          const email = (sub.metadata && sub.metadata.email) || '';
          const priceId = sub.items?.data?.[0]?.price?.id || '';
          if (email) {
            const max = maxPublishedForSubscription({ eventType: event.type, status: sub.status, priceId, priceToMax: PRICE_TO_MAX });
            const customerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id || undefined);
            setAccountSubscription(email, { maxPublished: max, subscriptionId: sub.id, ...(customerId ? { customerId } : {}), ...(priceId ? { priceId } : {}) });
            console.log('  -> stripe sub:', event.type, sub.status, priceId, '-> max', max, email);
          } else {
            console.log('  ! stripe sub senza email in metadata:', event.type, sub.id);
          }
        } else if (event.type === 'invoice.payment_failed') {
          console.log('  ⚠ stripe: rinnovo fallito (Stripe riproverà)');
        }
      } catch (e) {
        console.log('  ✗ stripe webhook (handler):', errStr(e));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"received":true}');
      return;
    }

    if (path === '/api/projects' && method === 'POST') {
      const body = await readJsonBody(req, 24_000_000); // può includere foto (base64) ridimensionate dal browser
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!description) return sendJson(res, 400, { ok: false, error: { code: 'NO_DESCRIPTION', message: 'Descrizione mancante.' } });
      { const blk = sessionUserOf(req); if (blk && isBlockedEmail(blk.email)) return sendJson(res, 403, { ok: false, error: { code: 'ACCOUNT_BLOCKED', message: 'Account sospeso. Scrivi al supporto se pensi sia un errore.' } }); }
      const creator = AUTH_REQUIRED ? sessionUserOf(req) : null;
      let guestId: string | null = null;
      if (AUTH_REQUIRED && !creator) {
        if (!ANON_TRIAL) return sendJson(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Accesso richiesto.' } });
        // ospite: 1 generazione, poi login
        guestId = guestIdOf(req);
        const g = guestId ? authStore.getGuest(guestId) : null;
        // Invitato (link gratis valido): niente tetto di 1 sito per ospite — può costruirne più d'uno.
        const invTok = typeof body.invite === 'string' ? body.invite.trim() : '';
        const invitedFree = invTok ? inviteValid(readInvites()[invTok]) : false;
        if (g && g.genCount >= 1 && !invitedFree) return sendJson(res, 401, { ok: false, error: { code: 'NEEDS_AUTH', message: 'Accedi per creare un altro sito.' } });
        if (!anonGenAllowed(req)) return sendJson(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'Troppe creazioni da questo dispositivo. Riprova più tardi o accedi.' } });
        if (!guestId) { guestId = authStore.createGuest(); res.setHeader('Set-Cookie', buildGuestCookie(guestId, { secure: COOKIE_SECURE, maxAgeSec: GUEST_MAXAGE_SEC })); }
      }
      const rawAnswers = Array.isArray(body.answers) ? body.answers : [];
      const extra = rawAnswers
        .map((a) => (a && typeof a === 'object' ? { q: String((a as Record<string, unknown>).question ?? '').trim(), a: String((a as Record<string, unknown>).answer ?? '').trim() } : null))
        .filter((x): x is { q: string; a: string } => !!x && x.a.length > 0);
      const fullDescription = extra.length
        ? description + '\n\nPrecisazioni:\n' + extra.map((x) => '- ' + x.q + ' ' + x.a).join('\n')
        : description;
      // Materiale reale dagli allegati (testo già estratto via /api/ingest).
      const rawSources = Array.isArray(body.sources) ? body.sources : [];
      const sources = rawSources
        .map((s) => (s && typeof s === 'object' ? { name: String((s as Record<string, unknown>).name ?? '').trim(), text: String((s as Record<string, unknown>).text ?? '').trim() } : null))
        .filter((x): x is { name: string; text: string } => !!x && x.text.length > 0);
      const content = sources.length
        ? sources.map((s) => '### ' + (s.name || 'documento') + '\n' + s.text).join('\n\n').slice(0, 24_000).trim()
        : '';
      const id = newId();
      // Foto reali caricate: salvate su disco; il generatore le riceve come user:ID.
      const photos = assetStore.saveImages(id, parseUploadedImages(body));
      const buildGenerator = generatorWith(photos);
      const tags = [content ? sources.length + ' allegato/i di testo' : '', photos.length ? photos.length + ' foto' : ''].filter(Boolean).join(' + ');
      console.log('  → create (async, preview-first): plan + genera la home → preview appena renderizzabile; QA/fix e pagine interne dopo, in background' + (tags ? ' (' + tags + ')' : ''));
      // Proprieta scritta SUBITO: durante il polling il GET deve gia riconoscere il proprietario.
      if (creator) writeOwnerEmail(id, creator.email);
      else if (guestId) writeOwnerGuest(id, guestId);
      writeGenJob(id, { status: 'generating', startedAt: Date.now() });
      // Pizzeria Pack: se la descrizione è chiaramente una pizzeria, estrai e salva il profilo dati
      // (opzionale, best-effort: non blocca la creazione e non tocca la generazione).
      try { const _pp = extractPizzeriaBusinessProfile(fullDescription); if (_pp) writeBusinessProfile(id, { kind: 'pizzeria', data: _pp }); } catch (e) { /* profilo best-effort */ }
      // Pizzeria Pack 4: salva lo Starting Point Intake (opzionale, backward-compatible) e, se arriva
      // un Google Maps certo su una pizzeria, valorizza il profilo. Best-effort: non blocca la creazione.
      try {
        const _sp = normalizeStartingPoint((body as Record<string, unknown>).startingPoint);
        if (_sp) {
          writeStartingPoint(id, _sp);
          const _bpNow = readBusinessProfile(id);
          if (_bpNow && _bpNow.kind === 'pizzeria') {
            const _m = mergeStartingPointIntoProfile(_sp, _bpNow.data);
            if (_m.changed && _m.profile) writeBusinessProfile(id, { kind: 'pizzeria', data: _m.profile });
          }
        }
      } catch (e) { /* starting point best-effort */ }
      // Pizzeria Pack 5: applica le risposte dell'intake verticale al profilo (best-effort).
      try {
        const _pa = (body as Record<string, unknown>).pizzeriaAnswers;
        if (_pa && typeof _pa === 'object') {
          const _bp2 = readBusinessProfile(id);
          const _base = _bp2 && _bp2.kind === 'pizzeria' ? _bp2.data : ensurePizzeriaProfile(fullDescription);
          if (_base) {
            const _r = applyPizzeriaIntakeAnswers(_base, _pa as PizzeriaIntakeAnswers);
            if (_r.changed || !_bp2) writeBusinessProfile(id, { kind: 'pizzeria', data: _r.profile });
          }
        }
      } catch (e) { /* intake verticale best-effort */ }
      // Pizzeria Pack 6B: note del genome dal profilo persistito (vuoto se non pizzeria), unite alle creativeNotes.
      const _bp = readBusinessProfile(id);
      const _genomeNotes = pizzeriaCreativeNotes(_bp);
      // Theme: la scelta esplicita dell'utente prevale SEMPRE; in sua assenza, fallback dal pizzeriaType (genome).
      const _userTheme = (typeof body.theme === 'string' && isTheme(body.theme)) ? body.theme : undefined;
      const _genomeTheme = pizzeriaRecommendedTheme(_bp);
      const _effTheme = _userTheme || _genomeTheme;
      // Prova: parte dalla creazione (TRIAL_DAYS). Operatori e account gratis ne sono esenti.
      const _meCreate = sessionUserOf(req);
      const _trialDaysCreate = (_meCreate?.isOperator || isFreeEmail(_meCreate?.email)) ? 0 : TRIAL_DAYS;
      const createOpts = { store, id, ownerId: 'web', description: fullDescription, llm, classifier, generator: buildGenerator, runQa, maxRepairs: 1, review: DIRECTOR_REVIEW, reviewMinScore: DIRECTOR_MIN_SCORE, ...(_trialDaysCreate > 0 ? { trialDays: _trialDaysCreate } : {}), ...(content ? { content } : {}), ...(_effTheme ? { theme: _effTheme } : {}), ...(typeof body.saasVisual === 'string' ? { saasVisual: body.saasVisual } : {}), ...(body.variant === 'dark' || body.variant === 'light' ? { variant: body.variant } : {}), ...(_genomeNotes.length ? { extraCreativeNotes: _genomeNotes } : {}) };
      const jobGuestId = guestId;
      appendChat(id, 'user', fullDescription);
      // La build gira in background: nessuna connessione HTTP tenuta aperta 3-4 min (era la causa dei "siti persi").
      void (async () => {
        const t0 = Date.now();
        try {
          const r = await withTimeout(
            withGenRetry('create', 3, () => createHome(createOpts)),
            540_000,
            'La build ha superato il tempo massimo ed e stata interrotta.',
          );
          if (!r.ok) {
            console.log('  ✗ create:', r.error.code, r.error.message);
            writeGenJob(id, { status: 'error', error: r.error, startedAt: t0, finishedAt: Date.now() });
            try { rmSync(join(ownersDir, id + '.json'), { force: true }); } catch {}
            return;
          }
          console.log('  ✓ home preview ready in', ((Date.now() - t0) / 1000).toFixed(1), 's — QA', r.value.report.buildSucceeded ? 'verde' : 'rossa');
          metricInc('created');
          try { const pj = await getProject(store, id); if (pj.ok && pj.value && pj.value.spec) catInc(String(pj.value.spec.category || '')); } catch { /* categoria best-effort */ }
          if (jobGuestId) {
            const g = authStore.getGuest(jobGuestId) || { createdAt: new Date().toISOString(), projectIds: [], genCount: 0 };
            g.projectIds.push(id);
            g.genCount += 1;
            authStore.saveGuest(jobGuestId, g);
          }
          clearGenJob(id); // home su disco: il polling restituisce subito la home (le interne restano placeholder)
          // BACKGROUND (non blocca la preview): 1) rifinitura home QA+fix con timeout; 2) pagine interne.
          const completion = r.value.completion;
          void (async () => {
            try {
              await refineHome({ store, id, generator: buildGenerator, runQa, spec: completion.spec, fixTimeoutMs: 25_000, maxFix: 2, ...(completion.theme ? { theme: completion.theme } : {}), ...(completion.creativeNotes.length ? { creativeNotes: completion.creativeNotes } : {}), ...(completion.saasVisual ? { saasVisual: completion.saasVisual } : {}), ...(completion.variant ? { variant: completion.variant } : {}) });
            } catch (e) { console.log('  ✗ refine_home (eccezione):', errStr(e)); }
            if (completion && completion.interiorRoutes.length) {
              try {
                const rc = await withTimeout(
                  completePages({ store, id, generator: buildGenerator, runQa, completion }),
                  300_000,
                  'Il completamento delle pagine interne ha superato il tempo massimo.',
                );
                if (!rc.ok) console.log('  ✗ complete_pages:', rc.error.code, rc.error.message);
              } catch (e) { console.log('  ✗ complete_pages (eccezione):', errStr(e)); }
            }
          })();
        } catch (e) {
          console.log('  ✗ create (eccezione):', errStr(e));
          writeGenJob(id, { status: 'error', error: { code: 'CREATE_FAILED', message: errStr(e) }, startedAt: t0, finishedAt: Date.now() });
          try { rmSync(join(ownersDir, id + '.json'), { force: true }); } catch {}
        }
      })();
      return sendJson(res, 202, { ok: true, id, gen: 'generating' });
    }

    const apiMatch = path.match(/^\/api\/projects\/([^/]+)(?:\/(edit|edit-clarify|approve|publish|publish-status|revert|page|theme|email|delete|concierge|unlock|lock|checkout|domain))?$/);
    if (apiMatch) {
      const id = decodeURIComponent(apiMatch[1] as string);
      const action = apiMatch[2];
      if (action === 'edit' || action === 'edit-clarify') {
        const blk = sessionUserOf(req);
        if (blk && isBlockedEmail(blk.email)) return sendJson(res, 403, { ok: false, error: { code: 'ACCOUNT_BLOCKED', message: 'Account sospeso. Scrivi al supporto se pensi sia un errore.' } });
      }
      if (AUTH_REQUIRED && action !== 'unlock' && action !== 'lock') {
        const me2 = sessionUserOf(req);
        if (me2) {
          if (!me2.isOperator && (readOwnerEmail(id) || '').toLowerCase() !== me2.email) {
            return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Non è il tuo sito.' } });
          }
        } else if (ANON_TRIAL) {
          // ospite: può vedere e fare 1 modifica sul PROPRIO progetto; pubblicare e oltre → login
          const gid = guestIdOf(req);
          if (!gid || readOwnerGuest(id) !== gid) {
            return sendJson(res, 401, { ok: false, error: { code: 'NEEDS_AUTH', message: 'Accedi per continuare.' } });
          }
          const guestOk = !action || action === 'edit' || action === 'edit-clarify';
          if (!guestOk) return sendJson(res, 401, { ok: false, error: { code: 'NEEDS_AUTH', message: 'Accedi per pubblicare o continuare.' } });
          if (action === 'edit') {
            const pr = await getProject(store, id);
            const used = pr.ok && pr.value ? (pr.value.editCount ?? 0) : 0;
            if (used >= 1) return sendJson(res, 401, { ok: false, error: { code: 'NEEDS_AUTH', message: 'Hai usato la modifica di prova. Accedi per continuare — il tuo sito resta salvato.' } });
          }
        } else {
          return sendJson(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Accesso richiesto.' } });
        }
      }

      if (!action && method === 'GET') {
        // Polling della build asincrona: se c'e un job in corso, riporta lo stato.
        const job = readGenJob(id);
        if (job && job.status === 'generating') {
          if (existsSync(join(dataDir, id + '.json'))) clearGenJob(id); // auto-heal: il sito e gia su disco
          else return sendJson(res, 200, { ok: true, gen: 'generating', id });
        } else if (job && job.status === 'error') {
          return sendJson(res, 200, { ok: true, gen: 'error', id, error: job.error || { code: 'CREATE_FAILED', message: 'Generazione fallita.' } });
        }
        const r = await getProject(store, id);
        if (!r.ok) return sendJson(res, 400, { ok: false, error: r.error });
        if (!r.value) return sendJson(res, 404, { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Progetto non trovato.' } });
        return sendJson(res, 200, { ok: true, gen: 'ready', email: readOwnerEmail(id) || '', legal: readLegal(id), ...withSummary(r.value) });
      }

      // Elimina definitivamente il progetto (file del sito + email di recapito).
      if (action === 'delete' && method === 'POST') {
        try { rmSync(join(dataDir, id + '.json'), { force: true }); } catch {}
        try { rmSync(join(dataDir, id + '.json.tmp'), { force: true }); } catch {}
        try { rmSync(join(ownersDir, id + '.json'), { force: true }); } catch {}
        try { rmSync(join(assetsDir, id), { recursive: true, force: true }); } catch {}
        console.log('  → delete progetto', id);
        return sendJson(res, 200, { ok: true, deleted: true });
      }

      // Riattivazione (sblocco): riservata. Pre-Stripe la invoca l'operatore con ADMIN_TOKEN;
      // a regime la chiamerà il webhook di pagamento. Segna entitled + ripubblica le pagine reali.
      if (action === 'unlock' && method === 'POST') {
        const body = await readJsonBody(req);
        const token = (typeof body.token === 'string' && body.token) || ((req.headers['x-admin-token'] as string) ?? '');
        if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Operazione riservata.' } });
        const pr = await getProject(store, id);
        if (!pr.ok || !pr.value) return sendJson(res, 404, { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Progetto non trovato.' } });
        const host = deliveryHostFor(pr.value);
        const r = await withTimeout(
          unlockProject({ store, id, host, materialize: (pages) => assetStore.materialize(pages, id) }),
          300_000,
          'La riattivazione ha superato il tempo massimo.',
        );
        if (!r.ok) return sendJson(res, 400, { ok: false, error: r.error });
        console.log('  ▶ unlock (riattivato):', id);
        return sendJson(res, 200, { ok: true, ...withSummary(r.value) });
      }

      // Pausa manuale (riservata): utile per test; lo sweep fa lo stesso automaticamente.
      if (action === 'lock' && method === 'POST') {
        const body = await readJsonBody(req);
        const token = (typeof body.token === 'string' && body.token) || ((req.headers['x-admin-token'] as string) ?? '');
        const _meLock = sessionUserOf(req);
        const _lockAuthOk = (ADMIN_TOKEN && token === ADMIN_TOKEN) || (_meLock && _meLock.isOperator);
        if (!_lockAuthOk) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Operazione riservata.' } });
        const pr = await getProject(store, id);
        if (!pr.ok || !pr.value) return sendJson(res, 404, { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Progetto non trovato.' } });
        const _onCfLock = pr.value.status === 'published';
        const r = await withTimeout(
          lockProject({ store, id, ...(_onCfLock ? { host: makeCloudflarePagesHost({ projectName: projectNameOf(pr.value) }) } : {}), placeholderPages: _onCfLock ? pausedPages(pr.value) : [] }),
          300_000,
          'La pausa ha superato il tempo massimo.',
        );
        if (!r.ok) return sendJson(res, 400, { ok: false, error: r.error });
        console.log('  ⏸ lock (manuale):', id);
        return sendJson(res, 200, { ok: true, ...withSummary(r.value) });
      }

      // Dominio personalizzato self-service (solo CNAME/sottodominio; l'apex resta concierge).
      if (action === 'domain') {
        if (!CF_READY) return sendJson(res, 503, { ok: false, error: { code: 'HOSTING_OFF', message: 'Hosting non configurato.' } });
        const pr = await getProject(store, id);
        if (!pr.ok || !pr.value) return sendJson(res, 404, { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Progetto non trovato.' } });
        const meDom = sessionUserOf(req);
        const ownerDom = (readOwnerEmail(id) || '').toLowerCase();
        if (!meDom || (!meDom.isOperator && ownerDom && ownerDom !== (meDom.email || '').toLowerCase())) {
          return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Accedi con l\'account proprietario del sito.' } });
        }
        const proj = projectNameOf(pr.value);
        const cnameValue = proj + '.pages.dev';
        const cnameOf = (d: string) => ({ type: 'CNAME', name: d.split('.')[0], value: cnameValue });

        if (method === 'GET') {
          const dom = pr.value.customDomain;
          if (!dom) return sendJson(res, 200, { ok: true, domain: null });
          const st = await cfGetDomain(proj, dom);
          return sendJson(res, 200, { ok: true, domain: dom, cname: cnameOf(dom), status: st.status || 'pending' });
        }

        if (method === 'POST') {
          if (pr.value.status !== 'published') return sendJson(res, 400, { ok: false, error: { code: 'NOT_PUBLISHED', message: 'Pubblica prima il sito, poi collega il dominio.' } });
          const body = await readJsonBody(req);
          let domain = (typeof body.domain === 'string' ? body.domain : '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
          if (!domain || !CF_DOMAIN_RE.test(domain)) return sendJson(res, 400, { ok: false, error: { code: 'BAD_DOMAIN', message: 'Inserisci un dominio valido, es. www.tuonome.it' } });
          if (looksLikeApex(domain)) return sendJson(res, 400, { ok: false, error: { code: 'APEX', message: 'Il dominio senza www va configurato dal concierge. Qui collega www.' + domain + '.' } });
          const add = await cfAddDomain(proj, domain);
          if (!add.ok) return sendJson(res, 400, { ok: false, error: { code: 'CF_REJECTED', message: add.message || 'Cloudflare ha rifiutato il dominio.' } });
          await setCustomDomain(id, domain);
          console.log('  🌐 dominio collegato:', domain, '→', cnameValue);
          return sendJson(res, 200, { ok: true, domain, cname: cnameOf(domain), status: add.status || 'pending' });
        }

        if (method === 'DELETE') {
          const dom = pr.value.customDomain;
          if (dom) await cfDeleteDomain(proj, dom);
          await setCustomDomain(id, null);
          console.log('  🌐 dominio scollegato:', dom || '(nessuno)');
          return sendJson(res, 200, { ok: true, domain: null });
        }
      }

      // Avvia il pagamento (Stripe Checkout): abbonamento per-account, 19€/mese -> 3 siti.
      if (action === 'checkout' && method === 'POST') {
        if (!stripe || !STRIPE_READY) return sendJson(res, 503, { ok: false, error: { code: 'STRIPE_OFF', message: 'Pagamenti non configurati.' } });
        const ownerEmail = readOwnerEmail(id) || sessionUserOf(req)?.email || '';
        if (!ownerEmail) return sendJson(res, 400, { ok: false, error: { code: 'NO_ACCOUNT_EMAIL', message: 'Email account non trovata.' } });
        try {
          const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: STRIPE_PRICE_BASE, quantity: 1 }],
            subscription_data: { metadata: { email: ownerEmail } },
            client_reference_id: id,
            allow_promotion_codes: true,
            success_url: APP_URL + '/?paid=1&site=' + encodeURIComponent(id),
            cancel_url: APP_URL + '/?paid=0&site=' + encodeURIComponent(id),
            customer_email: ownerEmail,
          });
          return sendJson(res, 200, { ok: true, url: session.url });
        } catch (e) {
          console.log('  ✗ stripe checkout', id, errStr(e));
          return sendJson(res, 400, { ok: false, error: { code: 'STRIPE_ERROR', message: errStr(e) } });
        }
      }

      // Upgrade self-service: porta la subscription esistente al tier superiore (prorata Stripe).
      if (action === 'upgrade' && method === 'POST') {
        if (!stripe || !STRIPE_READY) return sendJson(res, 503, { ok: false, error: { code: 'STRIPE_OFF', message: 'Pagamenti non configurati.' } });
        const ownerEmail = readOwnerEmail(id) || sessionUserOf(req)?.email || '';
        if (!ownerEmail) return sendJson(res, 400, { ok: false, error: { code: 'NO_ACCOUNT_EMAIL', message: 'Email account non trovata.' } });
        const plan = getAccountPlan(ownerEmail);
        if (plan.maxPublished <= 0) return sendJson(res, 400, { ok: false, error: { code: 'NO_ACTIVE_PLAN', message: 'Nessun piano attivo: attiva un piano prima di fare upgrade.' } });
        const nt = nextTier(plan.maxPublished, TIER_LADDER);
        if (!nt) return sendJson(res, 409, { ok: false, error: { code: 'ALREADY_TOP_TIER', message: 'Sei già al piano massimo.' } });
        try {
          // recupera la subscription: dal file account, con fallback al lookup Stripe per email.
          let subId = plan.subscriptionId || '';
          if (!subId) {
            const custs = await stripe.customers.list({ email: ownerEmail, limit: 1 });
            const cust = custs.data[0];
            if (cust) {
              const subs = await stripe.subscriptions.list({ customer: cust.id, status: 'active', limit: 1 });
              subId = subs.data[0]?.id || '';
            }
          }
          if (!subId) return sendJson(res, 404, { ok: false, error: { code: 'NO_SUBSCRIPTION', message: 'Abbonamento non trovato.' } });
          const sub = await stripe.subscriptions.retrieve(subId);
          const itemId = sub.items?.data?.[0]?.id;
          if (!itemId) return sendJson(res, 500, { ok: false, error: { code: 'NO_SUB_ITEM', message: 'Voce abbonamento non trovata.' } });
          await stripe.subscriptions.update(subId, {
            items: [{ id: itemId, price: nt.price }],
            proration_behavior: 'create_prorations',
          });
          // Update ottimistico idempotente: il webhook customer.subscription.updated confermerà.
          setAccountSubscription(ownerEmail, { maxPublished: nt.max, subscriptionId: subId, priceId: nt.price });
          console.log('  -> stripe upgrade:', ownerEmail, '-> max', nt.max, subId);
          return sendJson(res, 200, { ok: true, nextMax: nt.max });
        } catch (e) {
          console.log('  ✗ stripe upgrade', id, errStr(e));
          return sendJson(res, 400, { ok: false, error: { code: 'STRIPE_ERROR', message: errStr(e) } });
        }
      }

      // Richiesta di un dominio ufficiale (concierge): salva + avvisa l'operatore.
      if (action === 'concierge' && method === 'POST') {
        const body = await readJsonBody(req);
        const desiredDomain = typeof body.desiredDomain === 'string' ? body.desiredDomain.trim() : '';
        const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '';
        const contactName = typeof body.contactName === 'string' ? body.contactName.trim() : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        const note = typeof body.note === 'string' ? body.note.trim() : '';
        if (!desiredDomain) return sendJson(res, 400, { ok: false, error: { code: 'NO_DOMAIN', message: 'Indica il dominio desiderato.' } });
        if (!contactEmail || !EMAIL_RE.test(contactEmail)) return sendJson(res, 400, { ok: false, error: { code: 'BAD_EMAIL', message: 'Email di contatto non valida.' } });

        const pr = await getProject(store, id);
        const siteUrl = pr.ok && pr.value ? (pr.value.url || '') : '';
        const siteTitle = pr.ok && pr.value ? pr.value.spec.title : id;
        const record = { id, siteTitle, siteUrl, desiredDomain, contactEmail, contactName, phone, note, at: new Date().toISOString() };
        try { mkdirSync(conciergeDir, { recursive: true }); writeFileSync(join(conciergeDir, Date.now() + '-' + id + '.json'), JSON.stringify(record, null, 2), 'utf8'); } catch {}

        const html = '<h2>Richiesta dominio ufficiale</h2>' +
          '<p><strong>Dominio desiderato:</strong> ' + esc(desiredDomain) + '</p>' +
          '<p><strong>Sito:</strong> ' + esc(siteTitle) + (siteUrl ? ' — <a href="' + esc(siteUrl) + '">' + esc(siteUrl) + '</a>' : ' (non ancora pubblicato)') + '</p>' +
          '<p><strong>Progetto:</strong> ' + esc(id) + '</p>' +
          '<p><strong>Contatto:</strong> ' + esc(contactName || '—') + ' · ' + esc(contactEmail) + (phone ? ' · ' + esc(phone) : '') + '</p>' +
          (note ? '<p><strong>Note:</strong> ' + esc(note) + '</p>' : '');
        const conciergeRecips = Array.from(new Set([CONCIERGE_EMAIL, ...OPERATORS, ...readStaffSet()].map((e) => (e || '').toLowerCase()).filter(Boolean)));
        const notified = await sendEmail(conciergeRecips, 'brik · richiesta dominio: ' + desiredDomain, html);
        console.log('  → concierge: dominio', desiredDomain, '— operatore avvisato:', notified ? 'sì' : 'no');
        return sendJson(res, 200, { ok: true, notified });
      }

      // Email di recapito del modulo (impostazioni del sito; stringa vuota = nessun recapito).
      if (action === 'email' && method === 'POST') {
        const body = await readJsonBody(req);
        const em = typeof body.email === 'string' ? body.email.trim() : '';
        if (em && !EMAIL_RE.test(em)) return sendJson(res, 400, { ok: false, error: { code: 'BAD_EMAIL', message: 'Email non valida.' } });
        writeOwnerEmail(id, em);
        return sendJson(res, 200, { ok: true, email: em });
      }

      // Dati legali del titolare (footer + pagine privacy/cookie). Tutti opzionali.
      if (action === 'legal' && method === 'POST') {
        const body = await readJsonBody(req);
        const s = (x: unknown) => (typeof x === 'string' ? x.trim().slice(0, 200) : '');
        const b = (x: unknown) => x === true || x === 'true' || x === 1 || x === '1';
        const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});
        const CM = ['technical-only', 'basic-analytics', 'full-analytics', 'marketing-pixel', 'unknown'];
        const cm = typeof body.cookieMode === 'string' && CM.includes(body.cookieMode) ? (body.cookieMode as CookieMode) : undefined;
        const po = obj(body.purposes), cd = obj(body.collectedData), tp = obj(body.thirdPartyServices);
        const purposes: LegalPurposes = {};
        (['businessInfo', 'contactRequests', 'reservations', 'whatsapp', 'newsletter', 'analytics', 'marketing'] as const).forEach((k) => { if (b(po[k])) purposes[k] = true; });
        const collectedData: LegalCollectedData = {};
        (['name', 'email', 'phone', 'message', 'reservationPreference'] as const).forEach((k) => { if (b(cd[k])) collectedData[k] = true; });
        const other = s(cd.other); if (other) collectedData.other = other;
        const thirdPartyServices: LegalThirdPartyServices = {};
        (['cloudflareHosting', 'emailProvider', 'googleMaps', 'youtubeVimeo', 'metaPixel', 'googleAds', 'whatsapp', 'instagramFacebookLinks', 'analytics'] as const).forEach((k) => { if (b(tp[k])) thirdPartyServices[k] = true; });
        const legal: LegalData = {
          legalName: s(body.legalName), vat: s(body.vat), address: s(body.address),
          ownerName: s(body.ownerName), privacyEmail: s(body.privacyEmail), phone: s(body.phone),
          ...(Object.keys(purposes).length ? { purposes } : {}),
          ...(Object.keys(collectedData).length ? { collectedData } : {}),
          ...(Object.keys(thirdPartyServices).length ? { thirdPartyServices } : {}),
          ...(cm ? { cookieMode: cm } : {}),
        };
        writeLegal(id, legal);
        return sendJson(res, 200, { ok: true, legal, warnings: validateLegalProfile(legalDataToProfile(legal)) });
      }

      // Attiva/disattiva "gratis" (entitled) — riservato agli operatori (pannello Attività).
      if (action === 'entitle' && method === 'POST') {
        const me2 = sessionUserOf(req);
        if (!me2 || !me2.isOperator) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Solo operatori.' } });
        const body = await readJsonBody(req);
        const value = body.value === true || body.value === 1 || body.value === '1';
        if (value) await grantEntitlement(id); else await revokeEntitlement(id);
        const pr = await getProject(store, id);
        return sendJson(res, 200, { ok: true, entitled: value, status: pr.ok && pr.value ? pr.value.status : undefined });
      }

      // Pre-modifica: l'istruzione e chiara o servono chiarimenti? (modello veloce, best-effort)
      if (action === 'edit-clarify' && method === 'POST') {
        const body = await readJsonBody(req);
        const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
        if (!instruction) return sendJson(res, 200, { ok: true, questions: [] });
        const pr = await getProject(store, id);
        if (!pr.ok || !pr.value) return sendJson(res, 200, { ok: true, questions: [] });
        const routes = pr.value.routes.map((r) => ({ route: r.route, label: r.label }));
        const qr = await planEditClarification({ instruction, spec: pr.value.spec, routes, llm });
        return sendJson(res, 200, { ok: true, questions: qr.ok ? qr.value : [] });
      }

      if (action === 'edit' && method === 'POST') {
        const body = await readJsonBody(req, 24_000_000); // può includere foto (base64) ridimensionate dal browser
        const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
        if (!instruction) return sendJson(res, 400, { ok: false, error: { code: 'NO_INSTRUCTION', message: 'Istruzione mancante.' } });
        // Pizzeria Pack 3B: edit deterministico di menu/orari dal profilo (nessun LLM se gestito).
        {
          const _bpEdit = readBusinessProfile(id);
          if (_bpEdit && _bpEdit.kind === 'pizzeria') {
            const _pe = applyPizzeriaProfileEdit(_bpEdit.data, instruction);
            if (_pe.handled) {
              if (_pe.profile) writeBusinessProfile(id, { kind: 'pizzeria', data: _pe.profile });
              const _pj = await getProject(store, id);
              const _summary = _pj.ok && _pj.value ? withSummary(_pj.value) : {};
              return sendJson(res, 200, { ok: true, accepted: !!_pe.profile, conflicts: [], changes: _pe.message ? [_pe.message] : [], message: _pe.message || '', ..._summary });
            }
          }
        }
        const rawSources = Array.isArray(body.sources) ? body.sources : [];
        const sources = rawSources
          .map((s) => (s && typeof s === 'object' ? { name: String((s as Record<string, unknown>).name ?? '').trim(), text: String((s as Record<string, unknown>).text ?? '').trim() } : null))
          .filter((x): x is { name: string; text: string } => !!x && x.text.length > 0);
        const content = sources.length
          ? sources.map((s) => '### ' + (s.name || 'documento') + '\n' + s.text).join('\n\n').slice(0, 24_000).trim()
          : '';
        // Foto nuove: accodate alle esistenti, e marcate come NUOVE per il "sostituisci con questa".
        const newImgs = parseUploadedImages(body);
        const photosBefore = assetStore.listPhotos(id).length;
        if (newImgs.length) assetStore.saveImages(id, newImgs);
        const allPhotos = assetStore.listPhotos(id);
        const newCount = Math.max(0, allPhotos.length - photosBefore);
        const photos = allPhotos.map((p, i) => (newCount > 0 && i >= allPhotos.length - newCount ? { ...p, isNew: true } : p));
        const buildGenerator = generatorWith(photos);
        console.log('  → edit:', instruction + (content ? ' (+testo)' : '') + (newCount ? ' (+' + newCount + ' foto)' : ''));
        appendChat(id, 'user', instruction);
        const t0 = Date.now();
        const r = await withTimeout(
          withGenRetry('edit', 3, () => editProject({ store, id, instruction, llm, generator: buildGenerator, runQa, editCap: EDIT_CAP, ...(content ? { content } : {}) })),
          540_000,
          'La modifica ha superato il tempo massimo ed e stata interrotta.',
        );
        if (!r.ok) {
          console.log('  ✗ edit:', r.error.code, r.error.message);
          appendChat(id, 'assistant', '⚠️ Errore: ' + r.error.message);
          return sendJson(res, 400, { ok: false, error: r.error });
        }
        console.log('  ✓ edit in', ((Date.now() - t0) / 1000).toFixed(1), 's —', r.value.accepted ? 'applicata' : 'rifiutata');
        if (r.value.accepted) {
          metricInc('edited');
          appendChat(id, 'assistant', 'Modifica applicata' + (r.value.changes && r.value.changes.length ? ': ' + r.value.changes.join('; ') : '.'));
        } else { const who = readOwnerEmail(id) || sessionUserOf(req)?.email || ''; addFeedback({ kind: 'modifica-non-applicata', text: instruction, projectId: id, ...(who ? { email: who } : {}) }); appendChat(id, 'assistant', 'Non sono riuscito ad applicare la modifica' + (r.value.conflicts && r.value.conflicts.length ? ': ' + r.value.conflicts.join('; ') : '.')); }
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

      // Modifica diretta del testo di una pagina (nessun LLM, nessuna QA: il
      // proprietario edita i propri contenuti; il gate di sicurezza resta in pubblicazione).
      if (action === 'page' && method === 'POST') {
        const body = await readJsonBody(req);
        const route = typeof body.route === 'string' ? body.route : '';
        let html = typeof body.html === 'string' ? body.html : '';
        if (!route || !html) return sendJson(res, 400, { ok: false, error: { code: 'BAD_PAGE', message: 'route o html mancante.' } });
        const f = await store.load(id);
        if (!f.ok) return sendJson(res, 400, { ok: false, error: f.error });
        if (!f.value) return sendJson(res, 404, { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Progetto non trovato.' } });
        const cur = f.value.state;
        const idx = cur.pages.findIndex((p) => p.route === route);
        if (idx === -1) return sendJson(res, 404, { ok: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Pagina non trovata.' } });
        html = stripPreviewPrefix(html, id);
        const pages = cur.pages.map((p, i) => (i === idx ? { route: p.route, html } : p));
        const state: SiteState = { ...cur, pages, status: 'preview', version: cur.version + 1, updatedAt: new Date().toISOString() };
        const saved = await store.save({ ...f.value, state });
        if (!saved.ok) return sendJson(res, 400, { ok: false, error: saved.error });
        return sendJson(res, 200, { ok: true, ...withSummary(state) });
      }

      // Cambio stile (tema) e/o colore accento, istantaneo: scambio del CSS iniettato.
      if (action === 'theme' && method === 'POST') {
        const body = await readJsonBody(req);
        const theme = typeof body.theme === 'string' ? body.theme : '';
        const accentRaw = typeof body.accent === 'string' ? body.accent.trim() : '';
        const acc = ACCENT_RE.test(accentRaw) ? accentRaw : null;
        const f = await store.load(id);
        if (!f.ok) return sendJson(res, 400, { ok: false, error: f.error });
        if (!f.value) return sendJson(res, 404, { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Progetto non trovato.' } });
        const cur = f.value.state;
        let pages: { route: string; html: string }[] = cur.pages.map((p) => ({ route: p.route, html: p.html }));
        if (theme && isTheme(theme)) {
          const bare = deInjectDesignSystem(pages.map((p) => ({ route: p.route, html: setAccent(p.html, null) })));
          pages = injectDesignSystem(bare, theme).map((p) => ({ route: p.route, html: p.html }));
        }
        pages = pages.map((p) => ({ route: p.route, html: setAccent(p.html, acc) }));
        const state: SiteState = { ...cur, pages, status: 'preview', version: cur.version + 1, updatedAt: new Date().toISOString() };
        const saved = await store.save({ ...f.value, state });
        if (!saved.ok) return sendJson(res, 400, { ok: false, error: saved.error });
        return sendJson(res, 200, { ok: true, theme: themeOfPages(pages), ...withSummary(state) });
      }

      if (action === 'publish-status' && method === 'GET') {
        // Check di raggiungibilita del sito pubblicato, fatto dal SERVER perche il browser non
        // puo farlo (CORS opaco su *.pages.dev). Il modal post-publish lo polla per sbloccare
        // "Apri" solo quando l'indirizzo risponde davvero: al primo publish l'attivazione
        // DNS/SSL di Cloudflare puo richiedere 30-90s, ai publish successivi e quasi immediata.
        const prs = await getProject(store, id);
        if (!prs.ok) return sendJson(res, 500, { ok: false, error: prs.error });
        if (!prs.value) return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Progetto non trovato.' } });
        const siteUrl = prs.value.url;
        if (!siteUrl) return sendJson(res, 200, { ok: true, live: false });
        const probe = await fetchUrl(siteUrl, 'text/html', 6000);
        const live = probe.ok && probe.res.ok; // 2xx = attivo; 522/530 (attivazione in corso) = non ancora
        if (probe.ok) { try { void probe.res.body?.cancel(); } catch {} } // il contenuto non serve
        return sendJson(res, 200, { ok: true, live });
      }
      if (action === 'publish' && method === 'POST') {
        console.log('  \u23f1 publish_start: ' + id);
        const pubBody = await readJsonBody(req);
        const pubEmail = typeof pubBody.email === 'string' ? pubBody.email.trim() : '';
        if (pubEmail && EMAIL_RE.test(pubEmail)) writeOwnerEmail(id, pubEmail);
        const subdomain = typeof pubBody.subdomain === 'string' ? pubBody.subdomain.trim() : '';
        const email = readOwnerEmail(id);
        const deliveryActive = !!(email && RESEND_KEY);

        const pre = await getProject(store, id);
        if (!pre.ok) return sendJson(res, 400, { ok: false, error: pre.error });
        if (!pre.value) return sendJson(res, 404, { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Progetto non trovato.' } });
        // Sottodominio esplicito (prima pubblicazione o cambio da Impostazioni) vince;
        // altrimenti riusa quello gia pubblicato, infine l'id come fallback.
        const already = (pre.value.url || '').match(/https:\/\/([a-z0-9-]+)\.pages\.dev/i);
        const projectName = subdomain || already?.[1] || pre.value.id;

        const host = deliveryActive
          ? makeCloudflarePagesResendHost({ ownerEmail: email as string, resendKey: RESEND_KEY, projectName, ...(RESEND_FROM ? { resendFrom: RESEND_FROM } : {}) })
          : makeCloudflarePagesHost({ projectName });
        // Un sito in pausa non si ripubblica dal flusso normale: va riattivato (unlock).
        if (pre.value.status === 'locked' && !pre.value.entitled) {
          return sendJson(res, 400, { ok: false, error: { code: 'SITE_LOCKED', message: 'Il sito è in pausa. Riattivalo prima di ripubblicare.' } });
        }
        // B2 gate: piano per-account. Se l'owner ha gia raggiunto maxPublished siti
        // pubblicati E questo sito non e entitled (override operatore) -> blocca.
        // Un sito gia 'published' che si ri-pubblica non conta come nuovo (e gia nel conteggio).
        {
          const plan = getAccountPlan(email || '');
          const alreadyPublished = await publishedCountForOwner(email || '');
          if (!canPublish({ entitled: !!pre.value.entitled, status: pre.value.status, publishedCount: alreadyPublished, maxPublished: plan.maxPublished })) {
            console.log('  ⛔ publish_blocked_plan_limit: ' + id + ' · owner ' + (email||'?') + ' · ' + alreadyPublished + '/' + plan.maxPublished);
            const nt = nextTier(plan.maxPublished, TIER_LADDER);
            return sendJson(res, 402, { ok: false, error: { code: 'PLAN_LIMIT_REACHED', message: 'Hai raggiunto il numero di siti pubblicabili del tuo piano. Attiva o aggiorna il piano per pubblicare altri siti.', planActive: plan.maxPublished > 0, planNext: nt ? { sites: nt.max } : null } });
          }
        }
        // Fast Preview / WYSIWYG: se ci sono pagine interne ancora pending, le genero ORA in
        // parallelo. Se una route fallisce o va in timeout uso una pagina fallback; il preflight
        // sotto impedisce comunque di pubblicare un sito non pronto.
        {
          const fin = await finalizePendingRoutes({ store, id, generator });
          if (!fin.ok) {
            console.log('  \u26d4 publish_failed: ' + fin.error.code + ' ' + fin.error.message);
            return sendJson(res, 400, { ok: false, error: fin.error });
          }
          if (fin.value.fallback.length) console.log('  \u26a0 publish_pending_fallback_routes: [' + fin.value.fallback.join(',') + ']');
        }
        // PREFLIGHT (safety): prima del deploy ricarico la sessione e verifico che OGNI route del
        // sitemap abbia HTML reale (no mancanti, no placeholder, no fallback, no pendingRoutes residue).
        // Se anche una sola route non e' pronta NON pubblico: lascio online il sito precedente e
        // rimetto le route non pronte in pendingRoutes cosi un retry (o il background) le completa.
        {
          console.log('  \u23f1 publish_preflight_start: ' + id);
          const chk = await store.load(id);
          if (!chk.ok || !chk.value) return sendJson(res, 404, { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Progetto non trovato.' } });
          const stPF = chk.value.state;
          const sitemap = stPF.routes.map((r) => r.route);
          const pageByRoute = new Map(stPF.pages.map((p) => [p.route, p] as const));
          const missing: string[] = [];
          const fallbackRoutes: string[] = [];
          for (const route of sitemap) {
            const pg = pageByRoute.get(route);
            if (!pg || !isRenderableHtml(pg.html) || isPlaceholderHtml(pg.html)) { missing.push(route); continue; }
            if (isFallbackHtml(pg.html)) fallbackRoutes.push(route);
          }
          const residualPending = pendingRoutesOf(stPF);
          console.log('  \u23f1 publish_preflight_routes_total: ' + sitemap.length);
          if (missing.length) console.log('  \u23f1 publish_preflight_missing_routes: [' + missing.join(',') + ']');
          if (fallbackRoutes.length) console.log('  \u23f1 publish_preflight_fallback_routes: [' + fallbackRoutes.join(',') + ']');
          const notReady = [...new Set([...missing, ...fallbackRoutes, ...residualPending])];
          if (missing.length || fallbackRoutes.length || residualPending.length) {
            console.log('  \u26d4 publish_blocked_incomplete_site: ' + id + ' \u00b7 missing ' + missing.length + ', fallback ' + fallbackRoutes.length + ', pending ' + residualPending.length);
            // Rimetto le route non pronte in pendingRoutes: il sito precedente resta online, il retry le rigenera.
            const reSet = new Set([...(stPF.pendingRoutes ?? []), ...missing, ...fallbackRoutes]);
            const repaired: SiteState = { ...stPF, pendingRoutes: [...reSet], updatedAt: new Date().toISOString() };
            await store.save({ ...chk.value, state: repaired });
            return sendJson(res, 503, { ok: false, error: { code: 'SITE_INCOMPLETE', message: 'Il sito \u00e8 ancora in rifinitura. Riprova tra poco.', notReady } });
          }
          console.log('  \u2713 publish_preflight_ok: ' + id + ' \u00b7 ' + sitemap.length + ' route reali');
        }
        // La pubblicazione approva da sola: publishProject vuole 'approved', ma l'utente
        // non ha piu un pulsante "Approva". Ri-approviamo da qualsiasi altro stato (bozza o pubblicato).
        if (pre.value.status !== 'approved') {
          const re = await approveProject(store, id);
          if (!re.ok) return sendJson(res, 400, { ok: false, error: re.error });
        }
        // Finalizzazione premium (separata dalla preview): il gate vero del direttore gira
        // QUI, al publish, non in creazione. Se il sito e sotto soglia, rigenera UNA volta
        // con la direzione creativa SALVATA e persiste la versione migliorata; altrimenti
        // lascia la preview. Best-effort: non blocca mai il publish. publishProject legge
        // poi lo stato gia aggiornato.
        try {
          await finalizeProject({ store, id, llm, generator, runQa, reviewMinScore: DIRECTOR_MIN_SCORE, enabled: DIRECTOR_REVIEW && DIRECTOR_FINALIZE });
        } catch (e) { console.log('  \u{1F3AC} fallback_to_preview: finalizzazione saltata —', errStr(e)); }
        console.log('  → publish: scan + deploy su Cloudflare… (sottodominio: ' + projectName + ', recapito form: ' + (deliveryActive ? 'attivo' : 'NON attivo') + ')');
        const t0 = Date.now();
        const baseUrl = `https://${projectName}.pages.dev`;
        const legalOpts = { name: publicBusinessName({ title: pre.value && pre.value.spec ? pre.value.spec.title : null, id, projectName }), email: (email as string) || '', legal: readLegal(id) };
        const _bp = readBusinessProfile(id);
        const _pizzaProfile = _bp && _bp.kind === 'pizzeria' ? _bp.data : undefined;
        const _pizzaSeo = buildPizzeriaLocalSeo(_pizzaProfile, baseUrl);
        const r = await withTimeout(
          publishProject({ store, id, scanner, host, materialize: (pages) => withContactLinks(withSiteHead(withVideoFacade(withBlockAssets(withLegal(withGuard(withOgMeta(withPizzeriaSeo(withPublicSanitize(withPizzeriaProfile(assetStore.materialize(pages, id), _pizzaProfile)), _pizzaSeo), baseUrl)), legalOpts))), { name: legalOpts.name })), trialDays: TRIAL_DAYS }),
          300_000,
          'La pubblicazione ha superato il tempo massimo ed e stata interrotta.',
        );
        if (!r.ok) {
          console.log('  ✗ publish:', r.error.code, r.error.message);
          console.log('  \u26d4 publish_failed: ' + r.error.code + ' ' + r.error.message);
          return sendJson(res, 400, { ok: false, error: r.error });
        }
        console.log('  ✓ publish in', ((Date.now() - t0) / 1000).toFixed(1), 's —', r.value.published ? 'online' : 'bloccato');
        console.log('  \u23f1 publish_done: ' + (r.value.published ? 'online' : 'bloccato dallo scan') + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
        // Account gratis (per email) o operatore → il sito è entitled (mai bloccato).
        try {
          const me3 = sessionUserOf(req);
          if (r.value.published && (isFreeEmail(email) || (me3 && me3.isOperator))) await grantEntitlement(id);
        } catch { /* best-effort */ }
        if (r.value.published) metricInc('published');
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
  console.log('Immagini: ' + (process.env.PEXELS_API_KEY ? 'attive (Pexels)' : 'NON configurate (imposta PEXELS_API_KEY; senza, i siti escono senza foto)'));
  console.log('Hosting: ' + (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID ? 'Cloudflare Pages' : 'NON configurato (publish dara errore finche non imposti le chiavi)'));
  console.log('Concierge: ' + (process.env.CONCIERGE_EMAIL ? 'richieste dominio → ' + process.env.CONCIERGE_EMAIL : 'CONCIERGE_EMAIL non impostata nel .env — le email andrebbero a ' + (CONCIERGE_EMAIL || 'nessun indirizzo') + ' (impostala su una casella che leggi davvero)'));
  console.log('Gating: prova ' + TRIAL_DAYS + ' giorni o ' + (EDIT_CAP > 0 ? EDIT_CAP + '' : 'infinite') + ' modifiche, poi lock' + (CF_READY && SWEEP_MINUTES > 0 ? ' (controllo ogni ' + SWEEP_MINUTES + ' min)' : ' (controllo OFF: Cloudflare non configurato)') + (ADMIN_TOKEN ? '' : ' — ADMIN_TOKEN non impostato: riattivazione disabilitata'));
  console.log('Auth: login via email · ' + (OPERATORS.size ? OPERATORS.size + ' operatore/i' : 'nessun operatore (imposta OPERATOR_EMAILS)') + ' · ' + (AUTH_REQUIRED ? 'enforcement ON (login obbligatorio, siti per utente)' : 'enforcement OFF') + (ANON_TRIAL ? ' · prova-ospite ON (1 generazione + 1 modifica, poi login)' : '') + ' · base ' + APP_URL);
  console.log('Direttore creativo: ' + (DIRECTOR_REVIEW ? 'ON (soglia ' + DIRECTOR_MIN_SCORE + '/10, max 1 rigenerazione)' : 'OFF'));
  console.log('Rigenerazione creativa al publish (finalize): ' + (DIRECTOR_REVIEW && DIRECTOR_FINALIZE ? 'ON' : 'OFF \u2014 publish WYSIWYG, solo scan+deploy'));
  console.log('Pagamenti: ' + (STRIPE_READY ? 'Stripe attivo (19€/mese -> 3 siti, per-account)' : 'Stripe OFF (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_BASE mancanti)'));
});

// Sweep periodico del trial (solo se Cloudflare e configurato: il lock deploya una pagina di pausa).
let sweepTimer: ReturnType<typeof setInterval> | undefined;
if (SWEEP_MINUTES > 0) {
  sweepTimer = setInterval(() => { void sweepTrials(); }, SWEEP_MINUTES * 60_000);
  setTimeout(() => { void sweepTrials(); }, 30_000); // primo giro poco dopo l'avvio
}

async function shutdown() {
  if (sweepTimer) clearInterval(sweepTimer);
  await liveQa.close();
  await closeRenderBrowser();
  await new Promise<void>((r) => server.close(() => r()));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
