/**
 * Eventi di dominio. L'orchestratore li emette a ogni transizione; un
 * listener li può usare per UI di progresso (UX asincrona), telemetria,
 * metering costi. Aggiungere un nuovo evento non rompe i listener esistenti.
 */

export type PipelineEvent =
  | { readonly type: 'state.entered'; readonly state: string; readonly specId: string }
  | { readonly type: 'state.completed'; readonly state: string; readonly specId: string }
  | { readonly type: 'state.failed'; readonly state: string; readonly specId: string; readonly code: string }
  | { readonly type: 'project.published'; readonly specId: string; readonly url: string };

export type EventListener = (event: PipelineEvent) => void;
