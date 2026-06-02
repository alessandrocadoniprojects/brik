/**
 * Generatore di siti MULTI-PAGINA (Fase 3 / tappa 1).
 *
 * Produce un MPA reale: più file HTML, uno per route, con la STESSA intestazione
 * e gli stessi stili, e link di navigazione veri (href ai percorsi). Niente SPA
 * a tab nascoste. Output in un formato delimitato e poi parsato in SitePage[].
 * Espone anche fix(): rigenera tutte le pagine correggendo i problemi della QA,
 * mantenendo il resto. I requisiti per pagina derivano dai criteri (stessa fonte
 * della QA): coerenza per costruzione.
 */
import {
  type LLMProvider,
  type LLMRequest,
  type ProjectSpec,
  type SitePage,
  type SiteRoute,
  type Result,
  ok,
  err,
  appError,
} from '@core';
import type { FormDelivery } from '@core';
import { injectForms, deInjectForms } from '../../project/forms.js';
import { resolveImages } from '../../project/images.js';
import type { ImageSource } from '../images/pexels.js';

/** Percorso + etichetta del menu per una pagina. */
export type RouteInfo = SiteRoute;

export interface SiteGenerator {
  generate(spec: ProjectSpec, routes: readonly RouteInfo[]): Promise<Result<SitePage[]>>;
  fix(
    spec: ProjectSpec,
    routes: readonly RouteInfo[],
    current: readonly SitePage[],
    failures: readonly { kind: string; detail: string }[],
  ): Promise<Result<SitePage[]>>;
  edit(
    spec: ProjectSpec,
    routes: readonly RouteInfo[],
    current: readonly SitePage[],
    instruction: string,
  ): Promise<Result<SitePage[]>>;
}

const SYSTEM = [
  'Sei un generatore di siti web MULTI-PAGINA. Produci PIU file HTML completi, uno per ciascuna pagina richiesta.',
  'Ogni file e autosufficiente: CSS e JS INLINE, nessun font o risorsa esterna; HTML5 valido con <meta charset="utf-8"> e <meta name="viewport" content="width=device-width, initial-scale=1">.',
  'TUTTE le pagine condividono la STESSA intestazione con un menu di navigazione che collega OGNI pagina usando ESATTAMENTE i percorsi indicati negli href (es. <a href="/contatti">). Stesso stile e stesso footer ovunque.',
  'Ogni pagina e UNA sola schermata scrollabile: niente tab o sezioni nascoste via JavaScript.',
  'Metti ogni contenuto nella SUA pagina e usa i testi ESATTI dove indicato.',
  // DESIGN
  'DESIGN: punta a un risultato moderno, curato e distintivo, NON generico. Definisci una palette coerente (2-3 colori + neutri) adatta al tipo di attivita, una scala tipografica chiara (titoli grandi e ariosi, testo leggibile 16-18px, interlinea comoda), spaziature generose (padding di sezione ampi) e una gerarchia visiva netta. Usa solo font di sistema via stack CSS (es. system-ui, -apple-system, Segoe UI, Roboto, sans-serif), MAI Google Fonts o font esterni.',
  'STRUTTURA RICCA: la home ha una hero d\'impatto (titolo grande, sottotitolo, eventuale pulsante CTA), poi sezioni ben ritmate (es. punti di forza in card/griglia, una citazione/claim, informazioni utili). Pulsanti e link stilizzati con stato :hover. Footer completo e coerente su tutte le pagine.',
  'RESPONSIVE: layout fluido, NIENTE overflow orizzontale a 375px; su mobile le griglie diventano colonna singola, i titoli si riducono, i tap target restano ampi. Usa unita relative, max-width sui contenuti e media query.',
  // IMMAGINI
  'IMMAGINI (foto stock reali): dove una foto rafforza la pagina (hero, sezione "chi siamo", galleria, voci di menu/prodotti) inserisci un SEGNAPOSTO nel formato <img data-brik-img="QUERY" alt="descrizione"> SENZA attributo src: il sistema lo sostituira con una foto vera pertinente. La QUERY deve essere in INGLESE, 2-5 parole concrete (es. "wood fired pizza", "cozy restaurant interior", "fresh italian ingredients", "happy team office").',
  'Stila SEMPRE le immagini cosi non rompono il layout: mettile in un contenitore con dimensioni/aspetto definiti e applica img { width:100%; height:100%; object-fit:cover; display:block; }. Per una hero con foto usa un contenitore alto con l\'<img> in object-fit cover (NON usare background-image: il segnaposto funziona solo con il tag <img>).',
  'Usa le foto con misura: tipicamente 1 hero + 2-4 immagini totali nel sito; NON mettere immagini dove non aggiungono valore. NON inventare URL di immagini ne usare servizi esterni: usa SEMPRE e solo il segnaposto data-brik-img.',
  // FORM + FORMATO
  'NON scrivere mai un form di contatto/prenotazione: dove un form deve apparire, inserisci ESATTAMENTE il commento <!--BRIK_CONTACT_FORM--> e NIENT\'ALTRO per quel form (niente <form>, campi o JS). Lo costruisce il sistema.',
  'FORMATO OBBLIGATORIO: per ogni pagina una riga con il delimitatore esatto "<<<FILE {percorso}>>>" (es. "<<<FILE /contatti>>>") e SUBITO SOTTO il codice HTML completo della pagina. Nessun altro testo, nessun markdown.',
].join('\n');

