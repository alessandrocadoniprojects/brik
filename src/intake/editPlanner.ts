/**
 * Pianificatore di MODIFICA (Fase 3 / tappa 2 — solidita).
 *
 * Traduce una richiesta di modifica in operazioni sul CONTRATTO di verifica:
 *  - add: nuovo requisito verificabile
 *  - change: sostituisce un requisito esistente (per numero)
 *  - remove: toglie un requisito esistente (per numero)
 *
 * Cosi una modifica non e piu "non ho rotto il vecchio contratto" ma diventa
 * "ho ottenuto ciò che hai chiesto", perche i criteri nuovi vengono poi verificati
 * dalla QA come quelli della creazione. I parser deterministici del pianificatore
 * (testi tra virgolette, elenchi etichettati) fanno da rete di sicurezza: cio che
 * l'utente cita esplicitamente diventa comunque un criterio, anche se l'LLM lo perde.
 */
import {
  type ProjectSpec,
  type AcceptanceCriterion,
  type CheckSpec,
  type LLMProvider,
  type Result,
  ok,
  err,
} from '@core';
import type { RouteInfo } from '../adapters/anthropic/siteGenerator.js';
import { validateCriterion } from './classifier-anthropic.js';
import { extractQuoted, extractLabeledLists } from './sitePlanner.js';

