/**
 * Stati della pipeline di un progetto.
 *
 * Fase 0 implementa il percorso minimo: GENERATE → BUILD → DEPLOY → PUBLISHED.
 * Gli altri stati sono DICHIARATI ma non ancora attivi, per rendere esplicito
 * in codice dove si innesteranno le fasi successive. Aggiungere uno stato
 * significa inserire un passo nella pipeline, senza riscrivere quelli esistenti.
 */
export const PipelineState = {
  // Fase 1
  INTAKE: 'INTAKE',
  // Fase 0 (attivi)
  GENERATE: 'GENERATE',
  BUILD: 'BUILD',
  // Fase 1-3 (futuri): verifica e approvazione
  QA_DETERMINISTIC: 'QA_DETERMINISTIC', // Livello 1
  QA_CRITERIA: 'QA_CRITERIA',           // Livello 2
  VISUAL_APPROVAL: 'VISUAL_APPROVAL',   // Fase 2
  QA_SUBJECTIVE: 'QA_SUBJECTIVE',       // Livello 3
  SECURITY_SCAN: 'SECURITY_SCAN',       // Fase 5
  // Fase 0 (attivi)
  DEPLOY: 'DEPLOY',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
} as const;

export type PipelineState = (typeof PipelineState)[keyof typeof PipelineState];
