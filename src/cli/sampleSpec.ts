import type { ProjectSpec } from '@core';

/**
 * Spec di esempio (caso golden Fase 0/1).
 * In Fase 1 lo produce l'intake guidato; qui i criteri sono già tipizzati
 * (campo `check`) per dimostrare la generazione dei test di Livello 2.
 */
export const sampleSpec: ProjectSpec = {
  id: 'prj_0001',
  ownerId: 'usr_demo',
  category: 'business-landing',
  title: 'Trattoria da Mario',
  description: 'Sito vetrina di una trattoria con menù e modulo contatti.',
  locales: ['it'],
  criteria: [
    {
      id: 'c1',
      statement: "La home mostra il nome dell'attivita'.",
      confirmed: true,
      check: { kind: 'content-present', route: '/', text: 'Trattoria da Mario' },
    },
    {
      id: 'c2',
      statement: 'Un visitatore invia il form contatti e vede una conferma.',
      confirmed: true,
      check: {
        kind: 'form-submission',
        route: '/',
        fields: [
          { label: 'nome', value: 'Giulia' },
          { label: 'email', value: 'giulia@example.com' },
          { label: 'messaggio', value: 'Tavolo per 4 sabato sera' },
        ],
        expect: 'confirmation-visible',
        confirmationText: 'Grazie',
      },
    },
    {
      id: 'c3',
      statement: 'Il sito e\u0300 leggibile su mobile.',
      confirmed: true,
      check: { kind: 'responsive', route: '/' },
    },
  ],
};
