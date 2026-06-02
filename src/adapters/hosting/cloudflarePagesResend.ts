/**
 * Hosting Cloudflare Pages con recapito form "di proprieta" (Resend).
 *
 * Come makeCloudflarePagesHost, ma oltre alle pagine statiche deploya anche una
 * Pages Function in functions/api/contact.js che riceve il POST del form e lo
 * inoltra via Resend alla casella del PROPRIETARIO del sito. L'indirizzo di
 * destinazione e bakeato nel codice della function al momento del deploy (lato
 * server, non manipolabile dal browser); la chiave Resend e impostata come
 * secret del progetto Pages (mai nel bundle).
 *
 * Credenziali (nell'ambiente, MAI nel codice):
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   come l'host base
 *   RESEND_API_KEY                                 chiave Resend (diventa secret del progetto)
 *   RESEND_FROM (opzionale)                        mittente verificato su Resend
 *
 * Nota Resend: senza un dominio verificato, il mittente di default
 * onboarding@resend.dev recapita solo alla tua email Resend. Per scrivere a
 * indirizzi arbitrari (i clienti) serve un dominio verificato + RESEND_FROM.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { type SiteHostingProvider, type SiteDeployResult, type Result, ok, err, appError } from '@core';
import { sanitizeProjectName, layoutFiles } from './cloudflarePages.js';

const jsStr = (s: string): string => JSON.stringify(String(s));

/** Codice della Pages Function, coi valori bakeati lato server. */
function contactFunction(toEmail: string, fromEmail: string, subject: string): string {
  return `export async function onRequestPost(context) {
  try {
    const form = await context.request.formData();
    if (String(form.get('botcheck') || '')) {
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const entries = [...form.entries()].filter(function (e) { return e[0] !== 'botcheck'; });
    const replyEntry = entries.find(function (e) { return /e-?mail/i.test(e[0]) || /.+@.+\\..+/.test(String(e[1])); });
    const replyTo = replyEntry ? String(replyEntry[1]) : undefined;
    const text = entries.map(function (e) { return e[0] + ': ' + e[1]; }).join('\\n');
    const payload = { from: ${jsStr(fromEmail)}, to: [${jsStr(toEmail)}], subject: ${jsStr(subject)}, text: text };
    if (replyTo) payload.reply_to = replyTo;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + context.env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const detail = await r.text();
      return new Response(JSON.stringify({ ok: false, detail: detail.slice(0, 200) }), { status: 502, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response('{"ok":false}', { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
`;
}

export interface ResendHostConfig {
  readonly ownerEmail: string;
  readonly subject?: string;
  readonly resendFrom?: string;
  readonly resendKey?: string;
  readonly projectPrefix?: string;
  readonly apiToken?: string;
  readonly accountId?: string;
}

function run(args: string[], env: NodeJS.ProcessEnv): Promise<Result<string>> {
  return new Promise((resolve) => {
    execFile('npx', args, { env, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const out = (stdout || '') + '\n' + (stderr || '');
      if (error && !/already exists|already in use/i.test(out)) {
        resolve(err(appError('HOSTING_DEPLOY_FAILED', 'wrangler: ' + out.trim().slice(0, 300), { retryable: true })));
      } else {
        resolve(ok(out));
      }
    });
  });
}

function putSecret(name: string, value: string, projectName: string, env: NodeJS.ProcessEnv): Promise<Result<string>> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['wrangler', 'pages', 'secret', 'put', name, '--project-name', projectName], { env });
    let out = '';
    const to = setTimeout(() => child.kill(), 60_000);
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    child.on('error', (e) => {
      clearTimeout(to);
      resolve(err(appError('HOSTING_SECRET_FAILED', 'secret: ' + String(e).slice(0, 200), { retryable: true })));
    });
    child.on('close', (code) => {
      clearTimeout(to);
      if (code === 0 || /success|uploaded|created|secret/i.test(out)) resolve(ok(out));
      else resolve(err(appError('HOSTING_SECRET_FAILED', 'secret put fallito: ' + out.trim().slice(0, 200), { retryable: true })));
    });
    child.stdin?.write(value + '\n');
    child.stdin?.end();
  });
}

export function makeCloudflarePagesResendHost(config: ResendHostConfig): SiteHostingProvider {
  const apiToken = config.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
  const accountId = config.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const resendKey = config.resendKey ?? process.env.RESEND_API_KEY;
  const resendFrom = config.resendFrom ?? process.env.RESEND_FROM ?? 'onboarding@resend.dev';
  const subject = config.subject ?? 'Nuovo messaggio dal tuo sito';

  return {
    async deploy(input): Promise<Result<SiteDeployResult>> {
      if (!apiToken || !accountId) {
        return err(appError('HOSTING_NOT_CONFIGURED', 'Imposta CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID nel .env per pubblicare.', { retryable: false }));
      }
      const projectName = sanitizeProjectName(input.siteId, config.projectPrefix ?? '');
      const env = { ...process.env, CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId, CI: '1' };

      let dir: string | undefined;
      try {
        dir = await mkdtemp(join(tmpdir(), 'brik-deploy-'));
        for (const f of layoutFiles(input.pages)) {
          const full = join(dir, f.path);
          await mkdir(dirname(full), { recursive: true });
          await writeFile(full, f.contents, 'utf8');
        }
        // Pages Function per il recapito form
        const fnPath = join(dir, 'functions', 'api', 'contact.js');
        await mkdir(dirname(fnPath), { recursive: true });
        await writeFile(fnPath, contactFunction(config.ownerEmail, resendFrom, subject), 'utf8');

        const created = await run(['wrangler', 'pages', 'project', 'create', projectName, '--production-branch', 'main'], env);
        if (!created.ok) return err(created.error);

        if (resendKey) {
          const sec = await putSecret('RESEND_API_KEY', resendKey, projectName, env);
          if (!sec.ok) return err(sec.error);
        }

        const deployed = await run(['wrangler', 'pages', 'deploy', dir, '--project-name', projectName, '--branch', 'main', '--commit-dirty=true'], env);
        if (!deployed.ok) return err(deployed.error);

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
