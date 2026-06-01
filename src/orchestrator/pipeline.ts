import {
  type ProjectSpec,
  type DeployResult,
  type Result,
  type EventListener,
  type CodeGenerator,
  type BuildEngine,
  type HostingProvider,
  type ProjectStore,
  ok,
  err,
  appError,
} from '@core';
import { PipelineState } from './states.js';
import { withRetry } from './util/withRetry.js';
import { withTimeout } from './util/withTimeout.js';
import { type Logger, consoleLogger } from './util/logger.js';

/** Dipendenze iniettate (porte). Sostituibili → testabile e estensibile. */
export interface PipelineDeps {
  readonly codegen: CodeGenerator;
  readonly buildEngine: BuildEngine;
  readonly hosting: HostingProvider;
  readonly store: ProjectStore;
  readonly onEvent?: EventListener;
  readonly logger?: Logger;
}

/** Timeout per passo (ms). Conservativi; si tarano coi dati reali. */
const TIMEOUTS = { generate: 120_000, build: 180_000, deploy: 120_000 } as const;

/**
 * Pipeline Fase 0: porta uno Spec confermato fino a un sito pubblicato.
 *
 * Ogni passo è avvolto da timeout + retry e emette eventi di stato.
 * I passi di QA/approvazione/sicurezza si inseriranno tra BUILD e DEPLOY
 * nelle fasi successive, senza cambiare la struttura qui presente.
 */
export async function runPipeline(
  spec: ProjectSpec,
  deps: PipelineDeps,
): Promise<Result<DeployResult>> {
  const log = deps.logger ?? consoleLogger(spec.id);
  const emit = deps.onEvent ?? (() => {});

  const step = async <T>(
    state: string,
    timeoutMs: number,
    op: () => Promise<Result<T>>,
  ): Promise<Result<T>> => {
    emit({ type: 'state.entered', state, specId: spec.id });
    log.info(`→ ${state}`);
    const res = await withRetry(() => withTimeout(op, timeoutMs, state));
    if (res.ok) {
      emit({ type: 'state.completed', state, specId: spec.id });
    } else {
      emit({ type: 'state.failed', state, specId: spec.id, code: res.error.code });
      log.error(`✗ ${state}: ${res.error.code} — ${res.error.message}`);
    }
    return res;
  };

  // Persistenza dello spec (idempotente lato store).
  const saved = await deps.store.save(spec);
  if (!saved.ok) return err(saved.error);

  // GENERATE
  const generated = await step(PipelineState.GENERATE, TIMEOUTS.generate, () =>
    deps.codegen.generate(spec),
  );
  if (!generated.ok) return err(generated.error);

  // BUILD
  const built = await step(PipelineState.BUILD, TIMEOUTS.build, () =>
    deps.buildEngine.build(generated.value),
  );
  if (!built.ok) return err(built.error);

  // [Fase 1-5: QA Livello 1/2/3, approvazione visiva, security scan]
  // Si inseriscono qui, ciascuno come uno `step(...)` con la propria porta.

  // DEPLOY
  const subdomain = toSubdomain(spec);
  const deployed = await step(PipelineState.DEPLOY, TIMEOUTS.deploy, () =>
    deps.hosting.deploy(built.value, { subdomain }),
  );
  if (!deployed.ok) return err(deployed.error);

  emit({ type: 'project.published', specId: spec.id, url: deployed.value.url });
  log.info(`✓ PUBLISHED → ${deployed.value.url}`);
  return ok(deployed.value);
}

/** Sottodominio sicuro derivato dallo spec (placeholder; univocità in Fase 6). */
function toSubdomain(spec: ProjectSpec): string {
  const base = spec.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length > 0 ? `${base}-${spec.id.slice(0, 6)}` : spec.id;
}

export { appError };
