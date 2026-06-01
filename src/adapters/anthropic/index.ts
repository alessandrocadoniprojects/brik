/**
 * Adapter Anthropic (LLM reale).
 *
 * Implementa la porta LLMProvider del core e fornisce anche il generatore di
 * codice reale (CodeGenerator). Le chiamate HTTP ritentano automaticamente
 * sugli errori transitori (rete, 429, 5xx): un singolo intoppo non fa fallire
 * la build. Il mapping tier→modello è centralizzato qui.
 */

import {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type CodeGenerator,
  type ProjectSpec,
  type GeneratedProject,
  type Result,
  ok,
  err,
  appError,
} from '@core';

const MODEL_BY_TIER: Record<NonNullable<LLMRequest['tier']>, string> = {
  fast: 'claude-haiku-4-5-20251001',
  balanced: 'claude-sonnet-4-6',
  strong: 'claude-opus-4-7',
};

export interface AnthropicConfig {
  readonly apiKey: string;
  readonly baseUrl?: string; // default: https://api.anthropic.com
}

/** Ritenta un'operazione che ritorna Result finché l'errore è retryable. */
async function retryResult<T>(op: () => Promise<Result<T>>, retries = 4, baseMs = 500): Promise<Result<T>> {
  let last: Result<T> | undefined;
  for (let i = 0; i <= retries; i++) {
    last = await op();
    if (last.ok || !last.error.retryable) return last;
    if (i < retries) await new Promise<void>((r) => setTimeout(r, Math.min(baseMs * 2 ** i, 3000)));
  }
  return last as Result<T>;
}

export function makeAnthropicLLM(config: AnthropicConfig): LLMProvider {
  const baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
  return {
    name: 'anthropic',
    async complete(input: LLMRequest): Promise<Result<LLMResponse>> {
      const model = MODEL_BY_TIER[input.tier ?? 'balanced'];
      return retryResult(async () => {
        try {
          const res = await fetch(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': config.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model,
              max_tokens: input.maxTokens ?? 4096,
              ...(input.system ? { system: input.system } : {}),
              messages: [{ role: 'user', content: input.prompt }],
            }),
          });

          if (!res.ok) {
            const retryable = res.status === 429 || res.status >= 500;
            return err(appError('LLM_HTTP_ERROR', `Anthropic ha risposto ${res.status}.`, { retryable }));
          }

          const data = (await res.json()) as {
            content?: Array<{ type: string; text?: string }>;
            usage?: { input_tokens: number; output_tokens: number };
          };
          const text = (data.content ?? [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join('\n');

          return ok({
            text,
            ...(data.usage
              ? { usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens } }
              : {}),
          });
        } catch (cause) {
          return err(appError('LLM_NETWORK_ERROR', 'Chiamata ad Anthropic fallita.', { cause, retryable: true }));
        }
      });
    },
  };
}

/* ------------------------------------------------------------------ *
 * Generatore di codice REALE.
 * Da uno ProjectSpec (criteri tipizzati) produce UN file HTML
 * autosufficiente. I requisiti del prompt sono DERIVATI dai criteri,
 * cioè dalla stessa fonte che la QA userà per verificare: così codice
 * e test restano coerenti per costruzione.
 * ------------------------------------------------------------------ */

/** Traduce i criteri tipizzati in requisiti concreti per il modello. */
function requirementsFromSpec(spec: ProjectSpec): string {
  const lines: string[] = [];
  for (const c of spec.criteria) {
    const k = c.check;
    if (!k) {
      lines.push(`- (indicazione qualitativa, non vincolante) ${c.statement}`);
      continue;
    }
    switch (k.kind) {
      case 'content-present':
        lines.push(`- La pagina "${k.route}" DEVE contenere il testo ESATTO: "${k.text}".`);
        break;
      case 'route-loads':
        lines.push(`- La pagina "${k.route}" deve caricare correttamente.`);
        break;
      case 'responsive':
        lines.push(
          `- La pagina "${k.route}" deve includere <meta name="viewport" content="width=device-width, initial-scale=1"> ed essere utilizzabile su mobile (375px) senza overflow orizzontale.`,
        );
        break;
      case 'navigation':
        lines.push(
          `- Nella pagina "${k.fromRoute}" un link con testo "${k.linkText}" deve puntare a una URL che corrisponde al pattern ${k.toRoutePattern}.`,
        );
        break;
      case 'form-submission': {
        const fieldList = k.fields.map((f) => `"${f.label}"`).join(', ');
        lines.push(
          `- La pagina "${k.route}" deve contenere un <form> con i campi ${fieldList}, ognuno con una <label> associata (attributo for che punta all'id del campo). Con JavaScript inline, al submit chiama event.preventDefault() e mostra (rendendolo visibile) il messaggio di conferma con testo ESATTO: "${k.confirmationText}".`,
        );
        break;
      }
    }
  }
  return lines.join('\n');
}

/** Estrae l'HTML dalla risposta del modello, togliendo eventuali fence markdown. */
function extractHtml(raw: string): string | null {
  let s = raw.trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.search(/<!doctype html|<html/i);
  if (start === -1) return null;
  return s.slice(start);
}

export function makeAnthropicCodeGenerator(
  llm: LLMProvider,
  opts: { readonly tier?: LLMRequest['tier'] } = {},
): CodeGenerator {
  const tier = opts.tier ?? 'balanced';
  return {
    async generate(spec: ProjectSpec): Promise<Result<GeneratedProject>> {
      const system = [
        'Sei un generatore di siti web. Produci UN SOLO file HTML completo e autosufficiente.',
        'CSS e JavaScript devono essere INLINE: nessuna risorsa esterna (niente CDN, font remoti o immagini esterne).',
        'HTML5 valido: parti con <!DOCTYPE html>, includi <head> con <meta charset="utf-8"> e <meta name="viewport">.',
        'Rispetta TUTTI i requisiti elencati, usando i testi ESATTI dove indicato.',
        'La pagina deve essere UNA sola schermata scrollabile: NIENTE tab o navigazione che nasconde sezioni via JavaScript. Tutti i contenuti e il form devono essere raggiungibili scorrendo (non mettere display:none su sezioni di contenuto o sul form).',
        'Rispondi SOLO con il codice HTML: nessuna spiegazione, nessun blocco markdown.',
      ].join('\n');

      const prompt = [
        `Titolo: ${spec.title}`,
        `Descrizione: ${spec.description}`,
        `Categoria: ${spec.category}`,
        '',
        'Requisiti da rispettare:',
        requirementsFromSpec(spec),
      ].join('\n');

      const res = await llm.complete({ system, prompt, tier, maxTokens: 8192 });
      if (!res.ok) return err(res.error);

      const html = extractHtml(res.value.text);
      if (!html) {
        return err(appError('CODEGEN_EMPTY', 'Il modello non ha prodotto HTML valido.', { retryable: true }));
      }

      return ok({
        specId: spec.id,
        templateId: 'llm-html-v1',
        files: [{ path: 'index.html', contents: html }],
      });
    },
  };
}
