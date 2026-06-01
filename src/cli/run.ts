/**
 * Entry point del walking skeleton (Fase 0).
 * Collega gli adapter MOCK alla pipeline ed esegue un progetto end-to-end.
 *
 * Avvio:  npm start
 *
 * Per passare al reale (Fase 1+): sostituire i mock con gli adapter veri
 * (es. makeAnthropicLLM, adapter Supabase/Cloudflare). La pipeline non cambia.
 */

import { runPipeline, type PipelineDeps } from '@orchestrator';
import {
  mockCodeGenerator,
  mockBuildEngine,
  mockHosting,
  makeMemoryStore,
} from '@adapters';
import { sampleSpec } from './sampleSpec.js';

async function main(): Promise<void> {
  const deps: PipelineDeps = {
    codegen: mockCodeGenerator,
    buildEngine: mockBuildEngine,
    hosting: mockHosting,
    store: makeMemoryStore(),
    onEvent: (e) => {
      if (e.type === 'project.published') console.log(`\n🌐 Pubblicato: ${e.url}`);
    },
  };

  const result = await runPipeline(sampleSpec, deps);

  if (result.ok) {
    console.log('\n✅ Pipeline completata.');
    process.exitCode = 0;
  } else {
    console.error(`\n❌ Pipeline fallita: [${result.error.code}] ${result.error.message}`);
    process.exitCode = 1;
  }
}

void main();
