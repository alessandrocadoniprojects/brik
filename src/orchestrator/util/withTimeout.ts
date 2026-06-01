import { type Result, err, appError } from '@core';

/**
 * Avvolge un'operazione con un timeout. Se scade, ritorna un AppError
 * retryable invece di restare appesa — gli agenti possono bloccarsi e
 * non vogliamo far attendere l'utente all'infinito.
 */
export async function withTimeout<T>(
  op: () => Promise<Result<T>>,
  ms: number,
  label: string,
): Promise<Result<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<T>>((resolve) => {
    timer = setTimeout(
      () => resolve(err(appError('TIMEOUT', `Timeout in ${label} dopo ${ms}ms.`, { retryable: true }))),
      ms,
    );
  });
  try {
    return await Promise.race([op(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
