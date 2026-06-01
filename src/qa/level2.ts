/**
 * Livello 2 — generazione dei test E2E dai criteri TIPIZZATI.
 *
 * Questa è la parte "verificata e deterministica": ogni tipo di CheckSpec ha
 * un template di test Playwright scritto a mano e corretto. L'LLM non scrive
 * codice di test; al massimo ha classificato l'intento in un tipo noto a monte
 * (vedi intake). Così il Livello 2 è affidabile e i test falliscono davvero
 * quando il sito non rispetta il criterio.
 *
 * Aggiungere un tipo di check = aggiungere un case qui. Nient'altro.
 */

import type { AcceptanceCriterion, CheckSpec, ProjectSpec } from '@core';

/** Genera il contenuto di un file .spec.ts Playwright per l'intero progetto. */
export function generateLevel2Spec(spec: ProjectSpec): string {
  const tests = spec.criteria
    .filter((c): c is AcceptanceCriterion & { check: CheckSpec } => c.check !== undefined)
    .map((c) => renderTest(c.id, c.statement, c.check))
    .join('\n\n');

  return `// AUTO-GENERATO dai criteri di accettazione. Non modificare a mano.
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

${tests}
`;
}

function renderTest(id: string, statement: string, check: CheckSpec): string {
  const title = `${id}: ${statement.replace(/'/g, "\\'")}`;
  switch (check.kind) {
    case 'content-present':
      return tpl(title, `
  await page.goto(BASE + '${check.route}');
  await expect(page.getByText('${esc(check.text)}', { exact: false }).first()).toBeVisible();`);

    case 'route-loads':
      return tpl(title, `
  const res = await page.goto(BASE + '${check.route}');
  expect(res?.ok()).toBeTruthy();`);

    case 'navigation':
      return tpl(title, `
  await page.goto(BASE + '${check.fromRoute}');
  await page.getByRole('link', { name: '${esc(check.linkText)}' }).first().click();
  await expect(page).toHaveURL(new RegExp('${check.toRoutePattern}'));`);

    case 'form-submission': {
      const fills = check.fields
        .map(
          (f) =>
            `  await page.getByLabel(/${esc(f.label)}/i).fill('${esc(f.value)}');`,
        )
        .join('\n');
      return tpl(title, `
  await page.goto(BASE + '${check.route}');
${fills}
  await page.getByRole('button', { name: /invia|submit|manda/i }).first().click();
  await expect(page.getByText('${esc(check.confirmationText)}', { exact: false }).first()).toBeVisible();`);
    }

    case 'responsive':
      return tpl(
        title,
        `
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE + '${check.route}');
  // Nessun overflow orizzontale: la pagina non deve scrollare in larghezza.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBeFalsy();`,
      );
  }
}

const tpl = (title: string, body: string): string =>
  `test('${title}', async ({ page }) => {${body}
});`;

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
