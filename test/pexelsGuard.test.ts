/**
 * Test Fase 3.1 — Image Quality Guard v1 (adapter Pexels).
 * Puri/offline; `search` testato con fetch finto. Lancio: npx tsx --test test/pexelsGuard.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDirtyCandidate, pickCleanPhoto, cleanImageQuery, makePexelsImageSource, type PexelsPhoto } from '../src/adapters/images/pexels.js';

const src = (s: string) => ({ src: { landscape: s } });
const photo = (alt: string, landscape: string, url = ''): PexelsPhoto => ({ alt, url, src: { landscape } });

test('isDirtyCandidate rifiuta watermark/screenshot/stock/logo/piattaforme (alt o url)', () => {
  assert.equal(isDirtyCandidate(photo('image with visible watermark', 'a.jpg')), true);
  assert.equal(isDirtyCandidate(photo('app screenshot of dashboard', 'b.jpg')), true);
  assert.equal(isDirtyCandidate(photo('a stock photo of an office', 'c.jpg')), true);
  assert.equal(isDirtyCandidate(photo('brand logo on white wall', 'd.jpg')), true);
  assert.equal(isDirtyCandidate(photo('design', 'e.jpg', 'https://www.pexels.com/photo/shutterstock-collage-123/')), true);
  assert.equal(isDirtyCandidate(photo('trademark sign closeup', 'f.jpg')), true);
});

test('isDirtyCandidate accetta descrizioni pulite (e non confonde "logo" dentro altre parole)', () => {
  assert.equal(isDirtyCandidate(photo('editorial brand identity mockup on desk', 'a.jpg')), false);
  assert.equal(isDirtyCandidate(photo('typography poster in studio', 'b.jpg')), false);
  assert.equal(isDirtyCandidate(photo('biologo al microscopio', 'c.jpg')), false); // "logo" dentro "biologo": niente match
  assert.equal(isDirtyCandidate(photo('', 'd.jpg')), false); // nessun metadato: non giudicabile come sporco
});

test('pickCleanPhoto scarta il primo sporco e sceglie il secondo pulito', () => {
  const photos: PexelsPhoto[] = [
    photo('app screenshot interface', 'dirty.jpg'),
    photo('packaging mockup studio detail', 'clean.jpg'),
  ];
  assert.equal(pickCleanPhoto(photos, 'packaging mockup'), 'clean.jpg');
});

test('pickCleanPhoto torna null se tutti i candidati sono sporchi', () => {
  const photos: PexelsPhoto[] = [
    photo('brand logo wall', 'a.jpg'),
    photo('getty stock collage', 'b.jpg'),
    photo('website screenshot', 'c.jpg'),
  ];
  assert.equal(pickCleanPhoto(photos, 'brand identity'), null);
});

test('topicalità: scarta un candidato chiaramente fuori tema', () => {
  const photos: PexelsPhoto[] = [
    photo('fresh pizza margherita on table', 'pizza.jpg'),     // fuori tema vs "typography poster"
    photo('typography poster editorial layout', 'poster.jpg'),
  ];
  assert.equal(pickCleanPhoto(photos, 'typography poster'), 'poster.jpg');
});

test('topicalità non aggressiva: se manca overlap ma c\'è un solo candidato in tema lo prende', () => {
  const photos: PexelsPhoto[] = [photo('editorial brand identity layout', 'ok.jpg')];
  assert.equal(pickCleanPhoto(photos, 'brand identity'), 'ok.jpg');
});

test('cleanImageQuery toglie token vietati/rumorosi mantenendo il soggetto', () => {
  assert.equal(cleanImageQuery('brand logo stock photo'), 'brand'); // logo/stock/photo rimossi
  assert.equal(cleanImageQuery('typography poster'), 'typography poster'); // pulita resta uguale
  assert.equal(cleanImageQuery('logo'), 'logo'); // nulla resterebbe → torna originale
});

// --- search() con fetch finto -------------------------------------------------

function fakeFetch(byQuery: Record<string, PexelsPhoto[]>): (input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }> {
  return async (input: string) => {
    const m = input.match(/[?&]query=([^&]*)/);
    const q = m ? decodeURIComponent(m[1]!).toLowerCase() : '';
    const photos = byQuery[q] ?? [];
    return { ok: true, json: async () => ({ photos }) };
  };
}

test('search sceglie il primo candidato pulito', async () => {
  const fetchImpl = fakeFetch({
    'packaging mockup': [photo('app screenshot', 'dirty.jpg'), photo('packaging mockup studio', 'clean.jpg')],
  });
  const src = makePexelsImageSource({ apiKey: 'k', fetchImpl });
  assert.equal(await src.search('packaging mockup'), 'clean.jpg');
});

test('search con tutti sporchi prova il fallback (query ripulita)', async () => {
  const fetchImpl = fakeFetch({
    'brand logo': [photo('brand logo wall', 'dirty.jpg')],       // originale: tutti sporchi
    'brand': [photo('brand identity editorial', 'fallback.jpg')], // cleanImageQuery('brand logo') = 'brand'
  });
  const src = makePexelsImageSource({ apiKey: 'k', fetchImpl });
  assert.equal(await src.search('brand logo'), 'fallback.jpg');
});

test('search torna null se nemmeno il fallback trova immagini pulite', async () => {
  const fetchImpl = fakeFetch({
    'brand logo': [photo('brand logo wall', 'd1.jpg')],
    'brand': [photo('getty stock', 'd2.jpg')],
  });
  const src = makePexelsImageSource({ apiKey: 'k', fetchImpl });
  assert.equal(await src.search('brand logo'), null);
});
