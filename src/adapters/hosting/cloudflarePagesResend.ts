/**
 * Hosting Cloudflare Pages con recapito form "di proprieta" (Resend).
 *
 * Usa la modalita AVANZATA di Pages: un singolo _worker.js alla radice del deploy.
 * Il worker gestisce POST /api/contact (inoltro via Resend alla casella del
 * proprietario) e per ogni altra richiesta serve le pagine statiche via
 * env.ASSETS.fetch. Scelta deliberata rispetto a functions/ perche in alcune
 * versioni di wrangler il deploy diretto della cartella non aggancia functions/
 * (carica solo gli asset statici): _worker.js viene invece sempre deployato.
 *
 * Destinazione, mittente e chiave Resend sono cuciti nel worker al deploy: e
 * codice lato edge, NON servito ai visitatori (il _worker.js non e un asset).
 *
 * Credenziali nell'ambiente: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
 * RESEND_API_KEY, RESEND_FROM (opzionale).
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { type SiteHostingProvider, type SiteDeployResult, type Result, ok, err, appError } from '@core';
import { sanitizeProjectName, layoutFiles } from './cloudflarePages.js';

const jsStr = (s: string): string => JSON.stringify(String(s));

/** _worker.js (advanced mode): coi valori cuciti lato server. */
function contactWorker(toEmail: string, fromEmail: string, subject: string, apiKey: string): string {
  return `const RESEND_KEY = ${jsStr(apiKey)};
const TO = ${jsStr(toEmail)};
const FROM = ${jsStr(fromEmail)};
const SUBJECT = ${jsStr(subject)};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact' && request.method === 'POST') {
      try {
        const form = await request.formData();
        if (String(form.get('botcheck') || '')) return json({ ok: true });
        const entries = [...form.entries()].filter(function (e) { return e[0] !== 'botcheck'; });
        const replyEntry = entries.find(function (e) { return /e-?mail/i.test(e[0]) || /.+@.+\\..+/.test(String(e[1])); });
        const replyTo = replyEntry ? String(replyEntry[1]) : undefined;
        const text = entries.map(function (e) { return e[0] + ': ' + e[1]; }).join('\\n');
        const payload = { from: FROM, to: [TO], subject: SUBJECT, text: text };
        if (replyTo) payload.reply_to = replyTo;
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + RESEND_KEY, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) { const detail = await r.text(); return json({ ok: false, detail: detail.slice(0, 300) }, 502); }
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, detail: String(e).slice(0, 200) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
`;
}

export interface ResendHostConfig {
  readonly ownerEmail: string;
  readonly subject?: string;
  readonly resendFrom?: string;
  readonly resendKey?: string;
  readonly projectPrefix?: string;
  /** Nome progetto scelto dall'utente (sottodominio). Se assente, derivato dal siteId. */
  readonly projectName?: string;
  readonly apiToken?: string;
  readonly accountId?: string;
}

function run(args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Result<string>> {
  return new Promise((resolve) => {
    execFile('npx', args, { env, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const out = (stdout || '') + '\n' + (stderr || '');
      if (error && !/already exists|already in use/i.test(out)) {
        resolve(err(appError('HOSTING_DEPLOY_FAILED', 'wrangler: ' + out.trim().slice(0, 300), { retryable: true })));
      } else {
        resolve(ok(out));
      }
    });
  });
}

export function makeCloudflarePagesResendHost(config: ResendHostConfig): SiteHostingProvider {
  const apiToken = config.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
  const accountId = config.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const resendKey = config.resendKey ?? process.env.RESEND_API_KEY ?? '';
  const resendFrom = config.resendFrom ?? process.env.RESEND_FROM ?? 'onboarding@resend.dev';
  const subject = config.subject ?? 'Nuovo messaggio dal tuo sito';

  return {
    async deploy(input): Promise<Result<SiteDeployResult>> {
      if (!apiToken || !accountId) {
        return err(appError('HOSTING_NOT_CONFIGURED', 'Imposta CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID nel .env per pubblicare.', { retryable: false }));
      }
      const projectName = config.projectName
        ? sanitizeProjectName(config.projectName)
        : sanitizeProjectName(input.siteId, config.projectPrefix ?? '');
      const env = { ...process.env, CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId, CI: '1' };

      let dir: string | undefined;
      try {
        dir = await mkdtemp(join(tmpdir(), 'brik-deploy-'));
        for (const f of layoutFiles(input.pages)) {
          const full = join(dir, f.path);
          await mkdir(dirname(full), { recursive: true });
          await writeFile(full, f.contents, 'utf8');
        }
        // _worker.js alla radice (modalita avanzata)
        await writeFile(join(dir, '_worker.js'), contactWorker(config.ownerEmail, resendFrom, subject, resendKey), 'utf8');
        console.log('  [deploy] scrivo _worker.js + ' + input.pages.length + ' pagine');

        const created = await run(['wrangler', 'pages', 'project', 'create', projectName, '--production-branch', 'main'], env, 120_000);
        if (!created.ok) return err(created.error);

        const deployed = await run(['wrangler', 'pages', 'deploy', dir, '--project-name', projectName, '--branch', 'main', '--commit-dirty=true'], env, 240_000);
        if (!deployed.ok) return err(deployed.error);
        console.log('  [wrangler] ' + deployed.value.replace(/\s+/g, ' ').trim().slice(-500));

        const deployUrl = deployed.value.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/i)?.[0];
        return ok({ url: `https://${projectName}.pages.dev`, ...(deployUrl ? { deployId: deployUrl } : {}) });
      } catch (cause) {
        return err(appError('HOSTING_DEPLOY_FAILED', 'Deploy fallito: ' + String(cause).slice(0, 200), { retryable: true }));
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
