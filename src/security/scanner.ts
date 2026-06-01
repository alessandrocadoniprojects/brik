/**
 * Gate di sicurezza pre-pubblicazione (Fase 2, base).
 *
 * Scan euristico, max-default e non personalizzabile: blocca la pubblicazione se
 * trova segreti incorporati, risorse esterne (contro il vincolo "tutto inline"),
 * JS pericoloso o form che inviano dati a domini esterni. Le evidenze NON
 * includono mai il valore del segreto (solo il tipo), per non ri-loggarlo.
 *
 * Severità: high|medium bloccano; low è solo informativa.
 */

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
  /** Quante occorrenze (le evidenze testuali NON vengono incluse). */
  readonly count: number;
}

export interface ScanReport {
  readonly findings: readonly Finding[];
  /** true se almeno un finding ha severità high o medium. */
  readonly blocked: boolean;
}

export interface SecurityScanner {
  scan(html: string): ScanReport;
}

interface Rule {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
  readonly re: RegExp; // con flag g per contare le occorrenze
  /** Se presente, scarta i match che sembrano segnaposto (no segreto reale). */
  readonly ignoreIf?: RegExp;
}

const RULES: readonly Rule[] = [
  // --- segreti incorporati ---
  { severity: 'high', code: 'PRIVATE_KEY', message: 'Chiave privata incorporata nella pagina', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { severity: 'high', code: 'AWS_KEY', message: 'AWS Access Key ID incorporata', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { severity: 'high', code: 'API_KEY_SK', message: 'API key in formato sk-... incorporata', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { severity: 'high', code: 'GITHUB_PAT', message: 'GitHub token incorporato', re: /\bghp_[A-Za-z0-9]{36}\b/g },
  { severity: 'high', code: 'GOOGLE_KEY', message: 'Google API key incorporata', re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { severity: 'high', code: 'SLACK_TOKEN', message: 'Slack token incorporato', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    severity: 'medium',
    code: 'GENERIC_SECRET',
    message: 'Possibile credenziale in chiaro (chiave=valore)',
    re: /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/gi,
    ignoreIf: /your|example|placeholder|changeme|xxx+|<[^>]+>|\.\.\./i,
  },
  // --- risorse esterne (violano "tutto inline") ---
  { severity: 'high', code: 'EXT_SCRIPT', message: 'Script esterno caricato da URL remoto', re: /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi },
  { severity: 'medium', code: 'EXT_STYLESHEET', message: 'Foglio di stile esterno', re: /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']https?:\/\//gi },
  { severity: 'medium', code: 'EXT_IFRAME', message: 'Iframe che incorpora contenuto esterno', re: /<iframe\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi },
  // --- JS pericoloso ---
  { severity: 'high', code: 'EVAL', message: 'Uso di eval()', re: /\beval\s*\(/g },
  { severity: 'high', code: 'NEW_FUNCTION', message: 'Uso di new Function()', re: /\bnew\s+Function\s*\(/g },
  { severity: 'medium', code: 'DOC_WRITE', message: 'Uso di document.write()', re: /\bdocument\.write\s*\(/g },
  { severity: 'low', code: 'JS_URL', message: 'URL javascript: in un attributo', re: /\b(?:href|src)\s*=\s*["']javascript:/gi },
  // --- esfiltrazione via form ---
  { severity: 'medium', code: 'FORM_EXT_ACTION', message: 'Form che invia dati a un dominio esterno', re: /<form\b[^>]*\baction\s*=\s*["']https?:\/\//gi },
];

export function makeBasicSecurityScanner(): SecurityScanner {
  return {
    scan(html) {
      const findings: Finding[] = [];
      for (const rule of RULES) {
        const matches = html.match(rule.re);
        if (!matches || matches.length === 0) continue;
        const kept = rule.ignoreIf ? matches.filter((m) => !rule.ignoreIf!.test(m)) : matches;
        if (kept.length === 0) continue;
        findings.push({ severity: rule.severity, code: rule.code, message: rule.message, count: kept.length });
      }
      const blocked = findings.some((f) => f.severity === 'high' || f.severity === 'medium');
      return { findings, blocked };
    },
  };
}
