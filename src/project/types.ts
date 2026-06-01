/** Tipi del progetto persistito (Fase 2). */
import type { ProjectSpec, AcceptanceCriterion } from '@core';

export type ProjectStatus = 'preview' | 'approved';

export interface ProjectState {
  readonly id: string;
  /** Contratto: i criteri sono la fonte di verità, creati una volta e riusati. */
  readonly spec: ProjectSpec;
  /** Frasi-requisito sorgente (per l'aggiornamento dei requisiti). */
  readonly statements: readonly string[];
  /** Pagina corrente. */
  readonly html: string;
  readonly status: ProjectStatus;
  /** Cresce a ogni modifica/aggiornamento accettato. */
  readonly version: number;
  readonly updatedAt: string;
}

/** Snapshot per l'undo. */
export interface HistoryEntry {
  readonly version: number;
  readonly statements: readonly string[];
  readonly criteria: readonly AcceptanceCriterion[];
  readonly html: string;
  readonly note: string;
  readonly at: string;
}

export interface ProjectFile {
  readonly schemaVersion: 1;
  readonly state: ProjectState;
  readonly history: readonly HistoryEntry[];
}
