/**
 * Adapter Anthropic (LLM reale).
 *
 * Pronto come codice, ma NON testabile in questo ambiente (serve la tua
 * ANTHROPIC_API_KEY e rete verso api.anthropic.com nel tuo deploy).
 * Implementa la stessa porta LLMProvider del mock: per passare dal mock al
 * reale basta iniettare questo adapter nella pipeline.
 *
 * Il mapping tier→modello è centralizzato qui: cambiare modello (o passare a
 * un altro provider) non tocca il resto del codice.
 */

import { type LLMProvider, type LLMRequest, type LLMResponse, type Result, ok, err, appError } from '@core';

const MODEL_BY_TIER: Record<NonNullable<LLMRequest['tier']>, string> = {
  fast: 'claude-haiku-4-5-20251001',
  balanced: 'claude-sonnet-4-6',
  strong: 'claude-opus-4-7',
};

export interface AnthropicConfig {
  readonly apiKey: string;
  readonly baseUrl?: string; // default: https://api.anthropic.com
}

export function makeAnthropicLLM(config: AnthropicConfig): LLMProvider {
  const baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
  return {
    name: 'anthropic',
    async complete(input: LLMRequest): Promise<Result<LLMResponse>> {
      const model = MODEL_BY_TIER[input.tier ?? 'balanced'];
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
    },
  };
}
