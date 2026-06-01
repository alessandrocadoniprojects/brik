import { type Result, type AppError, appError } from '@core';

/**
 * Ritenta un'operazione che ritorna Result, solo se l'errore è retryable.
 * Backoff esponenziale semplice. La versione completa (jitter, circuit
 * breaker) arriva in Fase 6; qui teniamo la forma giusta fin da subito.
 */
export async function withRetry<T>(
  op: () => Promise<Result<T>>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<Result<T>> {
  const retries = opts.retries ?? 2;
  const baseDelay = opts.baseDelayMs ?? 200;

  let last: Result<T> | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await op();
    if (last.ok) return last;
    if (!last.error.retryable) return last;
    if (attempt < retries) {
      await sleep(baseDelay * 2 ** attempt);
    }
  }
  return last as Result<T, AppError>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const exhausted = (cause: unknown): AppError =>
  appError('RETRIES_EXHAUSTED', 'Operazione fallita dopo i tentativi previsti.', { cause });
