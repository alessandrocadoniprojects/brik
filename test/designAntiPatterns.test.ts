/**
 * Test dell'Anti-pattern Detector di design (Fase 2 v1).
 * Deterministici e offline. Lancio: npx tsx --test test/designAntiPatterns.test.ts
 *
 * Per ogni regola: un caso POSITIVO (deve scattare) e uno NEGATIVO (non deve).
 * Più i due test "ponte" e il test che protegge il principio fondante: il report
 * non espone alcun campo di blocco.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanDesignAntiPatterns,
  findingsToDirectorNotes,
  summarizeForReview,
  formatFindingsForLog,
  type DesignScanContext,
} from '../src/project/designAntiPatternDetector.js';
import { creativeDirectionForIndustry } from '../src/intake/industryEngine.js';

// Contesti riutilizzabili.
const editorial: DesignScanContext = { theme: 'editorial-luxury', industry: 'generic' };
const scandi: DesignScanContext = { theme: 'scandinavian-service', industry: 'dentist', creativeDirection: creativeDirectionForIndustry('dentist') };

// Helper: c'è un finding con questa regola?
const has = (html: string, ctx: DesignScanContext, rule: string) =>
  scanDesignAntiPatterns(html, ctx).findings.some((f) => f.rule === rule);

// === ALTA CONFIDENZA =========================================================

test('emoji-present: scatta con emoji, non senza', () => {
  assert.equal(has('<h1>Benvenuti 🦷 in studio</h1>', scandi, 'emoji-present'), true);
  assert.equal(has('<h1>Benvenuti in studio</h1>', scandi, 'emoji-present'), false);
});

test('fake-counter: scatta con data-count, non con numero statico', () => {
  assert.equal(has('<div class="n" data-count="1500">0</div>', scandi, 'fake-counter'), true);
  assert.equal(has('<div class="n">15 anni</div>', scandi, 'fake-counter'), false);
});

test('generic-brand: scatta con etichetta di categoria, non con nome proprio', () => {
  assert.equal(has('<a class="brand" href="/">Studio Dentistico<span class="dot"></span></a>', scandi, 'generic-brand'), true);
  assert.equal(has('<a class="brand" href="/">Studio Brera Odontoiatria<span class="dot"></span></a>', scandi, 'generic-brand'), false);
});

// === MEDIA CONFIDENZA ========================================================

test('generic-headline: scatta su cliché, non su titolo specifico', () => {
  assert.equal(has('<h1>Soluzioni innovative per te</h1>', scandi, 'generic-headline'), true);
  assert.equal(has('<h1>Igiene e impianti dentali a Brera</h1>', scandi, 'generic-headline'), false);
});

test('repeated-weak-cta: scatta se ripetuta 3+ volte, non una volta', () => {
  const many = '<a>Scopri di più</a><a>Scopri di più</a><a>Scopri di più</a>';
  assert.equal(has(many, scandi, 'repeated-weak-cta'), true);
  assert.equal(has('<a>Scopri di più</a><a>Prenota una visita</a>', scandi, 'repeated-weak-cta'), false);
});

test('too-many-primary-buttons: scatta con 2 primari in una sezione, non con 1', () => {
  const two = '<section><a class="btn primary">A</a><a class="btn primary">B</a></section>';
  const one = '<section><a class="btn primary">A</a><a class="link">B</a></section>';
  assert.equal(has(two, scandi, 'too-many-primary-buttons'), true);
  assert.equal(has(one, scandi, 'too-many-primary-buttons'), false);
});

test('generic-image-query: scatta su query vaga, non su query specifica', () => {
  assert.equal(has('<img data-brik-img="business team">', scandi, 'generic-image-query'), true);
  assert.equal(has('<img data-brik-img="dental clinic instrument detail">', scandi, 'generic-image-query'), false);
});

test('generic-image-query: ignora le foto reali dell\'utente (user:ID)', () => {
  assert.equal(has('<img data-brik-img="user:abc">', scandi, 'generic-image-query'), false);
});

test('image-conflicts-photoavoid: scatta se la query tocca i soggetti vietati del settore', () => {
  // Per il dentista, photoAvoid include "corridoi ospedalieri".
  assert.equal(has('<img data-brik-img="hospital corridor" alt="corridoio">', scandi, 'image-conflicts-photoavoid'), true);
  assert.equal(has('<img data-brik-img="dentist hands closeup">', scandi, 'image-conflicts-photoavoid'), false);
});

test('dense-footer: scatta con 4+ colonne, non con 2', () => {
  const four = '<footer><div class="col">a</div><div class="col">b</div><div class="col">c</div><div class="col">d</div></footer>';
  const two = '<footer><div class="col">a</div><div class="col">b</div></footer>';
  assert.equal(has(four, scandi, 'dense-footer'), true);
  assert.equal(has(two, scandi, 'dense-footer'), false);
});

test('uniform-card-grid: scatta con 3+ card con icona', () => {
  const cards = '<div class="card"><svg></svg></div><div class="card"><svg></svg></div><div class="card"><svg></svg></div>';
  assert.equal(has(cards, scandi, 'uniform-card-grid'), true);
  assert.equal(has('<div class="service">voce</div>', scandi, 'uniform-card-grid'), false);
});

test('duplicate-section: scatta con due sezioni identiche', () => {
  const dup = '<section>Lorem ipsum dolor sit amet consectetur testo lungo</section><section>Lorem ipsum dolor sit amet consectetur testo lungo</section>';
  assert.equal(has(dup, scandi, 'duplicate-section'), true);
  assert.equal(has('<section>Prima sezione diversa e lunga abbastanza</section><section>Seconda sezione del tutto diversa qui</section>', scandi, 'duplicate-section'), false);
});

// === SPECIFICHE EDITORIAL-LUXURY ============================================

test('editorial-gradient: scatta in editorial, non in altri temi', () => {
  const html = '<div style="background:linear-gradient(90deg,#fff,#000)"></div>';
  assert.equal(has(html, editorial, 'editorial-gradient'), true);
  assert.equal(has(html, scandi, 'editorial-gradient'), false); // regola solo per editorial
});

test('editorial-saas-cards: scatta con card in editorial', () => {
  assert.equal(has('<div class="card">x</div>', editorial, 'editorial-saas-cards'), true);
  assert.equal(has('<div class="service">x</div>', editorial, 'editorial-saas-cards'), false);
});

test('editorial-too-many-icons: scatta con 3+ svg in editorial', () => {
  assert.equal(has('<svg></svg><svg></svg><svg></svg>', editorial, 'editorial-too-many-icons'), true);
  assert.equal(has('<svg></svg>', editorial, 'editorial-too-many-icons'), false);
});

// === PONTE ===================================================================

test('findingsToDirectorNotes: note imperative dai findings >= media, max rispettato', () => {
  const html = '<a class="brand" href="/">Studio Dentistico</a><h1>Soluzioni innovative</h1><img data-brik-img="business team"><footer><div class="col">a</div><div class="col">b</div><div class="col">c</div><div class="col">d</div></footer>';
  const report = scanDesignAntiPatterns(html, scandi);
  const notes = findingsToDirectorNotes(report, { max: 2 });
  assert.equal(notes.length, 2);                 // limite rispettato
  assert.ok(notes.every((n) => typeof n === 'string' && n.length > 0));
  // Il primo deve essere il più grave (generic-brand è high).
  assert.match(notes[0]!, /nome proprio/);
});

test('summarizeForReview: righe compatte ordinate, limite rispettato', () => {
  const html = '<a class="brand" href="/">Studio Dentistico</a><h1>Soluzioni innovative</h1>';
  const lines = summarizeForReview(scanDesignAntiPatterns(html, scandi), 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^\[(high|medium|low)\]/);
});

// === PRINCIPIO FONDANTE ======================================================

test('formatFindingsForLog: intestazione + una riga per finding con tutti i campi', () => {
  const report = scanDesignAntiPatterns('<h1>x 🦷</h1><div data-count="9">0</div>', scandi);
  const lines = formatFindingsForLog(report);
  // Prima riga = intestazione col totale; poi una riga per finding.
  assert.match(lines[0]!, /^DETECTOR findings: \d+/);
  assert.equal(lines.length, report.findings.length + 1);
  // Ogni riga di finding espone tutti i campi richiesti.
  for (const ln of lines.slice(1)) {
    assert.match(ln, /rule=.+ cat=.+ sev=(high|medium|low) conf=\d\.\d\d area=.+ \| .+ → .+/);
  }
});

test('il report NON espone alcun campo di blocco (consultivo per costruzione)', () => {
  const report = scanDesignAntiPatterns('<h1>x 🦷</h1>', scandi) as Record<string, unknown>;
  assert.equal('blocked' in report, false);
  assert.equal('block' in report, false);
  // Ha solo findings + summary.
  assert.deepEqual(Object.keys(report).sort(), ['findings', 'summary']);
});

test('HTML pulito ed editoriale: nessun finding', () => {
  const clean = '<header><a class="brand" href="/">Studio Brera Odontoiatria</a></header><section class="hero"><h1>Cure dentali calme a Brera</h1><a class="btn primary">Prenota una visita</a><div class="hero-media" data-img><img data-brik-img="dental clinic instrument detail"></div></section>';
  const report = scanDesignAntiPatterns(clean, scandi);
  assert.equal(report.summary.total, 0);
});
