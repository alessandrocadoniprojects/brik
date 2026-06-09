/**
 * Adapter di hosting: Cloudflare Pages.
 *
 * Pubblica un sito statico multi-pagina su <progetto>.pages.dev usando lo
 * strumento ufficiale `wrangler` (gestisce hashing, upload incrementale, retry).
 * Le parti pure (layout dei file, nome progetto) sono esportate e testate; il
 * deploy effettivo invoca wrangler in un sottoprocesso.
 *
 * Credenziali (impostate dall'utente nel proprio ambiente, MAI nel codice):
 *   CLOUDFLARE_API_TOKEN   token con permesso "Cloudflare Pages: Edit"
 *   CLOUDFLARE_ACCOUNT_ID  id dell'account
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { type SiteHostingProvider, type SiteDeployResult, type SitePage, type Result, ok, err, appError } from '@core';

/** Nome progetto Cloudflare valido: minuscolo, alfanumerico e trattini, max 58. */
export function sanitizeProjectName(id: string, prefix = ''): string {
  const base = (prefix + id)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  const trimmed = (base || 'sito').slice(0, 58).replace(/-+$/g, '');
  return trimmed.length >= 1 ? trimmed : 'sito';
}

/**
 * Dispone le pagine come file statici per un host con routing a cartelle:
 *   "/"        -> index.html
 *   "/menu"    -> menu/index.html   (cosi il link "/menu" funziona)
 */
export function layoutFiles(pages: readonly SitePage[]): { path: string; contents: string }[] {
  return pages.map((p) => {
    const clean = p.route.replace(/^\/+/, '').replace(/\/+$/, '');
    const path = clean === '' ? 'index.html' : clean + '/index.html';
    return { path, contents: p.html };
  });
}

interface CloudflareConfig {
  readonly accountId?: string;
  readonly apiToken?: string;
  readonly projectPrefix?: string;
  /** Nome progetto scelto dall'utente (sottodominio). Se assente, derivato dal siteId. */
  readonly projectName?: string;
  /** override per i test: esegue il comando e ritorna stdout. */
  readonly runner?: (dir: string, projectName: string, env: NodeJS.ProcessEnv) => Promise<Result<string>>;
}

function defaultRunner(dir: string, projectName: string, env: NodeJS.ProcessEnv): Promise<Result<string>> {
  const run = (args: string[]): Promise<Result<string>> =>
    new Promise((resolve) => {
      execFile('npx', args, { env, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        const out = (stdout || '') + '\n' + (stderr || '');
        if (error && !/already exists|already in use/i.test(out)) {
          resolve(err(appError('HOSTING_DEPLOY_FAILED', 'wrangler: ' + out.trim().slice(0, 300), { retryable: true })));
        } else {
          resolve(ok(out));
        }
      });
    });

  return (async () => {
    // crea il progetto (idempotente: ignora "already exists")
    await run(['wrangler', 'pages', 'project', 'create', projectName, '--production-branch', 'main']);
    // deploy della cartella in produzione
    return run(['wrangler', 'pages', 'deploy', dir, '--project-name', projectName, '--branch', 'main', '--commit-dirty=true']);
  })();
}

export function makeCloudflarePagesHost(config: CloudflareConfig = {}): SiteHostingProvider {
  const apiToken = config.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
  const accountId = config.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const runner = config.runner ?? defaultRunner;

  return {
    async deploy(input): Promise<Result<SiteDeployResult>> {
      if (!apiToken || !accountId) {
        return err(appError('HOSTING_NOT_CONFIGURED', 'Imposta CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID nel .env per pubblicare.', { retryable: false }));
      }
      const projectName = config.projectName
        ? sanitizeProjectName(config.projectName)
        : sanitizeProjectName(input.siteId, config.projectPrefix ?? '');

      let dir: string | undefined;
      try {
        dir = await mkdtemp(join(tmpdir(), 'brik-deploy-'));
        for (const f of layoutFiles(input.pages)) {
          const full = join(dir, f.path);
          await mkdir(dirname(full), { recursive: true });
          await writeFile(full, f.contents, 'utf8');
        }
        const env = { ...process.env, CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId, CI: '1' };
        const res = await runner(dir, projectName, env);
        if (!res.ok) return err(res.error);
        const deployUrl = res.value.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/i)?.[0];
        return ok({ url: `https://${projectName}.pages.dev`, ...(deployUrl ? { deployId: deployUrl } : {}) });
      } catch (cause) {
        return err(appError('HOSTING_DEPLOY_FAILED', 'Deploy fallito: ' + String(cause).slice(0, 200), { retryable: true }));
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
