/**
 * Verifica di raggiungibilità del sito pubblicato.
 *
 * Dopo il deploy su Cloudflare Pages c'è una finestra di propagazione in cui l'URL
 * risponde 522/Host Error. Il server NON deve dichiarare "pubblicato" un sito non
 * raggiungibile: publishProject usa waitUntilOnline prima di rispondere al client,
 * e l'endpoint GET /api/projects/:id/online usa isOnline per il poll di riserva.
 */

export type OnlineResult = { online: boolean; status?: number };

/** Una singola verifica: GET sull'URL, online = 2xx/3xx. Mai throw. */
export async function isOnline(url: string, timeoutMs = 6000): Promise<OnlineResult> {
  try {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), timeoutMs);
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'cache-control': 'no-cache' },
    });
    clearTimeout(tm);
    return { online: resp.status >= 200 && resp.status < 400, status: resp.status };
  } catch {
    return { online: false };
  }
}

/**
 * Polla l'URL finché non risponde o scade il budget. True al primo esito positivo.
 * Best-effort: non lancia mai; false = "non ancora raggiungibile entro maxMs".
 */
export async function waitUntilOnline(
  url: string,
  opts: { maxMs?: number; stepMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const maxMs = opts.maxMs ?? 60_000;
  const stepMs = opts.stepMs ?? 3_000;
  const t0 = Date.now();
  for (;;) {
    const r = await isOnline(url, opts.timeoutMs);
    if (r.online) return true;
    if (Date.now() - t0 + stepMs > maxMs) return false;
    await new Promise((res) => setTimeout(res, stepMs));
  }
}