/** Requisiti raggruppati per pagina (dai criteri tipizzati). */
function requirementsByRoute(spec: ProjectSpec, routes: readonly RouteInfo[]): string {
  const blocks: string[] = [];
  for (const { route, label } of routes) {
    const lines: string[] = [];
    for (const c of spec.criteria) {
      const k = c.check;
      if (!k) continue;
      if (k.kind === 'content-present' && k.route === route) lines.push(`- DEVE contenere il testo ESATTO: "${k.text}".`);
      else if (k.kind === 'responsive' && k.route === route) lines.push('- Usabile su mobile (375px) senza overflow orizzontale.');
      else if (k.kind === 'form-submission' && k.route === route) {
        const fl = k.fields.map((f) => `"${f.label}"`).join(', ');
        lines.push(`- Un form di contatto con i campi ${fl}: inserisci ESATTAMENTE il segnaposto <!--BRIK_CONTACT_FORM--> dove deve apparire (lo costruisce il sistema, non scriverlo tu).`);
      } else if (k.kind === 'navigation' && k.fromRoute === route) {
        lines.push(`- Un link con testo "${k.linkText}" che punta a "${k.toRoutePattern}".`);
      }
    }
    blocks.push(`## Pagina ${route} (${label})\n` + (lines.length ? lines.join('\n') : '- Contenuto coerente con il sito.'));
  }
  return blocks.join('\n\n');
}

function navSpec(routes: readonly RouteInfo[]): string {
  return routes.map((r) => `${r.label} -> ${r.route}`).join(' | ');
}

function cleanHtml(seg: string): string | null {
  let s = seg.trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.search(/<!doctype html|<html/i);
  if (start === -1) return null;
  return s.slice(start);
}

/** Parsa l'output delimitato in pagine; valida che tutte le route attese ci siano. */
function parseSite(raw: string, expected: readonly string[]): Result<SitePage[]> {
  const text = raw.trim();
  const re = /<<<FILE\s+([^\s>]+)\s*>>>/g;
  const marks: { route: string; end: number; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) marks.push({ route: m[1] as string, idx: m.index, end: re.lastIndex });
  if (marks.length === 0) return err(appError('SITE_NO_FILES', 'Output senza delimitatori <<<FILE ...>>>.', { retryable: true }));

  const pages: SitePage[] = [];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i]!.end;
    const to = i + 1 < marks.length ? marks[i + 1]!.idx : text.length;
    const html = cleanHtml(text.slice(from, to));
    if (html) pages.push({ route: marks[i]!.route, html });
  }
  const have = new Set(pages.map((p) => p.route));
  const missing = expected.filter((r) => !have.has(r));
  if (missing.length) return err(appError('SITE_MISSING_PAGES', 'Mancano pagine nell\'output: ' + missing.join(', '), { retryable: true }));
  // tieni solo le route attese, nell'ordine atteso
  const byRoute = new Map(pages.map((p) => [p.route, p] as const));
  return ok(expected.map((r) => byRoute.get(r)!));
}

