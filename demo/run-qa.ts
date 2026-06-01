import { readFileSync } from 'node:fs';
import { runChecksJsdom } from '../src/qa/jsdomRunner.js';
import { sampleSpec } from '../src/cli/sampleSpec.js';

const good = readFileSync(new URL('./app/index.html', import.meta.url), 'utf8');

// App "rotta": tolgo il nome (h1) e la conferma del form.
const broken = good
  .replace('<h1>Trattoria da Mario</h1>', '<h1>Ristorante</h1>')
  .replace('Grazie! Ti ricontattiamo presto.', '');

const resolver = (html: string) => (route: string) => (route === '/' ? html : undefined);

function report(label: string, html: string) {
  const results = runChecksJsdom(sampleSpec, resolver(html));
  console.log(`\n=== ${label} ===`);
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.criterionId} [${r.kind}]${r.detail ? ' — ' + r.detail : ''}`);
  }
  return results;
}

const g = report('App corretta', good);
const b = report('App rotta (nome e conferma rimossi)', broken);

const goodAllPass = g.every((r) => r.passed);
const brokenCatches = b.filter((r) => !r.passed).map((r) => r.criterionId).join(',');
console.log(`\nAtteso: corretta tutti PASS = ${goodAllPass}; rotta fallisce c1,c2 = ${brokenCatches}`);
