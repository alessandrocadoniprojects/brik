/**
 * Verifica l'IDRAULICA del vertical slice senza chiamare l'LLM:
 * passa al QA runner un HTML BUONO (deve dare BUILD RIUSCITA) e uno ROTTO
 * (deve FALLIRE sui check violati). Conferma che resolver + Livelli 1/2 + gate
 * sono cablati correttamente, indipendentemente dalla qualità del modello.
 *
 * Lancio:  npx tsx demo/test-build-wiring.ts
 */
import { makeJsdomQaRunner } from '../src/qa/index.js';
import type { ProjectSpec } from '../src/core/index.js';

const knownRoutes = ['/'];

const spec: ProjectSpec = {
  id: 'wiring',
  ownerId: 'test',
  category: 'business-landing',
  title: 'Trattoria da Mario',
  description: 'test idraulica',
  criteria: [
    { id: 'c1', statement: 'Mostra "Trattoria da Mario"', confirmed: true, check: { kind: 'content-present', route: '/', text: 'Trattoria da Mario' } },
    { id: 'c2', statement: 'Funziona su mobile', confirmed: true, check: { kind: 'responsive', route: '/' } },
    {
      id: 'c3',
      statement: 'Form contatti con conferma',
      confirmed: true,
      check: {
        kind: 'form-submission',
        route: '/',
        fields: [
          { label: 'nome', value: 'Mario' },
          { label: 'email', value: 'a@b.it' },
          { label: 'messaggio', value: 'ciao' },
        ],
        expect: 'confirmation-visible',
        confirmationText: 'Grazie, ti risponderemo presto',
      },
    },
  ],
};

const goodHtml = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Trattoria da Mario</title></head>
<body>
  <h1>Trattoria da Mario</h1>
  <form id="f">
    <label for="nome">Nome</label><input id="nome">
    <label for="email">Email</label><input id="email">
    <label for="messaggio">Messaggio</label><textarea id="messaggio"></textarea>
    <button type="submit">Invia</button>
  </form>
  <div id="ok" style="display:none">Grazie, ti risponderemo presto</div>
  <script>
    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      document.getElementById('ok').style.display = 'block';
    });
  </script>
</body></html>`;

// Rotto: niente viewport (c2 fallisce) e conferma mai rivelata (c3 fallisce).
const brokenHtml = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Trattoria da Mario</title></head>
<body>
  <h1>Trattoria da Mario</h1>
  <form id="f">
    <label for="nome">Nome</label><input id="nome">
    <label for="email">Email</label><input id="email">
    <label for="messaggio">Messaggio</label><textarea id="messaggio"></textarea>
    <button type="submit">Invia</button>
  </form>
  <div id="ok" style="display:none">Grazie, ti risponderemo presto</div>
</body></html>`;

async function run(label: string, html: string): Promise<void> {
  const qa = makeJsdomQaRunner((route) => (route === '/' ? html : undefined), knownRoutes);
  const res = await qa.run({ specId: spec.id, templateId: 't', files: [] }, spec);
  if (!res.ok) {
    console.log(label + ': errore ' + res.error.message);
    return;
  }
  const r = res.value;
  console.log('=== ' + label + ' ===');
  for (const x of [...r.level1, ...r.level2]) {
    console.log('   ' + (x.passed ? 'PASS' : 'FAIL') + '  ' + x.kind + ' [' + x.criterionId + ']' + (x.detail ? ' — ' + x.detail : ''));
  }
  console.log('   => ' + (r.buildSucceeded ? 'BUILD RIUSCITA' : 'BUILD NON riuscita'));
  console.log('');
}

await run('HTML BUONO (atteso: RIUSCITA)', goodHtml);
await run('HTML ROTTO (atteso: NON riuscita)', brokenHtml);
