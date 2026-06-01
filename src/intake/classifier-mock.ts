/**
 * Classificatore intake MOCK.
 *
 * Simula ciò che in produzione fa l'LLM: trasformare una frase dell'utente in
 * un criterio TIPIZZATO (CheckSpec) o ritornare null se non è riconducibile a
 * un tipo noto (→ verrà segnalato, non finto-verificato). Qui usiamo regole a
 * parole chiave per poter girare senza chiave API.
 */

import { type IntakeClassifier, type CheckSpec, type Result, ok } from '@core';

export const mockClassifier: IntakeClassifier = {
  async classify(statement, context): Promise<Result<CheckSpec | null>> {
    const s = statement.toLowerCase();
    const home = context.knownRoutes[0] ?? '/';

    if (/(form|contatt|invia|prenot|richiest)/.test(s)) {
      return ok({
        kind: 'form-submission',
        route: home,
        fields: [
          { label: 'nome', value: 'Mario Rossi' },
          { label: 'email', value: 'mario@example.com' },
          { label: 'messaggio', value: 'Vorrei informazioni' },
        ],
        expect: 'confirmation-visible',
        confirmationText: 'Grazie',
      });
    }
    if (/(mobile|telefono|cellulare|smartphone)/.test(s)) {
      return ok({ kind: 'responsive', route: home });
    }
    if (/(mostra|nome|titolo|home|vetrina|menu|menù)/.test(s)) {
      const quoted = statement.match(/"([^"]+)"/)?.[1] ?? context.category;
      return ok({ kind: 'content-present', route: home, text: quoted });
    }
    // Non classificabile → null (sarà segnalato).
    return ok(null);
  },
};