function delimited(pages: readonly SitePage[]): string {
  return pages.map((p) => `<<<FILE ${p.route}>>>\n${p.html}`).join('\n\n');
}

export function makeAnthropicSiteGenerator(
  llm: LLMProvider,
  opts: { readonly tier?: LLMRequest['tier']; readonly delivery?: FormDelivery; readonly images?: ImageSource } = {},
): SiteGenerator {
  const tier = opts.tier ?? 'balanced';
  const expectedRoutes = (routes: readonly RouteInfo[]) => routes.map((r) => r.route);
  const finish = async (raw: string, spec: ProjectSpec, routes: readonly RouteInfo[]): Promise<Result<SitePage[]>> => {
    const parsed = parseSite(raw, expectedRoutes(routes));
    if (!parsed.ok) return parsed;
    const descriptor = opts.delivery?.describe({ siteId: spec.id, subject: spec.title });
    const withForms = injectForms(parsed.value, spec, descriptor);
    if (!opts.images) return ok(withForms);
    return ok(await resolveImages(withForms, opts.images));
  };

  return {
    async generate(spec, routes) {
      const prompt = [
        `Titolo del sito: ${spec.title}`,
        `Descrizione: ${spec.description}`,
        `Categoria: ${spec.category}`,
        '',
        `Pagine del sito e menu (uguale su tutte): ${navSpec(routes)}`,
        '',
        'Requisiti per pagina:',
        requirementsByRoute(spec, routes),
      ].join('\n');

      const res = await llm.complete({ system: SYSTEM, prompt, tier, maxTokens: 16000 });
      if (!res.ok) return err(res.error);
      return finish(res.value.text, spec, routes);
    },

    async fix(spec, routes, current, failures) {
      const system = [
        SYSTEM,
        'Questa e una CORREZIONE: ricevi le pagine attuali e i problemi rilevati. Correggi SOLO i problemi indicati, mantenendo invariato il resto (contenuti, stile, navigazione). Restituisci di nuovo TUTTE le pagine nel formato delimitato.',
      ].join('\n');
      const prompt = [
        `Titolo del sito: ${spec.title}`,
        `Pagine e menu: ${navSpec(routes)}`,
        '',
        'PROBLEMI DA CORREGGERE:',
        failures.map((f) => `- [${f.kind}] ${f.detail}`).join('\n'),
        '',
        'PAGINE ATTUALI:',
        delimited(deInjectForms(current)),
      ].join('\n');

      const res = await llm.complete({ system, prompt, tier, maxTokens: 16000 });
      if (!res.ok) return err(res.error);
      return finish(res.value.text, spec, routes);
    },

    async edit(spec, routes, current, instruction) {
      const system = [
        SYSTEM,
        'Questa e una MODIFICA richiesta dall\'utente: applica SOLO il cambiamento richiesto, lasciando invariato tutto il resto (contenuti, stile, navigazione, le altre pagine). Restituisci di nuovo TUTTE le pagine nel formato delimitato.',
      ].join('\n');
      const prompt = [
        `Titolo del sito: ${spec.title}`,
        `Pagine e menu: ${navSpec(routes)}`,
        '',
        'MODIFICA RICHIESTA:',
        instruction,
        '',
        'PAGINE ATTUALI:',
        delimited(deInjectForms(current)),
      ].join('\n');

      const res = await llm.complete({ system, prompt, tier, maxTokens: 16000 });
      if (!res.ok) return err(res.error);
      return finish(res.value.text, spec, routes);
    },
  };
}
