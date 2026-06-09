/**
 * Foto caricate dall'utente (punto 2 — fase immagini).
 *
 * Il generatore inserisce segnaposto CORTI `<img data-brik-img="user:N">`: così
 * l'HTML salvato resta leggero e il prompt di edit non si gonfia. I byte delle
 * foto stanno su disco (data/assets/<id>/N.<ext> + manifest.json). Solo al
 * momento di SERVIRE la preview o DEPLOYARE si materializzano in data-URI
 * inline, evitando di toccare l'interfaccia di hosting/wrangler.
 *
 * Le foto arrivano già ridimensionate dal browser (canvas), quindi qui non
 * serve alcuna libreria di immagini: si salvano e basta.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SitePage } from '@core';

export interface PhotoDescriptor {
  readonly id: string;
  readonly alt?: string;
}
interface PhotoRecord {
  readonly id: string;
  readonly ext: string;
  readonly mime: string;
  readonly alt?: string;
}
export interface UploadedImage {
  readonly mime: string;
  readonly alt?: string;
  readonly bytes: Buffer;
}
export interface AssetStore {
  /** Salva nuove foto (accodandole alle esistenti). Ritorna l'elenco COMPLETO dei descrittori. */
  saveImages(id: string, items: readonly UploadedImage[]): PhotoDescriptor[];
  /** Elenco descrittori (id + alt) per il prompt del generatore. */
  listPhotos(id: string): PhotoDescriptor[];
  /** Sostituisce i segnaposto `user:N` con data-URI inline; rimuove quelli senza file. */
  materialize(pages: readonly SitePage[], id: string): SitePage[];
  hasPhotos(id: string): boolean;
}

const USER_IMG = /<img\b[^>]*?\bdata-brik-img="user:([^"]+)"[^>]*?>/gi;

function extFromMime(mime: string): string | null {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  if (m === 'image/gif') return 'gif';
  return null;
}
function mimeFromExt(ext: string): string {
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
}

export function makeAssetStore(baseDir: string): AssetStore {
  const dirOf = (id: string) => join(baseDir, id);
  const manifestOf = (id: string) => join(dirOf(id), 'manifest.json');

  function readManifest(id: string): PhotoRecord[] {
    const p = manifestOf(id);
    if (!existsSync(p)) return [];
    try {
      const data = JSON.parse(readFileSync(p, 'utf8')) as unknown;
      if (!Array.isArray(data)) return [];
      return data.filter((r): r is PhotoRecord => !!r && typeof (r as PhotoRecord).id === 'string' && typeof (r as PhotoRecord).ext === 'string');
    } catch {
      return [];
    }
  }

  function saveImages(id: string, items: readonly UploadedImage[]): PhotoDescriptor[] {
    const dir = dirOf(id);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const manifest = readManifest(id);
    let n = manifest.length;
    for (const it of items) {
      const ext = extFromMime(it.mime);
      if (!ext || !it.bytes || it.bytes.length === 0) continue;
      n += 1;
      const recId = String(n);
      writeFileSync(join(dir, recId + '.' + ext), it.bytes);
      manifest.push({ id: recId, ext, mime: mimeFromExt(ext), ...(it.alt && it.alt.trim() ? { alt: it.alt.trim().slice(0, 160) } : {}) });
    }
    writeFileSync(manifestOf(id), JSON.stringify(manifest));
    return manifest.map((r) => ({ id: r.id, ...(r.alt ? { alt: r.alt } : {}) }));
  }

  function listPhotos(id: string): PhotoDescriptor[] {
    return readManifest(id).map((r) => ({ id: r.id, ...(r.alt ? { alt: r.alt } : {}) }));
  }

  function hasPhotos(id: string): boolean {
    return readManifest(id).length > 0;
  }

  function materialize(pages: readonly SitePage[], id: string): SitePage[] {
    const manifest = readManifest(id);
    if (manifest.length === 0) {
      // niente foto: togli eventuali segnaposto orfani per non lasciare img rotte
      return pages.map((p) => ({ ...p, html: p.html.replace(USER_IMG, '') }));
    }
    const byId = new Map(manifest.map((r) => [r.id, r] as const));
    const dir = dirOf(id);
    const cache = new Map<string, string>(); // id -> data-uri (una sola lettura per foto)
    return pages.map((p) => {
      USER_IMG.lastIndex = 0;
      const html = p.html.replace(USER_IMG, (tag: string, ref: string) => {
        const rec = byId.get((ref ?? '').trim());
        if (!rec) return '';
        let dataUri = cache.get(rec.id);
        if (dataUri === undefined) {
          try {
            const b64 = readFileSync(join(dir, rec.id + '.' + rec.ext)).toString('base64');
            dataUri = 'data:' + rec.mime + ';base64,' + b64;
          } catch {
            dataUri = '';
          }
          cache.set(rec.id, dataUri);
        }
        if (!dataUri) return '';
        const hasAlt = /\salt="/i.test(tag);
        return tag
          .replace(/\sdata-brik-img="[^"]*"/i, '')
          .replace(/<img\b/i, '<img src="' + dataUri + '" loading="lazy"' + (hasAlt || !rec.alt ? '' : ' alt="' + rec.alt.replace(/"/g, '&quot;') + '"'));
      });
      return { ...p, html };
    });
  }

  return { saveImages, listPhotos, materialize, hasPhotos };
}
