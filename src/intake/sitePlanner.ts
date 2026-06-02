/**
 * Pianificatore di sito (Fase 3 / tappa 3) — versione robusta.
 *
 * Da una descrizione in linguaggio naturale ricava la STRUTTURA del sito (pagine,
 * requisiti per pagina, navigazione). La route di ogni criterio la decide il
 * pianificatore (deterministico); il classificatore mappa la frase nel TIPO di check.
 *
 * GARANZIE DETERMINISTICHE (non dipendono dalla bravura dell'LLM):
 *  - Ogni testo tra virgolette nella richiesta diventa un criterio verificato VERBATIM,
 *    sulla pagina giusta (rete di sicurezza: nulla di esplicitamente citato va perso).
 *  - Il messaggio di conferma di un form e preso ESATTO dalla frase (niente conferme inventate).
 *  - Gli elenchi espliciti di voci ("menu (a, b, c)", "servizi: a, b, c") vengono esplosi
 *    in un criterio per voce, sulla pagina indicata — escludendo gli elenchi di CAMPI di un form.
 */
import {
  type ProjectSpec,
  type ProjectCategory,
  type AcceptanceCriterion,
  type CheckSpec,
  type IntakeClassifier,
  type LLMProvider,
  type Result,
  ok,
  err,
  appError,
} from '@core';
import type { RouteInfo } from '../adapters/anthropic/siteGenerator.js';

const CATEGORIES: readonly ProjectCategory[] = [
  'business-landing',
  'lead-landing',
  'booking',
  'ecommerce',
  'portfolio',
  'directory',
  'blog',
  'crud-app',
];

interface PlannedPage {
  readonly route: string;
  readonly label: string;
  readonly statements: readonly string[];
}

const SYSTEM = [
  'Sei un pianificatore di siti web. Data la richiesta dell\'utente, decidi la STRUTTURA del sito.',
  'Per attivita semplici (una landing, raccolta contatti, un portfolio breve) usa UNA sola pagina con route "/".',
  'Crea piu pagine SOLO se la richiesta lo giustifica o nomina sezioni/pagine (es. chi siamo, servizi, contatti, menu, prodotti). Massimo 6 pagine.',
  'La PRIMA pagina e sempre la home con route "/". Le route sono percorsi minuscoli senza spazi (es. "/chi-siamo", "/servizi", "/contatti").',
  'Riporta SEMPRE i testi tra virgolette dell\'utente (slogan, titoli, messaggi) IDENTICI, dentro le frasi-requisito.',
  'Se l\'utente ELENCA piu voci (separate da virgola, tra parentesi, o dopo i due punti — es. piatti, servizi, prodotti), crea UNA frase-requisito PER OGNI voce, col nome ESATTO. NON riassumere gli elenchi.',
  'Se c\'e un form, scrivi nella frase i campi e il messaggio di conferma ESATTO tra virgolette (es. mostra "Grazie, a presto" dopo l\'invio). Per ogni pagina AL MASSIMO UN form.',
  'NON elencare voci di menu o link come requisiti: la navigazione tra le pagine e automatica. Non elencare etichette di bottoni o nomi di campi come requisiti separati. Niente ripetizioni.',
  'Esempio: richiesta "pizzeria, pagina menu (Margherita, Marinara, Diavola)" -> pagina /menu con TRE frasi: Mostra "Margherita"; Mostra "Marinara"; Mostra "Diavola".',
  'Rispondi SOLO con JSON valido (nessun markdown), in questa forma:',
  '{"title":"...","category":"business-landing|lead-landing|booking|ecommerce|portfolio|directory|blog|crud-app","pages":[{"route":"/","label":"Home","statements":["..."]}]}',
].join('\n');

function stripToJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return s;
}

function normalizeRoute(route: string): string {
  let r = route.trim().toLowerCase().replace(/\s+/g, '-');
  if (!r.startsWith('/')) r = '/' + r;
  return r;
}

