/**
 * Classificatore intake REALE (Anthropic) — versione robusta.
 *
 *  1. TOOL-USE: il modello compila uno schema (campi esatti per tipo), niente JSON libero.
 *  2. "not-verifiable": opzione esplicita per frasi soggettive → vengono SEGNALATE.
 *  3. VALIDAZIONE per tipo + RI-CHIESTA una volta; se ancora invalido → segnalato (null).
 *  4. RETRY automatico sugli errori di rete/transitori (la classificazione guida la
 *     verifica: un intoppo non deve trasformarsi in un criterio mancante).
 *
 * Usa un modello capace (Sonnet) perché una classificazione sbagliata = criterio
 * non testato. Autosufficiente: chiamata HTTP con tool-use, nessuna dipendenza esterna.
 */

import {
  type IntakeClassifier,
  type CheckSpec,
  type Result,
  ok,
  err,
  appError,
} from '@core';

const KIND_ENUM = [
  'content-present',
  'route-loads',
  'navigation',
  'form-submission',
  'responsive',
  'not-verifiable',
];

const MODEL = 'claude-sonnet-4-6';

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: KIND_ENUM, description: 'Tipo di criterio, o "not-verifiable" se soggettivo/non verificabile.' },
    route: { type: 'string', description: 'Percorso pagina (es. "/"). Usa una route nota.' },
    text: { type: 'string', description: 'Solo content-present: testo che deve comparire.' },
    fromRoute: { type: 'string', description: 'Solo navigation: pagina di partenza.' },
    linkText: { type: 'string', description: 'Solo navigation: testo del link da cliccare.' },
    toRoutePattern: { type: 'string', description: 'Solo navigation: pattern della destinazione.' },
    fields: {
      type: 'array',
      description: 'Solo form-submission: campi da compilare.',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'string' } },
        required: ['label', 'value'],
      },
    },
    expect: { type: 'string', enum: ['confirmation-visible'], description: 'Solo form-submission.' },
    confirmationText: { type: 'string', description: 'Solo form-submission: testo di conferma dopo invio.' },
  },
  required: ['kind'],
};

const SYSTEM = `Classifichi la frase di un utente non-tecnico in UN criterio verificabile, usando lo strumento set_criterion.
Scegli il "kind" giusto e COMPILA TUTTI i campi richiesti per quel tipo:
- content-present: route, text
- form-submission: route, fields (almeno 1, con label e value plausibili), expect="confirmation-visible", confirmationText
- responsive: route
- navigation: fromRoute, linkText, toRoutePattern
- route-loads: route
Se la frase descrive un form/contatti/prenotazione con un esito dopo l'invio, usa SEMPRE form-submission e DEDUCI campi ragionevoli (es. nome, email, messaggio) anche se non elencati esplicitamente.
Per "route"/"fromRoute" usa ESCLUSIVAMENTE una delle Route note indicate; se c'è solo "/", usa sempre "/". Le ancore interne (es. #contatti) NON sono route.
Usa kind="not-verifiable" SOLO per frasi puramente soggettive (es. "tono elegante", "deve piacere", "moderno").`;

interface AnthropicConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