const norm = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const MEDIA_NOUN = /^(foto|immagine|immagini|logo|loghi|galleria|gallery|carosello|carousel|slideshow|video|mappa|map|icona|icone|sfondo|banner|grafica|illustrazione)\b/;
/** Un testo che DESCRIVE un media (es. "una foto delle proprietarie") non e un criterio di testo verificabile. */
const isMediaDescriptor = (text: string): boolean =>
  MEDIA_NOUN.test(norm(text).replace(/^(?:un|una|uno|il|lo|la|i|gli|le|l)(?:['’]|\s+)/, ''));

const SYSTEM = [
  'Sei un assistente che traduce una richiesta di MODIFICA di un sito in operazioni sul contratto di verifica.',
  'Operazioni ammesse: "add" (nuovo requisito verificabile), "change" (sostituisci un requisito esistente), "remove" (togli un requisito esistente).',
  'Per "change" e "remove" indica "target" = il NUMERO del requisito attuale (quello tra parentesi quadre).',
  'Tipi (kind): content-present (route, text), form-submission (route, fields[] con label e value, confirmationText), responsive (route). NON usare "navigation": la navigazione tra le pagine e automatica.',
  'Usa SOLO le route note. Riporta i testi tra virgolette IDENTICI a come li scrive l\'utente.',
  'Se la richiesta e SOLO estetica (colori, dimensioni, posizioni, font) restituisci operations: [].',
  '"content-present" vale SOLO per TESTO leggibile che deve comparire (slogan, nome, prezzo, voce di menu). NON descrivere un media come se fosse testo.',
  'Richieste su MEDIA/EMBED (foto, immagine, logo, galleria, video, mappa, icona, sfondo) NON sono criteri di testo: se la modifica aggiunge/cambia/sposta un media o un embed (e non un testo specifico da scrivere), restituisci operations: []. La modifica viene comunque applicata e protetta dai criteri esistenti.',
  'Rispondi SOLO con JSON valido (nessun markdown):',
  '{"operations":[{"op":"add","kind":"content-present","route":"/menu","text":"Capricciosa"}]}',
  'Esempio media: richiesta "inserisci una foto del proprietario nella sezione chi siamo" -> {"operations":[]}.',
  'Per sostituire (es. "cambia lo slogan in X") usa "change" col target del requisito attuale: {"operations":[{"op":"change","target":2,"kind":"content-present","route":"/","text":"X"}]}.',
].join('\n');

function stripToJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return s;
}

function checkRoute(k: CheckSpec): string {
  return k.kind === 'navigation' ? k.fromRoute : k.route;
}

function statementFor(c: CheckSpec): string {
  switch (c.kind) {
    case 'content-present':
      return `Mostra "${c.text}"`;
    case 'form-submission':
      return `Form (${c.fields.map((f) => f.label).join(', ')}) conferma "${c.confirmationText}"`;
    case 'responsive':
      return `La pagina ${c.route} si vede bene su mobile`;
    case 'route-loads':
      return `La pagina ${c.route} si apre`;
    case 'navigation':
      return `Dal menu si raggiunge ${c.toRoutePattern}`;
  }
}

export interface EditPlan {
  readonly criteria: readonly AcceptanceCriterion[];
  readonly changes: readonly string[];
}

export async function planEdit(args: {
  readonly instruction: string;
  readonly spec: ProjectSpec;
  readonly routes: readonly RouteInfo[];
  readonly llm: LLMProvider;
}): Promise<Result<EditPlan>> {
  const knownRoutes = args.routes.map((r) => r.route);
  const numbered = args.spec.criteria
    .map((c, i) => `[${i + 1}] (${c.check ? checkRoute(c.check) : '-'}) ${c.statement}`)
    .join('\n');
  const prompt = [
    `Route note: ${knownRoutes.join(', ') || '/'}`,
    'Requisiti attuali:',
    numbered || '(nessuno)',
    '',
    'Richiesta di modifica:',
    args.instruction,
  ].join('\n');

  const res = await args.llm.complete({ system: SYSTEM, prompt, tier: 'balanced', maxTokens: 1200 });
  if (!res.ok) return err(res.error);

  let ops: unknown[] = [];
  try {
    const p = JSON.parse(stripToJson(res.value.text)) as { operations?: unknown };
    ops = Array.isArray(p.operations) ? p.operations : [];
  } catch {
    ops = []; // istruzione non interpretabile come operazioni → nessun cambio strutturale (resta il gate di regressione)
  }

  const working: (AcceptanceCriterion | null)[] = args.spec.criteria.map((c) => ({ ...c }));
  const adds: AcceptanceCriterion[] = [];
  const changes: string[] = [];
  const removeIdx = new Set<number>();

  const idxOf = (t: unknown): number | undefined => {
    const n = typeof t === 'number' ? t : parseInt(String(t), 10);
    return Number.isInteger(n) && n >= 1 && n <= working.length ? n - 1 : undefined;
  };

  for (const raw of ops) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const op = String(o.op ?? '');
    if (op === 'remove') {
      const i = idxOf(o.target);
      if (i === undefined) continue;
      removeIdx.add(i);
      changes.push('rimosso: ' + working[i]!.statement);
      continue;
    }
    if (o.kind === 'navigation') continue; // gestita in automatico
    const v = validateCriterion(o, knownRoutes);
    if (!v.spec) continue;
    if (v.spec.kind === 'content-present' && isMediaDescriptor(v.spec.text)) continue; // media/embed: non e un criterio di testo
    if (op === 'change') {
      const i = idxOf(o.target);
      if (i === undefined) {
        adds.push({ id: 'tmp', statement: statementFor(v.spec), confirmed: true, check: v.spec });
        changes.push('aggiunto: ' + statementFor(v.spec));
        continue;
      }
      working[i] = { ...working[i]!, statement: statementFor(v.spec), check: v.spec };
      changes.push('cambiato: ' + statementFor(v.spec));
    } else {
      adds.push({ id: 'tmp', statement: statementFor(v.spec), confirmed: true, check: v.spec });
      changes.push('aggiunto: ' + statementFor(v.spec));
    }
  }

  const merged: AcceptanceCriterion[] = working.filter((c, i): c is AcceptanceCriterion => c !== null && !removeIdx.has(i));

  const seen = new Set<string>();
  const formRoutes = new Set<string>();
  for (const c of merged) {
    if (c.check?.kind === 'content-present') seen.add(c.check.route + '\u0000' + norm(c.check.text));
    else if (c.check?.kind === 'form-submission') formRoutes.add(c.check.route);
  }
  const pushChecked = (c: AcceptanceCriterion): void => {
    const k = c.check!;
    if (k.kind === 'content-present') {
      const key = k.route + '\u0000' + norm(k.text);
      if (seen.has(key)) return;
      seen.add(key);
    } else if (k.kind === 'form-submission') {
      if (formRoutes.has(k.route)) return;
      formRoutes.add(k.route);
    }
    merged.push(c);
  };
  for (const c of adds) pushChecked(c);

  // Rete di sicurezza deterministica sull'istruzione: quote verbatim + elenchi etichettati.
  const confirmTexts = new Set(
    merged.filter((c) => c.check?.kind === 'form-submission').map((c) => norm((c.check as Extract<CheckSpec, { kind: 'form-submission' }>).confirmationText)),
  );
  const routeForQuoted = (): string => {
    const b = norm(args.instruction);
    let best: { route: string; at: number } | undefined;
    for (const r of args.routes) {
      const lbl = norm(r.label);
      if (!lbl) continue;
      const re = new RegExp('\\b' + lbl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      let m: RegExpExecArray | null;
      let last = -1;
      while ((m = re.exec(b)) !== null) last = m.index;
      if (last >= 0 && (!best || last > best.at)) best = { route: r.route, at: last };
    }
    return best?.route ?? '/';
  };
  for (const { route, text } of extractLabeledLists(args.instruction, args.routes.map((r) => ({ route: r.route, label: r.label })))) {
    if (!knownRoutes.includes(route)) continue;
    if (isMediaDescriptor(text)) continue; // descrittore di media in un elenco: non è un criterio di testo
    const key = route + '\u0000' + norm(text);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ id: 'tmp', statement: `Mostra "${text}"`, confirmed: true, check: { kind: 'content-present', route, text } });
    changes.push('aggiunto: ' + text);
  }
  for (const q of extractQuoted(args.instruction)) {
    const nq = norm(q);
    if (isMediaDescriptor(q)) continue; // citazione che descrive un media: non è testo da mostrare
    if (confirmTexts.has(nq)) continue;
    const route = routeForQuoted();
    const key = route + '\u0000' + nq;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ id: 'tmp', statement: `Mostra "${q}"`, confirmed: true, check: { kind: 'content-present', route, text: q } });
    changes.push('aggiunto: ' + q);
  }

  // Sanatoria: un criterio "content-present" che in realtà descrive un media (es. "una foto delle proprietarie")
  // non è verificabile come testo visibile e bloccherebbe ogni modifica futura sulla sua pagina. Lo scartiamo qui:
  // copre sia i criteri appena dedotti sia quelli GIÀ salvati nella spec (auto-riparazione al primo edit utile).
  const cleaned = merged.filter((c) => !(c.check && c.check.kind === 'content-present' && isMediaDescriptor(c.check.text)));
  const criteria = cleaned.map((c, i) => ({ ...c, id: 'c' + (i + 1) }));
  return ok({ criteria, changes });
}
