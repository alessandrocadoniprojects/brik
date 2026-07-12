/**
 * Sorgente immagini stock (Pexels) — con Image Quality Guard v1 (Fase 3.1).
 *
 * Usata SOLO lato server, in fase di generazione: il generatore emette segnaposto
 * <img data-brik-img="parola chiave"> e il risolutore (project/images.ts) chiama
 * questa sorgente per ottenere l'URL pubblico della foto, che finisce nell'HTML.
 * La chiave Pexels resta nel server (PEXELS_API_KEY), mai nei siti.
 *
 * Guard v1: invece di prendere ciecamente il primo risultato (per_page=1), si
 * scaricano più candidati e si scarta tutto ciò che, dai METADATI testuali (alt e
 * slug dell'url), sembra contenere loghi, watermark, branding di piattaforme stock,
 * screenshot o contenuti palesemente fuori tema. Niente vision/LLM: il filtro è
 * euristico sui metadati, alza il pavimento ma non garantisce l'assenza di un logo
 * dipinto nei pixel. Politica: meglio nessuna immagine che un'immagine sporca.
 *
 * Licenza Pexels: uso libero, attribuzione non obbligatoria.
 */
export interface ImageSource {
  /** Restituisce l'URL di una foto pertinente e pulita, o null se non disponibile. `ctx` (facoltativo) e' un'etichetta del sito, usata solo nei log. */
  search(query: string, ctx?: string): Promise<string | null>;
}

/** Candidato Pexels con i metadati che ci servono per filtrare. */
export interface PexelsPhoto {
  readonly src?: { readonly landscape?: string; readonly large?: string; readonly medium?: string; readonly original?: string };
  readonly alt?: string;
  readonly url?: string;
  readonly width?: number;
  readonly height?: number;
  readonly photographer?: string;
}
interface PexelsResponse {
  readonly photos?: readonly PexelsPhoto[];
}

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

const CANDIDATES = 14;

// --- Rate limit / retry verso Pexels (quota free: ~200 richieste/ora) ---
// Tutte le chiamate passano da un limiter condiviso che tiene il ritmo sotto la
// quota; sul 429 si ritenta con backoff esponenziale. Configurabili via env.
const PEXELS_MAX_PER_HOUR = Number(process.env.PEXELS_MAX_PER_HOUR ?? 180); // < 200 di quota
const RETRY_ATTEMPTS = Math.max(1, Number(process.env.PEXELS_RETRY_ATTEMPTS ?? 3));
const PEXELS_BACKOFF_MS = Number(process.env.PEXELS_BACKOFF_MS ?? 1000); // base backoff: 1s, 2s, 4s...
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Limiter a finestra scorrevole: al massimo `maxPerHour` esecuzioni per ogni
 * finestra `windowMs`, con acquisizione degli slot serializzata (niente race sui
 * timestamp). Le esecuzioni possono comunque sovrapporsi una volta ottenuto lo
 * slot. Esportato per il riuso da script esterni (es. lo script di re-fill).
 */
export function makeRateLimiter(maxPerHour: number, windowMs = 3_600_000): <T>(fn: () => Promise<T>) => Promise<T> {
  const stamps: number[] = [];
  let tail: Promise<void> = Promise.resolve();
  return function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const slot = tail.then(async () => {
      for (;;) {
        const now = Date.now();
        while (stamps.length && now - stamps[0]! >= windowMs) stamps.shift();
        if (stamps.length < maxPerHour) { stamps.push(now); return; }
        await sleep(windowMs - (now - stamps[0]!) + 50);
      }
    });
    tail = slot.then(() => undefined, () => undefined);
    return slot.then(() => fn());
  };
}

// Limiter condiviso da tutte le ImageSource Pexels del processo (un solo budget/ora).
const pexelsLimiter = makeRateLimiter(PEXELS_MAX_PER_HOUR);

