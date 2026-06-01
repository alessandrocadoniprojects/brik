/**
 * Logger minimale strutturato. In Fase 6 diventa logging con trace
 * complete (necessario col non-determinismo degli LLM). Qui teniamo
 * un'interfaccia stabile così il resto del codice non cambia dopo.
 */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export const consoleLogger = (traceId: string): Logger => ({
  info: (msg, meta) => console.log(`[${traceId}] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[${traceId}] ${msg}`, meta ?? ''),
});
