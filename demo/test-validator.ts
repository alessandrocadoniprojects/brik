import { validateCriterion } from '../src/intake/classifier-anthropic.js';
const routes = ['/'];
const cases = [
  { name: 'content-present con "content" invece di "text" (lo shape sbagliato ottenuto)', raw: { kind: 'content-present', route: '/', content: 'Trattoria da Mario' } },
  { name: 'content-present con "text" (corretto)', raw: { kind: 'content-present', route: '/', text: 'Trattoria da Mario' } },
  { name: 'form-submission con solo "description" (lo shape sbagliato ottenuto)', raw: { kind: 'form-submission', description: 'Form contatti con conferma' } },
  { name: 'form-submission completo (corretto)', raw: { kind: 'form-submission', route: '/', fields: [{ label: 'email', value: 'a@b.c' }], expect: 'confirmation-visible', confirmationText: 'Grazie' } },
  { name: 'responsive senza route (auto-normalizzato a "/")', raw: { kind: 'responsive' } },
];
for (const c of cases) {
  const r = validateCriterion(c.raw, routes);
  if (r.spec) console.log('ACCETTATO  ' + c.name + ' -> ' + JSON.stringify(r.spec));
  else console.log('SCARTATO   ' + c.name + ' -> motivo: ' + r.reason);
}
