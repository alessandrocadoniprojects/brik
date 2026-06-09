/**
 * Estrazione testo dagli allegati (punto 2 — fase TESTO).
 *
 * Riceve i byte di un file caricato dall'utente e ne ricava il TESTO grezzo, che
 * il flusso di create usa come `spec.content` (contenuti reali, non placeholder).
 * Niente immagini qui: solo testo. Tipi supportati:
 *   - txt / md / csv / generico text/*  -> decodifica UTF-8
 *   - pdf                               -> unpdf (pdfjs serverless, testo per pagina)
 *   - docx                              -> mammoth (extractRawText)
 *
 * Tutto lato server, in locale: nessuna chiave né rete esterna.
 */
import mammoth from 'mammoth';

export type IngestKind = 'text' | 'pdf' | 'docx';

export interface ExtractResult {
  readonly kind: IngestKind;
  readonly text: string;
  readonly chars: number;
  readonly truncated: boolean;
}

/** Tetto per singolo allegato (il tetto complessivo lo applica la create). */
export const PER_SOURCE_MAX = 12_000;

function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clamp(raw: string): { text: string; truncated: boolean } {
  const t = tidy(raw);
  if (t.length <= PER_SOURCE_MAX) return { text: t, truncated: false };
  const cut = t.slice(0, PER_SOURCE_MAX);
  const brk = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return { text: (brk > PER_SOURCE_MAX * 0.6 ? cut.slice(0, brk) : cut).trim(), truncated: true };
}

/** PDF -> testo (pagine unite). */
async function pdfToText(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join('\n\n') : text;
}

function extOf(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

/** Estrae il testo da un allegato. Lancia se il formato non è gestibile. */
export async function extractAttachmentText(name: string, mime: string, buf: Buffer): Promise<ExtractResult> {
  const ext = extOf(name);
  const m = (mime || '').toLowerCase();

  if (ext === 'pdf' || m === 'application/pdf') {
    const { text, truncated } = clamp(await pdfToText(buf));
    return { kind: 'pdf', text, chars: text.length, truncated };
  }
  if (ext === 'docx' || m.includes('officedocument.wordprocessingml')) {
    const out = await mammoth.extractRawText({ buffer: buf });
    const { text, truncated } = clamp(out.value);
    return { kind: 'docx', text, chars: text.length, truncated };
  }
  if (ext === 'doc') {
    throw new Error('Il vecchio formato .doc non è supportato: salva come .docx o PDF.');
  }
  if (
    ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'csv' || ext === 'text' ||
    m.startsWith('text/') || m === 'application/json'
  ) {
    const { text, truncated } = clamp(buf.toString('utf8'));
    return { kind: 'text', text, chars: text.length, truncated };
  }
  throw new Error('Formato non supportato (' + (ext || m || 'sconosciuto') + '). Usa testo, PDF o Word (.docx).');
}
