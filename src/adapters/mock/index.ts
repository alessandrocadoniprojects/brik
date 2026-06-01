/**
 * Adapter MOCK — implementazioni finte delle porte, per provare la pipeline
 * end-to-end in locale senza account/chiavi esterne. Gli adapter reali
 * (Anthropic, E2B, Supabase, Cloudflare) implementano le stesse interfacce
 * e si sostituiscono uno a uno, senza toccare l'orchestratore.
 */

import {
  type CodeGenerator,
  type BuildEngine,
  type HostingProvider,
  type ProjectStore,
  type LLMProvider,
  type ProjectSpec,
  type GeneratedProject,
  type BuildArtifact,
  type DeployResult,
  type Result,
  ok,
} from '@core';

export const mockLLM: LLMProvider = {
  name: 'mock-llm',
  async complete(input): Promise<Result<{ text: string }>> {
    return ok({ text: `// generato (mock) dal prompt: ${input.prompt.slice(0, 40)}...` });
  },
};

export const mockCodeGenerator: CodeGenerator = {
  async generate(spec: ProjectSpec): Promise<Result<GeneratedProject>> {
    // In reale: usa LLMProvider + template curato per categoria.
    return ok({
      specId: spec.id,
      templateId: `template:${spec.category}`,
      files: [
        { path: 'app/page.tsx', contents: `export default () => <main>${spec.title}</main>;` },
        { path: 'README.md', contents: `# ${spec.title}\n${spec.description}` },
      ],
    });
  },
};

export const mockBuildEngine: BuildEngine = {
  async build(project: GeneratedProject): Promise<Result<BuildArtifact>> {
    return ok({
      specId: project.specId,
      artifactRef: `mock-artifact://${project.specId}`,
      logs: [`build ok: ${project.files.length} file dal ${project.templateId}`],
    });
  },
};

export const mockHosting: HostingProvider = {
  async deploy(artifact: BuildArtifact, opts): Promise<Result<DeployResult>> {
    return ok({ specId: artifact.specId, url: `https://${opts.subdomain}.example-builder.app` });
  },
};

export const makeMemoryStore = (): ProjectStore => {
  const db = new Map<string, ProjectSpec>();
  return {
    async save(spec) {
      db.set(spec.id, spec);
      return ok(undefined);
    },
    async get(id) {
      return ok(db.get(id) ?? null);
    },
  };
};
