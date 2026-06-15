/**
 * Pizzeria Pack v1 — Patch 4: Starting Point Intake.
 *
 * Primo step dell'intake ("Da dove vuoi partire?"): capisce da dove parte l'utente
 * prima delle domande verticali. Modello puro e testabile; la persistenza vive in
 * owners/<id>.json accanto a businessProfile/legal (opzionale, backward-compatible).
 *
 * Niente scraping/analisi qui: si salvano i dati grezzi forniti dall'utente. Un solo
 * collegamento sicuro al profilo: se arriva un Google Maps URL certo e il progetto è
 * una pizzeria, si valorizza googleMapsUrl. Nient'altro viene mai inventato.
 */

import type { PizzeriaBusinessProfile } from './pizzeriaProfile.js';

export type StartingPointMode =
  | 'existing-site'
  | 'social-or-maps'
  | 'materials'
  | 'guided-from-zero'
  | 'free-description';

export type SiteTreatment =
  | 'keep-content-modernize'
  | 'keep-style-improve'
  | 'change-direction'
  | 'use-data-only'
  | 'advise-me';

export interface StartingPointIntake {
  mode?: StartingPointMode;
  existingSiteUrl?: string;
  socialLinks?: {
    instagram?: string;
    facebook?: string;
    googleMaps?: string;
  };
  materials?: {
    menuText?: string;
    notes?: string;
    hasPhotos?: boolean;
    hasLogo?: boolean;
  };
  currentSiteTreatment?: SiteTreatment;
  createdAt?: string;
  updatedAt?: string;
}

/** Le 5 opzioni del primo step, con la label mostrata e il mode salvato. */
export const STARTING_POINT_OPTIONS: ReadonlyArray<{ label: string; mode: StartingPointMode }> = [
  { label: 'Ho già un sito da rifare', mode: 'existing-site' },
  { label: 'Ho Instagram / Facebook / Google Maps', mode: 'social-or-maps' },
  { label: 'Ho menu, foto o testi da caricare', mode: 'materials' },
  { label: 'Parto da zero e voglio essere guidato', mode: 'guided-from-zero' },
  { label: 'So già cosa voglio, scrivo tutto io', mode: 'free-description' },
];

/** Le 5 opzioni di trattamento del sito esistente (flusso existing-site). */
export const SITE_TREATMENT_OPTIONS: ReadonlyArray<{ label: string; treatment: SiteTreatment }> = [
  { label: 'Mantieni contenuti e dati, ma rendilo più moderno', treatment: 'keep-content-modernize' },
  { label: 'Mantieni lo stile, ma miglioralo', treatment: 'keep-style-improve' },
  { label: 'Cambia completamente direzione', treatment: 'change-direction' },
  { label: 'Usa solo i dati, non lo stile', treatment: 'use-data-only' },
  { label: 'Non so, consigliami tu', treatment: 'advise-me' },
];

const MODES = new Set<StartingPointMode>(STARTING_POINT_OPTIONS.map((o) => o.mode));
const TREATMENTS = new Set<SiteTreatment>(SITE_TREATMENT_OPTIONS.map((o) => o.treatment));

function isMode(v: unknown): v is StartingPointMode {
  return typeof v === 'string' && MODES.has(v as StartingPointMode);
}
function isTreatment(v: unknown): v is SiteTreatment {
  return typeof v === 'string' && TREATMENTS.has(v as SiteTreatment);
}

/** Riconosce un URL Google Maps in modo conservativo. */
export function isGoogleMapsUrl(u: string): boolean {
  return /^https?:\/\//i.test(u) && /(google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(u);
}

function pickUrl(u: unknown): string | undefined {
  if (typeof u !== 'string') return undefined;
  let s = u.trim();
  if (!s) return undefined;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z0-9.\-]+\.[a-z]{2,}(\/|$)/i.test(s)) s = 'https://' + s;
    else return undefined;
  }
  return s.length <= 2000 ? s : undefined;
}

