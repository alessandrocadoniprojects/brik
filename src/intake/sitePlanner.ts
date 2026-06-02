/**
 * Pianificatore di sito (Fase 3 / tappa 3).
 *
 * Da una descrizione in linguaggio naturale ricava la STRUTTURA del sito:
 *  - quali pagine creare (route + etichetta nel menu),
 *  - quali requisiti vanno in ciascuna pagina,
 *  - i criteri di navigazione (dal menu home verso ogni altra pagina).
 *
 * La route di ogni criterio la decide il pianificatore (deterministico): il
 * classificatore esistente serve solo a mappare ogni frase nel TIPO di check
 * (content-present / form-submission / responsive / navigation), poi la route
 * viene sovrascritta con quella della pagina assegnata. Default a UNA pagina per
 * attivita semplici; piu pagine quando la descrizione lo richiede.
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
  'Ogni requisito e una frase verificabile: dove possibile usa i testi ESATTI tra virgolette (titoli, slogan, voci) e, se c\'e un form, indica i campi e il messaggio di conferma esatto. Metti ogni requisito nella pagina giusta.',
  'NON elencare voci di menu o link come requisiti: la navigazione tra le pagine e automatica. Per ogni pagina AL MASSIMO UN form, con UN SOLO messaggio di conferma. Non elencare etichette di bottoni o nomi di campi come requisiti separati. Tieni i requisiti essenziali, senza ripetizioni.',
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

function escapeRouteForPattern(route: string): string {
  return route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
  //    Guardrail: niente navigazione dal classificatore (la nav e automatica),
  //    max un form per pagina, dedup dei content-present e dei responsive.
  const norm = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const seenContent = new Set<string>();
  const formRoutes = new Set<string>();
  const responsiveRoutes = new Set<string>();
  const criteria: AcceptanceCriterion[] = [];
  let n = 0;
  for (const page of finalPages) {
    for (const statement of page.statements) {
      const c = await args.classifier.classify(statement, { category, knownRoutes });
      if (!c.ok) return err(c.error);
      if (!c.value) {
        n += 1;
        criteria.push({ id: 'c' + n, statement, confirmed: true });
        continue;
      }
      const k = assignRoute(c.value, page.route);
      if (k.kind === 'navigation') continue; // gestita in automatico piu sotto
      if (k.kind === 'content-present') {
        const key = page.route + '\u0000' + norm(k.text);
        if (seenContent.has(key)) continue;
        seenContent.add(key);
      } else if (k.kind === 'form-submission') {
        if (formRoutes.has(page.route)) continue; // max un form per pagina
        formRoutes.add(page.route);
      } else if (k.kind === 'responsive') {
        if (responsiveRoutes.has(page.route)) continue;
        responsiveRoutes.add(page.route);
      }
      n += 1;
      criteria.push({ id: 'c' + n, statement, confirmed: true, check: k });
    }
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
