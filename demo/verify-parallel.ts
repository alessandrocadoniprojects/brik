/**
 * VERIFICA SERIA della generazione PARALLELA per-pagina.
 *
 * Genera un sito multi-pagina col motore REALE (Sonnet) in 2 stili, una volta in
 * PARALLELO (default) e una volta in SEQUENZIALE (BRIK_GEN_PARALLEL=0), e:
 *   - misura il tempo dei due percorsi (obiettivo: parallelo nettamente più veloce);
 *   - verifica che header / menu / footer siano IDENTICI su tutte le pagine
 *     (è il rischio del parallelo: ogni pagina è generata separatamente).
 * La voce di menu "attiva" della pagina corrente viene normalizzata via, altrimenti
 * darebbe falsi positivi.
 *
 * Richiede ANTHROPIC_API_KEY (gira sul VPS con la chiave nel .env). È lento e consuma
 * crediti: 2 stili × 2 modalità × 4 pagine. Per un primo giro veloce passa UN solo stile.
 *
 *   Tutti e due gli stili:  npx tsx --env-file=.env demo/verify-parallel.ts
 *   Un solo stile:          npx tsx --env-file=.env demo/verify-parallel.ts editorial-luxury
 */
import { makeAnthropicLLM } from '../src/adapters/index.js';
import { makeAnthropicSiteGenerator, type RouteInfo } from '../src/adapters/anthropic/siteGenerator.js';
import type { ProjectSpec } from '../src/core/index.js';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Manca ANTHROPIC_API_KEY.');
  process.exit(1);
}

const llm = makeAnthropicLLM({ apiKey: key });
// Niente delivery/immagini/foto: confronto il "chrome" puro, senza variabili esterne.
const generator = makeAnthropicSiteGenerator(llm, {});

const routes: RouteInfo[] = [
  { route: '/', label: 'Home' },
  { route: '/servizi', label: 'Servizi' },
  { route: '/chi-siamo', label: 'Chi siamo' },
  { route: '/contatti', label: 'Contatti' },
];

const spec: ProjectSpec = {
  id: 'verify-parallel',
  ownerId: 'verify',
  category: 'business-landing',
  title: 'Studio Lumen',
  description:
    'Studio di video produzione e fotografia a Milano: spot pubblicitari, videoclip ed eventi. Mostra i lavori e i contatti.',
  criteria: [],
};

const ALL_THEMES = ['editorial-luxury', 'creative-studio'] as const;

// --- estrazione e normalizzazione del "chrome" condiviso ---
function pick(html: string, tag: 'header' | 'footer' | 'nav'): string {
  const m = html.match(new RegExp('<' + tag + '[^>]*>[\\s\\S]*?</' + tag + '>', 'i'));
  return m ? m[0] : '';
}
function norm(s: string): string {
  return s
    .replace(/\s*class="active"/g, '')
    .replace(/\s*\bactive\b/g, '')
    .replace(/\s*aria-current="[^"]*"/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+>/g, '>')
    .trim();
}
function allEqual(parts: readonly string[]): boolean {
  return parts.length > 0 && parts.every((p) => p === parts[0]);
}

interface Row {
  theme: string;
  parallel: boolean;
  ms: number;
  ok: boolean;
  err?: string;
  pages?: number;
  headerOk?: boolean;
  navOk?: boolean;
  footerOk?: boolean;
}

async function runOne(theme: string, parallel: boolean): Promise<Row> {
  process.env.BRIK_GEN_PARALLEL = parallel ? '1' : '0';
  const t0 = Date.now();
  const res = await generator.generate(spec, routes, { theme });
  const ms = Date.now() - t0;
  if (!res.ok) return { theme, parallel, ms, ok: false, err: res.error.message };
  const pages = res.value;
  const headers = pages.map((p) => norm(pick(p.html, 'header')));
  const footers = pages.map((p) => norm(pick(p.html, 'footer')));
  const navs = pages.map((p) => norm(pick(p.html, 'nav')));
  const navOk = navs.every((n) => n.length > 0) ? allEqual(navs) : allEqual(headers);
  return {
    theme,
    parallel,
    ms,
    ok: true,
    pages: pages.length,
    headerOk: allEqual(headers),
    footerOk: allEqual(footers),
    navOk,
  };
}

const onlyTheme = process.argv[2];
const themes = onlyTheme ? ALL_THEMES.filter((t) => t === onlyTheme) : [...ALL_THEMES];
if (themes.length === 0) {
  console.error('Stile non valido. Disponibili: ' + ALL_THEMES.join(', '));
  process.exit(1);
}

console.log(
  'Verifica parallelo — motore reale, ' + routes.length + ' pagine, stili: ' + themes.join(', ') + '\n',
);

const rows: Row[] = [];
for (const theme of themes) {
  for (const parallel of [true, false]) {
    const r = await runOne(theme, parallel);
    rows.push(r);
    if (!r.ok) {
      console.log('[' + theme + '] ' + (parallel ? 'PARALLELO ' : 'SEQUENZIALE') + ': ERRORE — ' + r.err);
      continue;
    }
    console.log(
      '[' + theme + '] ' + (parallel ? 'PARALLELO ' : 'SEQUENZIALE') + '  ' + (r.ms / 1000).toFixed(1) + 's  ' +
        'header ' + (r.headerOk ? 'OK' : 'DIVERSO') + '  menu ' + (r.navOk ? 'OK' : 'DIVERSO') + '  footer ' + (r.footerOk ? 'OK' : 'DIVERSO'),
    );
  }
}

console.log('\n=== VELOCITÀ (parallelo vs sequenziale) ===');
for (const theme of themes) {
  const par = rows.find((r) => r.theme === theme && r.parallel && r.ok);
  const seq = rows.find((r) => r.theme === theme && !r.parallel && r.ok);
  if (par && seq && par.ms > 0) {
    console.log(
      theme + ': parallelo ' + (par.ms / 1000).toFixed(1) + 's vs sequenziale ' + (seq.ms / 1000).toFixed(1) +
        's  → ' + (seq.ms / par.ms).toFixed(2) + '× più veloce',
    );
  }
}

console.log('\n=== COERENZA header/menu/footer ===');
const bad = rows.filter((r) => r.ok && (!r.headerOk || !r.navOk || !r.footerOk));
if (bad.length === 0) {
  console.log('IDENTICI su tutte le pagine, in tutti i casi.');
} else {
  for (const r of bad) {
    const diffs = [!r.headerOk ? 'header' : '', !r.navOk ? 'menu' : '', !r.footerOk ? 'footer' : '']
      .filter(Boolean)
      .join(', ');
    console.log('INCOERENZA — ' + r.theme + ' / ' + (r.parallel ? 'parallelo' : 'sequenziale') + ': ' + diffs);
  }
}