/** Estrae link Instagram / Facebook / Google Maps da un testo libero. */
export function extractSocialLinks(text: string): { instagram?: string; facebook?: string; googleMaps?: string } {
  const out: { instagram?: string; facebook?: string; googleMaps?: string } = {};
  if (!text) return out;
  const urls = text.match(/https?:\/\/[^\s'"<>]+/gi) || [];
  for (const u of urls) {
    const low = u.toLowerCase();
    if (!out.googleMaps && isGoogleMapsUrl(u)) out.googleMaps = u;
    else if (!out.instagram && /instagram\.com/.test(low)) out.instagram = u;
    else if (!out.facebook && /(facebook\.com|fb\.com|fb\.me)/.test(low)) out.facebook = u;
  }
  return out;
}

function sanitizeSocial(links: unknown, text: unknown): StartingPointIntake['socialLinks'] {
  const l = (links && typeof links === 'object' ? links : {}) as Record<string, unknown>;
  const fromText = extractSocialLinks(typeof text === 'string' ? text : '');
  const out: NonNullable<StartingPointIntake['socialLinks']> = {};
  const ig = pickUrl(l.instagram) || fromText.instagram;
  const fb = pickUrl(l.facebook) || fromText.facebook;
  const gmRaw = pickUrl(l.googleMaps) || fromText.googleMaps;
  if (ig) out.instagram = ig;
  if (fb) out.facebook = fb;
  if (gmRaw && isGoogleMapsUrl(gmRaw)) out.googleMaps = gmRaw;
  return Object.keys(out).length ? out : undefined;
}

function sanitizeMaterials(raw: unknown): StartingPointIntake['materials'] {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: NonNullable<StartingPointIntake['materials']> = {};
  if (typeof m.menuText === 'string' && m.menuText.trim()) out.menuText = m.menuText.trim().slice(0, 20000);
  if (typeof m.notes === 'string' && m.notes.trim()) out.notes = m.notes.trim().slice(0, 20000);
  if (m.hasPhotos === true) out.hasPhotos = true;
  if (m.hasLogo === true) out.hasLogo = true;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Costruisce uno StartingPointIntake pulito dal payload grezzo (es. body della create).
 * Tiene solo i campi pertinenti al mode scelto. Ritorna null se non c'è un mode valido.
 */
export function normalizeStartingPoint(raw: unknown, now: string = new Date().toISOString()): StartingPointIntake | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isMode(r.mode)) return null;
  const sp: StartingPointIntake = {
    mode: r.mode,
    createdAt: typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : now,
    updatedAt: now,
  };
  if (r.mode === 'existing-site') {
    const url = pickUrl(r.existingSiteUrl);
    if (url) sp.existingSiteUrl = url;
    if (isTreatment(r.currentSiteTreatment)) sp.currentSiteTreatment = r.currentSiteTreatment;
  } else if (r.mode === 'social-or-maps') {
    const links = sanitizeSocial(r.socialLinks, r.socialText);
    if (links) sp.socialLinks = links;
  } else if (r.mode === 'materials') {
    const mat = sanitizeMaterials(r.materials);
    if (mat) sp.materials = mat;
  }
  // guided-from-zero / free-description: solo il mode (proseguono col flusso esistente)
  return sp;
}

/**
 * Collegamento sicuro al profilo pizzeria: se lo starting point porta un Google Maps URL
 * certo e il profilo esiste già (pizzeria) senza googleMapsUrl, lo valorizza.
 * NON crea il profilo se non c'è: per i non-pizzeria ritorna sempre changed:false.
 */
export function mergeStartingPointIntoProfile(
  intake: StartingPointIntake | undefined | null,
  profile: PizzeriaBusinessProfile | undefined | null,
): { profile?: PizzeriaBusinessProfile; changed: boolean } {
  if (!intake || !profile) return { changed: false };
  const maps = intake.socialLinks && intake.socialLinks.googleMaps ? intake.socialLinks.googleMaps : '';
  if (maps && isGoogleMapsUrl(maps) && !profile.googleMapsUrl) {
    return { profile: { ...profile, googleMapsUrl: maps }, changed: true };
  }
  return { changed: false };
}
