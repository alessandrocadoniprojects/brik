/**
 * Sorgente immagini stock (Pexels).
 *
 * Usata SOLO lato server, in fase di generazione: il generatore emette segnaposto
 * <img data-brik-img="parola chiave"> e il risolutore (project/images.ts) chiama
 * questa sorgente per ottenere l'URL pubblico della foto (images.pexels.com), che
 * finisce nell'HTML. La chiave Pexels resta nel server (PEXELS_API_KEY), mai nei siti.
 *
 * Licenza Pexels: uso libero, attribuzione non obbligatoria.
 */
export interface ImageSource {
  /** Restituisce l'URL di una foto pertinente, o null se non disponibile. */
  search(query: string): Promise<string | null>;
}

interface PexelsPhoto {
  readonly src?: { readonly landscape?: string; readonly large?: string; readonly medium?: string };
}
interface PexelsResponse {
  readonly photos?: readonly PexelsPhoto[];
}

export function makePexelsImageSource(opts: { readonly apiKey?: string } = {}): ImageSource {
  const key = opts.apiKey ?? process.env.PEXELS_API_KEY;
  return {
    async search(query: string): Promise<string | null> {
      const q = query.trim();
      if (!key || !q) return null;
      try {
        const url = 'https://api.pexels.com/v1/search?per_page=1&orientation=landscape&query=' + encodeURIComponent(q);
        const res = await fetch(url, { headers: { Authorization: key } });
        if (!res.ok) return null;
        const data = (await res.json()) as PexelsResponse;
        const p = data.photos?.[0];
        return p?.src?.landscape ?? p?.src?.large ?? p?.src?.medium ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** Sorgente neutra (nessuna chiave): nessuna immagine. */
export function makeNullImageSource(): ImageSource {
  return { async search() { return null; } };
}
