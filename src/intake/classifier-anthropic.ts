/**
 * Classificatore intake REALE (via LLMProvider, es. Anthropic).
 *
 * L'LLM fa il compito affidabile: classificare la frase dell'utente in uno dei
 * tipi noti ed estrarne i parametri, restituendo JSON. NON scrive test.
 * Se non è riconducibile a un tipo noto, restituisce null → il criterio viene
 * segnalato all'utente. Pronto come codice; testabile nel tuo ambiente.
 */

import {
  type IntakeClassifier,
  type LLMProvider,
  type CheckSpec,
  type CheckKind,
  type Result,
  ok,
  err,
  appError,
} from '@core';

const KNOWN_KINDS: readonly CheckKind[] = [
  'content-present',
  'route-loads',
  'navigation',
  'form-submission',
  'responsive',
];

const SYSTEM = `Sei un classificatore. Data una frase di un utente non-tecnico che descrive cosa deve fare il suo sito, restituisci ESCLUSIVAMENTE un JSON con un criterio verificabile, scegliendo tra questi tipi: ${KNOWN_KINDS.join(', ')}.
Se la frase non è riconducibile a un tipo noto, restituisci {"kind":"none"}.
Non aggiungere testo fuori dal JSON. Usa le route note fornite nel contesto.`;

export function makeAnthropicClassifier(llm: LLMProvider): IntakeClassifier {
  return {
    async classify(statement, context): Promise<Result<CheckSpec | null>> {
      const prompt = `Route note: ${context.knownRoutes.join(', ') || '/'}
Categoria progetto: ${context.category}
Frase utente: "${statement}"
Rispondi con il JSON del criterio.`;

      const res = await llm.complete({ system: SYSTEM, prompt, tier: 'fast', maxTokens: 500 });
      if (!res.ok) return err(res.error);

      const parsed = safeParse(res.value.text);
      if (parsed === undefined) {
        return err(appError('INTAKE_PARSE_ERROR', 'Risposta del classificatore non in JSON valido.', { retryable: true }));
      }
      if (parsed.kind === 'none' || !KNOWN_KINDS.includes(parsed.kind as CheckKind)) {
        return ok(null);
      }
      // Nota: in produzione si valida lo shape con uno schema (es. zod) prima
      // di fidarsi dei parametri. Qui restituiamo il criterio tipizzato.
      return ok(parsed as unknown as CheckSpec);
    },
  };
}

function safeParse(text: string): { kind?: string } | undefined {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]) as { kind?: string };
  } catch {
    return undefined;
  }
}
