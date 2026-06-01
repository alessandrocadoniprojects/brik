/**
 * Demo con il classificatore Anthropic REALE (tool-use + validazione).
 * Legge la chiave da ANTHROPIC_API_KEY. Trasforma frasi utente in criteri
 * tipizzati; le frasi soggettive vengono segnalate, non inventate.
 */
import { buildCriteria, makeAnthropicClassifier } from '../src/intake/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY.');
  process.exit(1);
}

const classifier = makeAnthropicClassifier({ apiKey: key });

const statements = [
  'La home deve mostrare "Trattoria da Mario"',
  'Voglio un form contatti che mostra una conferma dopo invio',
  'Deve funzionare bene su mobile',
  'Il sito deve avere un tono elegante e raffinato',
];
const context = { category: 'business-landing', knownRoutes: ['/'] };

const res = await buildCriteria({ statements, context }, classifier);
if (!res.ok) {
  console.error('Errore ' + res.error.code + ': ' + res.error.message);
  process.exit(1);
}
console.log('=== Criteri estratti con LLM reale (tool-use + validazione) ===');
for (const c of res.value) {
  const tipo = c.check ? c.check.kind + ' ' + JSON.stringify(c.check) : 'SEGNALATO (non testabile)';
  console.log(c.id + ': ' + tipo);
  console.log('   ' + c.statement);
}