// Token/frasi vietati: se compaiono in alt o nello slug dell'url, scarto il candidato.
// "logo" è volutamente incluso: può scartare immagini valide per query creative, ma
// preferiamo evitare loghi non pertinenti che pubblicare branding stock visibile.
const DIRTY_TERMS: readonly string[] = [
  'pexels logo', 'unsplash logo', 'shutterstock', 'getty', 'istock', 'adobe stock',
  'watermark', 'stock photo', 'screenshot', 'advertisement', 'billboard',
  'logo wall', 'brand logo', 'logo', 'trademark', 'social media logo',
  'app screenshot', 'website screenshot',
];

// Stopword comuni (EN+IT) ignorate nel controllo di topicalità.
const STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'for', 'with', 'to', 'at', 'by', 'from',
  'photo', 'photos', 'image', 'images', 'picture', 'pictures', 'di', 'e', 'la', 'il', 'lo',
  'un', 'una', 'dei', 'delle', 'con', 'per', 'su', 'da', 'del', 'della',
]);

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Slug leggibile dall'url della pagina Pexels (es. .../photo/brand-logo-on-wall-123/). */
function slugText(url?: string): string {
  if (!url) return '';
  const m = url.match(/\/photo\/([^/?#]+)/i);
  const raw = m && m[1] ? m[1] : url;
  return raw.replace(/-\d+$/, '').replace(/[-_]+/g, ' ');
}

/** Token di contenuto: minuscoli, senza stopword, lunghezza >= 3. */
function contentTokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Vero se il candidato va scartato in base ai metadati testuali (alt + slug url).
 * Pura e senza rete.
 */
export function isDirtyCandidate(photo: PexelsPhoto): boolean {
  const hay = ((photo.alt ?? '') + ' ' + slugText(photo.url)).toLowerCase();
  if (!hay.trim()) return false; // nessun metadato: non posso giudicarlo sporco da qui
  return DIRTY_TERMS.some((term) => new RegExp('\\b' + escapeRe(term) + '\\b', 'i').test(hay));
}

/** Topicalità non aggressiva: scarta solo i mismatch evidenti (zero overlap). */
function isOffTopic(photo: PexelsPhoto, query: string): boolean {
  const q = contentTokens(query);
  if (!q.length) return false;
  const a = contentTokens((photo.alt ?? '') + ' ' + slugText(photo.url));
  if (!a.length) return false; // nessun testo: lascio decidere al solo filtro "dirty"
  return !q.some((t) => a.includes(t));
}

function bestSrc(photo: PexelsPhoto): string | null {
  const raw = photo.src?.landscape ?? photo.src?.large ?? photo.src?.medium ?? photo.src?.original ?? null;
  if (!raw) return null;
  const base = raw.split("?")[0];
  return base + "?auto=compress&cs=tinysrgb&w=1200";
}

/**
 * Sceglie il primo candidato pulito e in tema; null se nessuno passa. Pura.
 */
export function pickCleanPhoto(photos: readonly PexelsPhoto[], query: string): string | null {
  for (const p of photos) {
    if (isDirtyCandidate(p)) continue;
    if (isOffTopic(p, query)) continue;
    const src = bestSrc(p);
    if (src) return src;
  }
  return null;
}

/**
 * Ripulisce la query per il fallback: toglie i token vietati e qualche token
 * rumoroso, mantenendo il soggetto. Se non resta nulla, torna la query originale.
 */
export function cleanImageQuery(query: string): string {
  const q = query.trim();
  if (!q) return q;
  // Solo token-artefatto/piattaforma: NON rimuovo parole-soggetto come "brand",
  // "identity", "studio" (altrimenti il fallback perde il tema).
  const noise = new Set<string>([
    'logo', 'logos', 'watermark', 'screenshot', 'advertisement', 'billboard', 'trademark',
    'shutterstock', 'getty', 'istock', 'adobe', 'unsplash', 'pexels',
    'stock', 'photo', 'photos', 'image', 'images', 'picture', 'pictures', 'hd', '4k',
  ]);
  const kept = (q.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !noise.has(t));
  const cleaned = kept.join(' ').trim();
  return cleaned.length >= 2 ? cleaned : q;
}

export function makePexelsImageSource(opts: { readonly apiKey?: string; readonly fetchImpl?: FetchLike } = {}): ImageSource {
  const key = opts.apiKey ?? process.env.PEXELS_API_KEY;
  const doFetch: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init) as unknown as Promise<{ ok: boolean; json: () => Promise<unknown> }>);

  /**
   * Scarica i candidati per una query. Distingue i tre esiti che prima
   * collassavano tutti in [] silenzioso: successo, 429 (rate limit) e altro-errore.
   * Ogni chiamata passa dal rate limiter condiviso; sul 429 ritenta con backoff
   * esponenziale. Ogni fallimento e' loggato su stdout.
   */
  async function candidates(query: string): Promise<{ photos: PexelsPhoto[]; rateLimited: boolean }> {
    const q = query.trim();
    if (!key || !q) return { photos: [], rateLimited: false };
    const url = 'https://api.pexels.com/v1/search?per_page=' + CANDIDATES + '&orientation=landscape&query=' + encodeURIComponent(q);
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      let res: { ok: boolean; status?: number; json: () => Promise<unknown> };
      try {
        res = await pexelsLimiter(() => doFetch(url, { headers: { Authorization: key! } }));
      } catch (e) {
        console.log('  ✗ pexels fetch error query="' + q + '": ' + (e instanceof Error ? e.message : String(e)));
        return { photos: [], rateLimited: false };
      }
      if (res.status === 429) {
        if (attempt < RETRY_ATTEMPTS) {
          const backoff = PEXELS_BACKOFF_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s...
          console.log('  ⏳ pexels 429 query="' + q + '" tentativo ' + attempt + '/' + RETRY_ATTEMPTS + ', attendo ' + backoff + 'ms');
          await sleep(backoff);
          continue;
        }
        console.log('  ✗ pexels 429 query="' + q + '": esauriti ' + RETRY_ATTEMPTS + ' tentativi');
        return { photos: [], rateLimited: true };
      }
      if (!res.ok) {
        console.log('  ✗ pexels HTTP ' + (res.status ?? '?') + ' query="' + q + '"');
        return { photos: [], rateLimited: false };
      }
      try {
        const data = (await res.json()) as PexelsResponse;
        return { photos: Array.isArray(data.photos) ? [...data.photos] : [], rateLimited: false };
      } catch {
        console.log('  ✗ pexels JSON invalido query="' + q + '"');
        return { photos: [], rateLimited: false };
      }
    }
    return { photos: [], rateLimited: true };
  }

  return {
    async search(query: string, ctx?: string): Promise<string | null> {
      const q = query.trim();
      if (!key || !q) return null;
      // 1) candidati per la query originale → primo pulito e in tema.
      const r1 = await candidates(q);
      const first = pickCleanPhoto(r1.photos, q);
      if (first) return first;
      // 2) fallback con query ripulita (se diversa e se non gia' rate-limited: inutile insistere sul 429).
      let rateLimited = r1.rateLimited;
      const fb = cleanImageQuery(q);
      if (!rateLimited && fb && fb.toLowerCase() !== q.toLowerCase()) {
        const r2 = await candidates(fb);
        const second = pickCleanPhoto(r2.photos, fb);
        if (second) return second;
        rateLimited = r2.rateLimited;
      }
      // 3) niente di pulito: log del motivo, poi null (images.ts rimuove il tag).
      const reason = rateLimited ? 'RATE_LIMITED_429' : (r1.photos.length ? 'NO_CLEAN_MATCH' : 'NO_RESULTS');
      console.log('  ✗ pexels miss' + (ctx ? ' site="' + ctx + '"' : '') + ' query="' + q + '" reason=' + reason);
      return null;
    },
  };
}

/** Sorgente neutra (nessuna chiave): nessuna immagine. */
export function makeNullImageSource(): ImageSource {
  return { async search() { return null; } };
}
