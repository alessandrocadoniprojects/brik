/**
 * Ports — le interfacce (porte) che l'orchestratore usa senza conoscere
 * l'implementazione concreta. È QUI che vive l'estensibilità del progetto:
 *
 *  - per cambiare LLM/sandbox/hosting → si scrive un nuovo adapter, zero
 *    modifiche all'orchestratore;
 *  - per aggiungere capacità post-MVP (es. nuove integrazioni) → si aggiunge
 *    una nuova porta, le altre restano intatte.
 *
 * Pattern: Ports & Adapters (hexagonal). Il core non importa nulla di
 * concreto; gli adapter implementano queste interfacce.
 */

import type { Result } from './result.js';
import type {
  ProjectSpec,
  GeneratedProject,
  BuildArtifact,
  DeployResult,
} from './domain.js';

/** Accesso grezzo a un modello (testo→testo). Adapter: Anthropic, mock, ... */
export interface LLMProvider {
  readonly name: string;
  complete(input: LLMRequest): Promise<Result<LLMResponse>>;
}

export interface LLMRequest {
  readonly system?: string;
  readonly prompt: string;
  /** Selezione modello logica (es. "fast" → Haiku, "strong" → Opus). */
  readonly tier?: 'fast' | 'balanced' | 'strong';
  readonly maxTokens?: number;
}

export interface LLMResponse {
  readonly text: string;
  /** Token usati, per il metering costi per-account. */
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}

/** Trasforma uno Spec in codice. Usa un LLMProvider + i template curati. */
export interface CodeGenerator {
  generate(spec: ProjectSpec): Promise<Result<GeneratedProject>>;
}

/** Esegue/builda il codice generato (in sandbox isolata). */
export interface BuildEngine {
  build(project: GeneratedProject): Promise<Result<BuildArtifact>>;
}

/** Pubblica l'artefatto su un sottodominio. Adapter: Cloudflare, Vercel, mock. */
export interface HostingProvider {
  deploy(artifact: BuildArtifact, opts: DeployOptions): Promise<Result<DeployResult>>;
}

export interface DeployOptions {
  /** Sottodominio richiesto (univoco per progetto). */
  readonly subdomain: string;
}

/** Persistenza dei progetti. Adapter: Supabase, in-memory (mock). */
export interface ProjectStore {
  save(spec: ProjectSpec): Promise<Result<void>>;
  get(id: string): Promise<Result<ProjectSpec | null>>;
}

/**
 * Porte previste per le fasi successive (NON implementate nello skeleton).
 * Le dichiariamo qui per documentare il percorso di espansione in codice.
 *
 *  - QaRunner: Livelli 1/2/3 di verifica (Fase 1-3)
 *  - MockupRenderer: anteprima visiva da approvare (Fase 2)
 *  - SecurityScanner: gate SAST/deps/secret (Fase 5)
 *  - SecretsVault, BillingMeter, ModerationAgent, ...
 *
 * Verranno aggiunte come nuove interfacce senza toccare quelle sopra.
 */
