/** Tipi del progetto-sito persistito (Fase 3 / tappa 2). */
import type { ProjectSpec, SitePage, SiteRoute, AcceptanceCriterion } from '@core';

export type SiteStatus = 'preview' | 'approved' | 'published';

export interface SiteState {
  readonly id: string;
  readonly spec: ProjectSpec; // contratto (criteri con route)
  readonly statements: readonly string[]; // frasi-requisito sorgente
  readonly routes: readonly SiteRoute[]; // struttura (pagine + etichette menu)
  readonly pages: readonly SitePage[]; // pagine correnti
  readonly status: SiteStatus;
  readonly version: number;
  readonly updatedAt: string;
  readonly publishedAt?: string;
  readonly url?: string;
}

export interface SiteHistoryEntry {
  readonly version: number;
  readonly criteria: readonly AcceptanceCriterion[];
  readonly statements: readonly string[];
  readonly routes: readonly SiteRoute[];
  readonly pages: readonly SitePage[];
  readonly note: string;
  readonly at: string;
}

export interface SiteFile {
  readonly schemaVersion: 2;
  readonly state: SiteState;
  readonly history: readonly SiteHistoryEntry[];
}
