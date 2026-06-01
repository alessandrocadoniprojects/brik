/**
 * Result<T, E> — esito tipizzato senza eccezioni nascoste.
 *
 * Tutte le operazioni che possono fallire (chiamate a LLM, build, deploy)
 * ritornano un Result, così l'orchestratore gestisce gli errori in modo
 * esplicito invece di affidarsi a try/catch sparsi. È la base per il
 * comportamento resiliente che indurremo in Fase 6.
 */

export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Errore applicativo con codice macchina + messaggio umano. */
export interface AppError {
  /** Codice stabile per logica/telemetria (es. "LLM_TIMEOUT"). */
  readonly code: string;
  /** Messaggio leggibile (per log; NON da mostrare grezzo all'utente non-tecnico). */
  readonly message: string;
  /** Causa sottostante, se presente. */
  readonly cause?: unknown;
  /** Se l'operazione è ritentabile (usato da withRetry). */
  readonly retryable?: boolean;
}

export const appError = (
  code: string,
  message: string,
  opts: { cause?: unknown; retryable?: boolean } = {},
): AppError => ({ code, message, ...opts });