/** Validazione per tipo. Ritorna il criterio normalizzato oppure il motivo dell'errore. */
export function validateCriterion(
  raw: unknown,
  knownRoutes: readonly string[],
): { spec?: CheckSpec; reason?: string } {
  if (!raw || typeof raw !== 'object') return { reason: 'output non valido' };
  const o = raw as Record<string, unknown>;
  const home = knownRoutes[0] ?? '/';
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
  // La route DEVE essere una di quelle note: le ancore interne (#contatti) o le
  // route inventate dal modello vengono riportate alla home (sito a pagina unica → "/").
  const clampRoute = (v: unknown): string => {
    const r = str(v);
    if (!r) return home;
    if (knownRoutes.length === 0 || knownRoutes.includes(r)) return r;
    return home;
  };
  const route = clampRoute(o.route);

  switch (o.kind) {
    case 'content-present': {
      const text = str(o.text);
      return text ? { spec: { kind: 'content-present', route, text } } : { reason: 'manca "text"' };
    }
    case 'route-loads':
      return { spec: { kind: 'route-loads', route } };
    case 'responsive':
      return { spec: { kind: 'responsive', route } };
    case 'navigation': {
      const linkText = str(o.linkText);
      const toRoutePattern = str(o.toRoutePattern);
      if (!linkText || !toRoutePattern) return { reason: 'mancano "linkText"/"toRoutePattern"' };
      return { spec: { kind: 'navigation', fromRoute: clampRoute(o.fromRoute), linkText, toRoutePattern } };
    }
    case 'form-submission': {
      const confirmationText = str(o.confirmationText);
      const fieldsRaw = Array.isArray(o.fields) ? o.fields : [];
      const fields = fieldsRaw
        .map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>) : {}))
        .filter((f) => str(f.label) && str(f.value))
        .map((f) => ({ label: String(f.label), value: String(f.value) }));
      if (fields.length === 0) return { reason: 'mancano i "fields"' };
      if (!confirmationText) return { reason: 'manca "confirmationText"' };
      return { spec: { kind: 'form-submission', route, fields, expect: 'confirmation-visible', confirmationText } };
    }
    case 'not-verifiable':
      return { reason: 'soggettivo/non verificabile' };
    default:
      return { reason: `kind non riconosciuto: ${String(o.kind)}` };
  }
}

const isNotVerifiable = (raw: unknown): boolean =>
  !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).kind === 'not-verifiable';

export function makeAnthropicClassifier(config: AnthropicConfig): IntakeClassifier {
  const baseUrl = config.baseUrl ?? 'https://api.anthropic.com';

  const callTool = async (system: string, prompt: string): Promise<Result<unknown>> => {
    const once = async (): Promise<Result<unknown>> => {
      try {
        const res = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 600,
            system,
            tools: [{ name: 'set_criterion', description: 'Registra il criterio verificabile.', input_schema: TOOL_SCHEMA }],
            tool_choice: { type: 'tool', name: 'set_criterion' },
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!res.ok) {
          const retryable = res.status === 429 || res.status >= 500;
          return err(appError('LLM_HTTP_ERROR', `Anthropic ha risposto ${res.status}.`, { retryable }));
        }
        const data = (await res.json()) as { content?: Array<{ type: string; input?: unknown }> };
        const tool = (data.content ?? []).find((b) => b.type === 'tool_use');
        return ok(tool?.input);
      } catch (cause) {
        return err(appError('LLM_NETWORK_ERROR', 'Chiamata ad Anthropic fallita.', { cause, retryable: true }));
      }
    };
    // retry sui transitori (rete/429/5xx)
    let last: Result<unknown> | undefined;
    for (let i = 0; i <= 4; i++) {
      last = await once();
      if (last.ok || !last.error.retryable) return last;
      if (i < 4) await new Promise<void>((r) => setTimeout(r, Math.min(500 * 2 ** i, 3000)));
    }
    return last as Result<unknown>;
  };

  return {
    async classify(statement, context): Promise<Result<CheckSpec | null>> {
      const base = `Route note: ${context.knownRoutes.join(', ') || '/'}
Categoria: ${context.category}
Frase utente: "${statement}"`;

      const first = await callTool(SYSTEM, base);
      if (!first.ok) return err(first.error);
      if (isNotVerifiable(first.value)) return ok(null);
      const v1 = validateCriterion(first.value, context.knownRoutes);
      if (v1.spec) return ok(v1.spec);

      // Ri-chiesta una volta, segnalando cosa mancava.
      const second = await callTool(
        SYSTEM,
        `${base}\nIl tentativo precedente non era valido: ${v1.reason}. Compila TUTTI i campi richiesti per il tipo.`,
      );
      if (!second.ok) return err(second.error);
      if (isNotVerifiable(second.value)) return ok(null);
      const v2 = validateCriterion(second.value, context.knownRoutes);
      return ok(v2.spec ?? null);
    },
  };
}