const norm = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function assignRoute(check: CheckSpec, route: string): CheckSpec {
  switch (check.kind) {
    case 'content-present':
    case 'route-loads':
    case 'responsive':
    case 'form-submission':
      return { ...check, route };
    case 'navigation':
      return { ...check, fromRoute: route };
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function escapeRouteForPattern(route: string): string {
  return escapeRe(route);
}

/* ----------------------------- parser deterministici (esportati per i test) ----------------------------- */

/** Estrae i testi tra virgolette doppie/curve e singole (queste ultime con guardia anti-apostrofo). */
export function extractQuoted(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/["\u201c]([^"\u201c\u201d]{2,}?)["\u201d]/g)) if (m[1]) found.push(m[1].trim());
  // singole: la ' conta come virgoletta solo se NON e un apostrofo (lettera-lettera).
  for (const m of text.matchAll(/(?:^|[\s(>\-\u2014:])'([^']{2,}?)'(?=$|[\s).,!?;:<\-\u2014])/g)) if (m[1]) found.push(m[1].trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of found) {
    const k = norm(s);
    if (k && !seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

const CONFIRM_CUE = /(conferm|mostra|dice|appare|compare|ricev|grazie|inviat|rispond|invio)/i;

/** Dato il testo di una frase-form, sceglie il messaggio di conferma ESATTO (quello vicino a una parola-spia, altrimenti l'ultimo tra virgolette). */
export function pickConfirmation(statement: string): string | undefined {
  const quotes: { text: string; index: number }[] = [];
  for (const m of statement.matchAll(/["\u201c]([^"\u201c\u201d]{2,}?)["\u201d]/g)) if (m[1]) quotes.push({ text: m[1].trim(), index: m.index ?? 0 });
  for (const m of statement.matchAll(/(?:^|[\s(>\-\u2014:])'([^']{2,}?)'(?=$|[\s).,!?;:<\-\u2014])/g)) if (m[1]) quotes.push({ text: m[1].trim(), index: m.index ?? 0 });
  if (quotes.length === 0) return undefined;
  quotes.sort((a, b) => a.index - b.index);
  for (const q of quotes) {
    const before = statement.slice(Math.max(0, q.index - 30), q.index);
    if (CONFIRM_CUE.test(before)) return q.text;
  }
  return quotes[quotes.length - 1]!.text;
}

const ITEM_STOP = new Set(['e', 'o', 'ed', 'od', 'ecc', 'etc', 'and', 'or', 'opzionale', 'opzionali', 'eccetera']);
const FORM_BEFORE = /\b(form|modulo|moduli|campi|campo)\b/i;

function splitItems(inside: string): string[] {
  return inside
    .split(/,| e | ed /i)
    .map((s) => s.trim().replace(/^["'\u201c]|["'\u201d]$/g, '').trim())
    .filter((s) => {
      if (s.length < 2 || s.length > 40) return false;
      const words = s.split(/\s+/);
      if (words.length > 4) return false;
      if (!/^[\p{L}0-9][\p{L}0-9 '&.\-]*$/u.test(s)) return false;
      if (ITEM_STOP.has(norm(s))) return false;
      return true;
    });
}

/** Estrae elenchi etichettati ("LABEL (a, b, c)" o "LABEL: a, b, c") e li associa alla pagina il cui nome compare nell'etichetta. Esclude gli elenchi di CAMPI di un form. */
export function extractLabeledLists(
  description: string,
  pages: readonly { route: string; label: string }[],
): { route: string; text: string }[] {
  const targets = pages.map((p) => ({ route: p.route, label: norm(p.label), routeKey: norm(p.route.replace(/^\//, '').replace(/-/g, ' ')) }));
  const matchRoute = (before: string): string | undefined => {
    const b = norm(before);
    let best: { route: string; at: number } | undefined;
    for (const t of targets) {
      for (const key of [t.label, t.routeKey]) {
        if (!key) continue;
        const re = new RegExp('\\b' + escapeRe(key) + '\\b', 'g');
        let m: RegExpExecArray | null;
        let last = -1;
        while ((m = re.exec(b)) !== null) last = m.index;
        if (last >= 0 && (!best || last > best.at)) best = { route: t.route, at: last };
      }
    }
    return best?.route;
  };

  const out: { route: string; text: string }[] = [];
  const seen = new Set<string>();
  const add = (route: string, text: string) => {
    const key = route + '\u0000' + norm(text);
    if (!seen.has(key)) { seen.add(key); out.push({ route, text }); }
  };

  // parentesi: "...menu (Margherita, Marinara, Diavola)"
  for (const m of description.matchAll(/([^()]{0,40})\(([^()]{2,200})\)/g)) {
    const before = m[1] ?? '';
    if (FORM_BEFORE.test(before)) continue;
    const items = splitItems(m[2] ?? '');
    if (items.length < 2) continue;
    const route = matchRoute(before);
    if (!route) continue;
    for (const it of items) add(route, it);
  }
  // due punti: "servizi: taglio, piega, colore"
  for (const m of description.matchAll(/([\p{L}0-9 '&.\-]{2,40}):\s*([^.:;\n]{2,200})/gu)) {
    const before = m[1] ?? '';
    if (FORM_BEFORE.test(before)) continue;
    const items = splitItems(m[2] ?? '');
    if (items.length < 2) continue;
    const route = matchRoute(before);
    if (!route) continue;
    for (const it of items) add(route, it);
  }
  return out;
}

/* ----------------------------- pianificazione ----------------------------- */

export interface SitePlan {
  readonly spec: ProjectSpec;
  readonly routes: readonly RouteInfo[];
}

export async function planSite(args: {
  readonly id: string;
  readonly ownerId: string;
  readonly description: string;
  readonly llm: LLMProvider;
  readonly classifier: IntakeClassifier;
}): Promise<Result<SitePlan>> {
  // 1) Struttura dal pianificatore
  const res = await args.llm.complete({ system: SYSTEM, prompt: 'Richiesta dell\'utente:\n' + args.description, tier: 'balanced', maxTokens: 2048 });
  if (!res.ok) return err(res.error);

  let parsed: { title?: unknown; category?: unknown; pages?: unknown };
  try {
    parsed = JSON.parse(stripToJson(res.value.text));
  } catch {
    return err(appError('PLAN_BAD_JSON', 'Il pianificatore non ha prodotto JSON valido.', { retryable: true }));
  }

  const rawPages = Array.isArray(parsed.pages) ? parsed.pages : [];
  const pages: PlannedPage[] = [];
  for (const p of rawPages) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    if (typeof o.route !== 'string' || typeof o.label !== 'string') continue;
    const statements = Array.isArray(o.statements) ? o.statements.filter((x): x is string => typeof x === 'string') : [];
    pages.push({ route: normalizeRoute(o.route), label: o.label.trim() || 'Pagina', statements });
  }
  if (pages.length === 0) return err(appError('PLAN_NO_PAGES', 'Il pianificatore non ha prodotto pagine.', { retryable: true }));

  // home garantita e route uniche, max 6
  const seen = new Set<string>();
  const unique: PlannedPage[] = [];
  for (const p of pages) {
    if (seen.has(p.route)) continue;
    seen.add(p.route);
    unique.push(p);
  }
  let finalPages = unique.slice(0, 6);
  if (!finalPages.some((p) => p.route === '/')) {
    finalPages = [{ route: '/', label: 'Home', statements: [] }, ...finalPages].slice(0, 6);
  }

  const routes: RouteInfo[] = finalPages.map((p) => ({ route: p.route, label: p.label }));
  const knownRoutes = routes.map((r) => r.route);
  const category = CATEGORIES.includes(parsed.category as ProjectCategory) ? (parsed.category as ProjectCategory) : 'business-landing';
  const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : args.id;

  // 2) Classifica ogni frase e sovrascrivi la route con quella della pagina.
  const seenContent = new Set<string>(); // route\u0000testo
  const formRoutes = new Set<string>();
  const responsiveRoutes = new Set<string>();
  const criteria: AcceptanceCriterion[] = [];
  let n = 0;
  const addContent = (route: string, statement: string, text: string): void => {
    const r = knownRoutes.includes(route) ? route : '/';
    const key = r + '\u0000' + norm(text);
    if (seenContent.has(key)) return;
    seenContent.add(key);
    n += 1;
    criteria.push({ id: 'c' + n, statement, confirmed: true, check: { kind: 'content-present', route: r, text } });
  };

  for (const page of finalPages) {
    for (const statement of page.statements) {
      const c = await args.classifier.classify(statement, { category, knownRoutes });
      if (!c.ok) return err(c.error);
      if (!c.value) {
        n += 1;
        criteria.push({ id: 'c' + n, statement, confirmed: true });
        continue;
      }
      let k = assignRoute(c.value, page.route);
      if (k.kind === 'navigation') continue; // nav automatica piu sotto
      if (k.kind === 'content-present') {
        const key = page.route + '\u0000' + norm(k.text);
        if (seenContent.has(key)) continue;
        seenContent.add(key);
      } else if (k.kind === 'form-submission') {
        if (formRoutes.has(page.route)) continue; // max un form per pagina
        formRoutes.add(page.route);
        // GARANZIA: conferma esatta presa dalla frase, se citata tra virgolette.
        const exact = pickConfirmation(statement);
        if (exact) k = { ...k, confirmationText: exact };
      } else if (k.kind === 'responsive') {
        if (responsiveRoutes.has(page.route)) continue;
        responsiveRoutes.add(page.route);
      }
      n += 1;
      criteria.push({ id: 'c' + n, statement, confirmed: true, check: k });
    }
  }

  // 2b) GARANZIA elenchi: esplodi gli elenchi etichettati della richiesta sulla pagina indicata.
  for (const { route, text } of extractLabeledLists(args.description, finalPages)) {
    addContent(route, `Mostra "${text}"`, text);
  }

  // 2c) GARANZIA quote: ogni testo tra virgolette non ancora coperto diventa contenuto verbatim.
  //      (le conferme dei form sono escluse: compaiono solo dopo l'invio, non al caricamento.)
  const covered = new Set<string>();
  for (const c of criteria) {
    const k = c.check;
    if (k?.kind === 'content-present') covered.add(norm(k.text));
    else if (k?.kind === 'form-submission') covered.add(norm(k.confirmationText));
  }
  const stmtPage = (q: string): string => {
    const nq = norm(q);
    for (const p of finalPages) for (const s of p.statements) if (norm(s).includes(nq)) return p.route;
    return '/';
  };
  for (const q of extractQuoted(args.description)) {
    if (covered.has(norm(q))) continue;
    covered.add(norm(q));
    addContent(stmtPage(q), `Mostra "${q}"`, q);
  }

  // 3) Criteri di navigazione: dal menu home verso ogni altra pagina
  for (const page of finalPages) {
    if (page.route === '/') continue;
    n += 1;
    criteria.push({
      id: 'c' + n,
      statement: `Dal menu si raggiunge "${page.label}"`,
      confirmed: true,
      check: { kind: 'navigation', fromRoute: '/', linkText: page.label, toRoutePattern: escapeRouteForPattern(page.route) },
    });
  }

  const spec: ProjectSpec = {
    id: args.id,
    ownerId: args.ownerId,
    category,
    title,
    description: args.description,
    criteria,
  };
  return ok({ spec, routes });
}
