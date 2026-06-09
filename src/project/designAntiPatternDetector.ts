/**
 * Anti-pattern Detector di DESIGN (Fase 2, v1).
 *
 * Gemello concettuale dello scanner di sicurezza (src/security/scanner.ts): una
 * funzione PURA e DETERMINISTICA che riceve l'HTML generato e ne segnala problemi
 * concreti di design/contenuto/immagini/mobile/coerenza. Nessuna chiamata LLM,
 * nessun I/O: costo zero in token, eseguibile anche in preview senza rallentarla.
 *
 * DIFFERENZA FONDAMENTALE dallo scanner di sicurezza: questo strumento è SOLO
 * CONSULTIVO. Non esiste e non deve esistere alcun campo `blocked`. Non ha potere
 * di veto sul publish. Può informare directorReview e guidare una rigenerazione
 * mirata in finalizeProject, ma non può MAI bloccare preview o pubblicazione.
 *
 * v1: solo euristiche ad ALTA e MEDIA confidenza. Le due euristiche semantiche a
 * bassa confidenza ("testo valido per qualsiasi azienda" e "servizi tecnici senza
 * beneficio/rassicurazione") sono LASCIATE FUORI di proposito: richiedono giudizio
 * qualitativo e restano competenza di directorReview.ts. Vedi i TODO in fondo.
 */
import type { CreativeDirection, Industry } from '@core/creativeDirection.js';

// --- Tipi pubblici (contratto da rispettare) --------------------------------

/** Le 11 categorie iniziali. Chiusa: aggiunte future passano da qui. */
export type AntiPatternCategory =
  | 'imagery'
  | 'copy'
  | 'layout'
  | 'mobile'
  | 'footer'
  | 'header'
  | 'cta'
  | 'typography'
  | 'style_fidelity'
  | 'industry_fit'
  | 'generic_template_pattern';

/** Gravità del problema SE reale (impatto sul design). Distinta dalla confidenza. */
export type AntiPatternSeverity = 'high' | 'medium' | 'low';

/** Una singola rilevazione. */
export interface DesignFinding {
  /** Id stabile della regola (per i test e per il logging). */
  readonly rule: string;
  readonly category: AntiPatternCategory;
  readonly severity: AntiPatternSeverity;
  /** 0..1: quanto è affidabile l'euristica (separata da severity). */
  readonly confidence: number;
  readonly message: string;
  /** Snippet che ha fatto scattare la regola (troncato, mai segreti). */
  readonly evidence: string;
  /** Correzione imperativa e azionabile (riusabile come directorNote). */
  readonly suggestedFix: string;
  /** Dove: 'hero' | 'footer' | 'section#3' | una query immagine, ecc. */
  readonly affectedArea: string;
}

/** Contesto della scansione: tutto ciò che non è l'HTML. */
export interface DesignScanContext {
  /** Identità/tema come STRINGA: nessun import da designSystem (disaccoppiato). */
  readonly theme: string;
  readonly industry: Industry;
  /** Per photoAvoid, voce, ctaSeed… Facoltativa (siti vecchi senza direzione). */
  readonly creativeDirection?: CreativeDirection;
  readonly pagePath?: string;
  readonly pageType?: 'home' | 'interior';
}

/**
 * Report: SOLO findings + sintesi. NESSUN campo `blocked`, per costruzione, così è
 * strutturalmente impossibile usarlo come gate di pubblicazione.
 */
export interface AntiPatternReport {
  readonly findings: readonly DesignFinding[];
  readonly summary: {
    readonly total: number;
    readonly byCategory: Partial<Record<AntiPatternCategory, number>>;
    readonly bySeverity: Record<AntiPatternSeverity, number>;
  };
}

// --- Utilità interne ---------------------------------------------------------

const SEVERITY_RANK: Record<AntiPatternSeverity, number> = { high: 3, medium: 2, low: 1 };

/** Estrae il testo grezzo (senza tag) per le euristiche sul contenuto. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Spezza l'HTML in sezioni; se il parsing fallisce, ritorna [] (degrada in silenzio). */
function sections(html: string): string[] {
  const out = html.match(/<section\b[\s\S]*?<\/section>/gi);
  return out ? out : [];
}

/** Tronca un'evidenza per il log/report (mai dump enormi). */
function ev(s: string, n = 80): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// --- Denylist (euristiche a confidenza media) --------------------------------

// Headline generiche: cliché che potrebbero stare su qualsiasi sito.
const GENERIC_HEADLINES = [
  'soluzioni innovative',
  'la qualità al tuo servizio',
  'qualità al tuo servizio',
  'il tuo partner ideale',
  'il partner ideale',
  'soluzioni su misura',
  'eccellenza al tuo servizio',
  'la soluzione che cercavi',
  'innovazione e qualità',
];

// CTA deboli: accettabili una volta, sospette se ripetute ovunque.
const WEAK_CTAS = ['scopri di più', 'scopri di piu', 'leggi di più', 'leggi di piu', 'clicca qui', 'vai'];

// Query immagine troppo vaghe (1-2 parole generiche).
const GENERIC_IMG_TERMS = [
  'business',
  'office',
  'team',
  'people',
  'success',
  'meeting',
  'work',
  'corporate',
  'lifestyle',
  'happy',
];

// Nomi brand generici = etichette di categoria, non nomi propri.
const GENERIC_BRANDS = [
  'studio dentistico',
  'studio legale',
  'agenzia creativa',
  'agenzia',
  'ristorante',
  'studio medico',
  'azienda',
];

// Copy promozionale aggressivo (rilevante soprattutto per editorial-luxury).
const PROMO_WORDS = ['offerta', 'sconto', 'garantito', 'approfitta', 'non perdere', 'subito', 'promo', 'occasione', 'imperdibile'];

// Token "sorriso finto / stock lifestyle" nelle query/alt immagine.
const FAKE_SMILE_TERMS = ['smiling', 'happy team', 'businesspeople', 'business people', 'handshake', 'thumbs up'];

// Emoji: range Unicode principali (alta confidenza).
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}]/u;

// --- Detector ----------------------------------------------------------------

/**
 * Analizza l'HTML e ritorna i findings. PURA e deterministica. Ogni regola è
 * avvolta in try/catch implicito: un'euristica che non riesce a fare il parsing
 * semplicemente non produce findings (degrada in silenzio, mai in errore).
 */
export function scanDesignAntiPatterns(html: string, context: DesignScanContext): AntiPatternReport {
  const findings: DesignFinding[] = [];
  const push = (f: DesignFinding) => findings.push(f);
  const src = html || '';
  const lower = src.toLowerCase();
  const text = stripTags(src).toLowerCase();
  const isEditorial = context.theme === 'editorial-luxury';
  const cd = context.creativeDirection;

  // === ALTA CONFIDENZA =======================================================

  // [emoji-present] — alta. Emoji in un sito premium/editoriale.
  const emojiMatch = src.match(EMOJI_RE);
  if (emojiMatch) {
    push({
      rule: 'emoji-present',
      category: 'typography',
      severity: 'medium',
      confidence: 0.98,
      message: 'Presenza di emoji nel contenuto.',
      evidence: ev(emojiMatch[0]),
      suggestedFix: 'Rimuovi tutte le emoji: il registro deve restare sobrio ed editoriale.',
      affectedArea: 'contenuto',
    });
  }

  // [fake-counter] — alta. data-count è il marcatore di animazione di brik:
  // affidabile, e i temi calmi (editorial/scandinavian) lo vietano.
  const counters = lower.match(/data-count\b/g);
  if (counters && counters.length) {
    push({
      rule: 'fake-counter',
      category: 'generic_template_pattern',
      severity: 'medium',
      confidence: 0.9,
      message: 'Contatori animati (data-count): statistiche che sembrano gonfiate/inventate.',
      evidence: ev(counters.length + '× data-count'),
      suggestedFix: 'Togli i contatori animati: usa pochi numeri statici e veri, senza effetto crescente.',
      affectedArea: 'sezione numeri',
    });
  }

  // [generic-brand] — alta. Il brand è un'etichetta di categoria, non un nome proprio.
  const brandMatch = src.match(/class="brand"[^>]*>([\s\S]*?)<\/a>/i);
  if (brandMatch && brandMatch[1]) {
    const brand = stripTags(brandMatch[1]).toLowerCase().trim();
    if (GENERIC_BRANDS.some((g) => brand === g || brand.startsWith(g))) {
      push({
        rule: 'generic-brand',
        category: 'copy',
        severity: 'high',
        confidence: 0.92,
        message: 'Nome brand generico (etichetta di categoria invece di un nome proprio).',
        evidence: ev(brand),
        suggestedFix: 'Usa un nome proprio credibile (es. ancorato alla città), non l\'etichetta del settore.',
        affectedArea: 'header/brand',
      });
    }
  }

  // === MEDIA CONFIDENZA ======================================================

  // [generic-headline] — media. Cliché in h1/h2.
  const headings = src.match(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi) || [];
  for (const h of headings) {
    const htext = stripTags(h).toLowerCase();
    const hit = GENERIC_HEADLINES.find((g) => htext.includes(g));
    if (hit) {
      push({
        rule: 'generic-headline',
        category: 'copy',
        severity: 'medium',
        confidence: 0.6,
        message: 'Headline generica che potrebbe valere per qualsiasi azienda.',
        evidence: ev(htext),
        suggestedFix: 'Riscrivi il titolo in modo specifico all\'attività: dì cosa fa e per chi, non slogan vuoti.',
        affectedArea: 'headline',
      });
      break; // una segnalazione basta per categoria
    }
  }

  // [repeated-weak-cta] — media. Stessa CTA debole ripetuta ovunque.
  for (const c of WEAK_CTAS) {
    // Conta solo dentro testi di link/bottoni (approssimato): occorrenze totali.
    const re = new RegExp('>\\s*' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*<', 'gi');
    const n = (lower.match(re) || []).length;
    if (n >= 3) {
      push({
        rule: 'repeated-weak-cta',
        category: 'cta',
        severity: 'medium',
        confidence: 0.65,
        message: 'CTA debole e ripetuta identica in molti punti, senza contesto.',
        evidence: ev('"' + c + '" ×' + n),
        suggestedFix: 'Varia le CTA e rendile specifiche all\'azione (es. "Prenota una visita") invece di "' + c + '".',
        affectedArea: 'CTA',
      });
      break;
    }
  }

  // [too-many-primary-buttons] — media. >1 bottone primario nella stessa sezione.
  sections(src).forEach((sec, i) => {
    const primaries = (sec.match(/class="[^"]*\b(?:btn[^"]*\bprimary|btn--solid)\b[^"]*"/gi) || []).length;
    if (primaries > 1) {
      push({
        rule: 'too-many-primary-buttons',
        category: 'cta',
        severity: 'medium',
        confidence: 0.7,
        message: 'Più di un bottone primario nella stessa sezione: gerarchia d\'azione rumorosa.',
        evidence: ev(primaries + ' bottoni primari'),
        suggestedFix: 'Tieni UN solo bottone primario per sezione; gli altri diventano link secondari.',
        affectedArea: 'section#' + (i + 1),
      });
    }
  });

  // [generic-image-query] — media. Query immagine vaghe.
  const imgQueries = [...src.matchAll(/data-brik-img="([^"]*)"/gi)].map((m) => (m[1] || '').toLowerCase());
  for (const q of imgQueries) {
    if (q.startsWith('user:')) continue; // foto reali dell'utente: mai segnalate
    const words = q.split(/\s+/).filter(Boolean);
    const tooVague = words.length > 0 && words.length <= 2 && words.every((w) => GENERIC_IMG_TERMS.includes(w));
    if (tooVague) {
      push({
        rule: 'generic-image-query',
        category: 'imagery',
        severity: 'medium',
        confidence: 0.6,
        message: 'Query immagine troppo generica: porta a stock anonimo.',
        evidence: ev(q),
        suggestedFix: 'Usa query concrete e specifiche al soggetto (materiali, dettagli, ambienti reali), 2-5 parole.',
        affectedArea: 'immagine: "' + ev(q, 40) + '"',
      });
      break;
    }
  }

  // [image-conflicts-photoavoid] — media. Query/alt che toccano i soggetti vietati dell'industry.
  if (cd && cd.photoAvoid && cd.photoAvoid.length) {
    const avoidTokens = cd.photoAvoid
      .join(' ')
      .toLowerCase()
      .match(/[a-zàèéìòù]{4,}/g) || [];
    const haystack = (imgQueries.join(' ') + ' ' + (src.match(/alt="([^"]*)"/gi) || []).join(' ')).toLowerCase();
    const hit = avoidTokens.find((tok) => haystack.includes(tok));
    if (hit) {
      push({
        rule: 'image-conflicts-photoavoid',
        category: 'industry_fit',
        severity: 'medium',
        confidence: 0.6,
        message: 'Immagine in conflitto con i soggetti da evitare per questo settore.',
        evidence: ev(hit),
        suggestedFix: 'Sostituisci con i soggetti consigliati per il settore; evita: ' + cd.photoAvoid.slice(0, 3).join(', ') + '.',
        affectedArea: 'imagery/industry_fit',
      });
    }
  }

  // [dense-footer] — media. Footer con troppe colonne (compresso su mobile).
  const footer = src.match(/<footer\b[\s\S]*?<\/footer>/i);
  if (footer && footer[0]) {
    const cols = (footer[0].match(/class="[^"]*\bcol\b[^"]*"/gi) || []).length;
    if (cols >= 4) {
      push({
        rule: 'dense-footer',
        category: 'footer',
        severity: 'medium',
        confidence: 0.65,
        message: 'Footer con molte colonne: rischio di compressione/taglio su mobile.',
        evidence: ev(cols + ' colonne'),
        suggestedFix: 'Riduci a 2-3 colonne e assicura che orari e contatti restino leggibili su mobile.',
        affectedArea: 'footer',
      });
    }
  }

  // [uniform-card-grid] — media. Molte card identiche con icona: aspetto template.
  const iconCards = (src.match(/class="[^"]*\bcard\b[^"]*"[\s\S]{0,200}?<svg\b/gi) || []).length;
  if (iconCards >= 3) {
    push({
      rule: 'uniform-card-grid',
      category: 'generic_template_pattern',
      severity: 'medium',
      confidence: 0.6,
      message: 'Griglia di card uniformi con icone: aspetto da template generico.',
      evidence: ev(iconCards + ' card con icona'),
      suggestedFix: 'Sostituisci le card-con-icona con voci editoriali con divisori; varia il ritmo dei blocchi.',
      affectedArea: 'layout',
    });
  }

  // [duplicate-section] — media. Due sezioni col testo quasi identico.
  const secs = sections(src).map((s) => stripTags(s).toLowerCase());
  for (let i = 0; i < secs.length; i++) {
    for (let j = i + 1; j < secs.length; j++) {
      const a = secs[i] || '';
      const b = secs[j] || '';
      if (a.length > 40 && a === b) {
        push({
          rule: 'duplicate-section',
          category: 'layout',
          severity: 'medium',
          confidence: 0.7,
          message: 'Due sezioni con contenuto identico/quasi identico.',
          evidence: ev(a),
          suggestedFix: 'Differenzia o unisci le sezioni duplicate: ogni sezione deve aggiungere qualcosa.',
          affectedArea: 'section#' + (i + 1) + ' ~ section#' + (j + 1),
        });
        i = secs.length; // basta una segnalazione
        break;
      }
    }
  }

  // === SPECIFICHE EDITORIAL-LUXURY ==========================================
  // Alta confidenza: in editorial il generatore ha il DIVIETO di scrivere CSS,
  // usare card e icone decorative — la loro presenza è quindi un'anomalia certa.
  if (isEditorial) {
    if (/(?:linear|radial)-gradient\s*\(/i.test(src)) {
      push({
        rule: 'editorial-gradient',
        category: 'style_fidelity',
        severity: 'high',
        confidence: 0.9,
        message: 'Gradiente in tema editoriale (estetica da startup, fuori identità).',
        evidence: ev((src.match(/(?:linear|radial)-gradient\s*\([^)]*\)/i) || [''])[0]),
        suggestedFix: 'Rimuovi i gradienti: palette piatta avorio/nero/grigio/sabbia.',
        affectedArea: 'style_fidelity',
      });
    }
    const svgCount = (src.match(/<svg\b/gi) || []).length;
    if (svgCount > 2) {
      push({
        rule: 'editorial-too-many-icons',
        category: 'style_fidelity',
        severity: 'medium',
        confidence: 0.75,
        message: 'Troppe icone decorative per un tema editoriale.',
        evidence: ev(svgCount + ' <svg>'),
        suggestedFix: 'Togli le icone decorative: l\'editoriale si regge su tipografia e spazio, non icone.',
        affectedArea: 'style_fidelity',
      });
    }
    if (/class="[^"]*\bcard\b[^"]*"/i.test(src)) {
      push({
        rule: 'editorial-saas-cards',
        category: 'style_fidelity',
        severity: 'high',
        confidence: 0.85,
        message: 'Card SaaS-style in tema editoriale (fuori identità).',
        evidence: ev((src.match(/class="[^"]*\bcard\b[^"]*"/i) || [''])[0]),
        suggestedFix: 'Sostituisci le card con blocchi editoriali (voci con divisori, testo+immagine alternati).',
        affectedArea: 'style_fidelity',
      });
    }
    const promoHit = PROMO_WORDS.find((w) => text.includes(w));
    if (promoHit) {
      push({
        rule: 'editorial-promo-copy',
        category: 'copy',
        severity: 'medium',
        confidence: 0.6,
        message: 'Copy promozionale/aggressivo in tema editoriale.',
        evidence: ev(promoHit),
        suggestedFix: 'Togli il tono da volantino: registro calmo, niente offerte/sconti/urgenza.',
        affectedArea: 'copy',
      });
    }
    const smileHit = FAKE_SMILE_TERMS.find((w) => lower.includes(w));
    if (smileHit) {
      push({
        rule: 'editorial-fake-smile-stock',
        category: 'imagery',
        severity: 'medium',
        confidence: 0.6,
        message: 'Immagini stock con sorrisi finti / persone in posa, fuori registro editoriale.',
        evidence: ev(smileHit),
        suggestedFix: 'Sostituisci con dettagli, materiali, mani al lavoro, ambienti reali in luce naturale.',
        affectedArea: 'imagery',
      });
    }
  }

  // --- Sintesi ---------------------------------------------------------------
  const byCategory: Partial<Record<AntiPatternCategory, number>> = {};
  const bySeverity: Record<AntiPatternSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    bySeverity[f.severity] += 1;
  }

  return { findings, summary: { total: findings.length, byCategory, bySeverity } };
}

/**
 * Formatta il report in righe leggibili per il LOG diagnostico (gated da BRIK_DIAG
 * a monte). È PURA: non cambia regole né comportamento, trasforma solo il report
 * già calcolato in stringhe. Una riga di intestazione + una riga per finding con
 * rule, category, severity, confidence, affectedArea, message e suggestedFix.
 */
export function formatFindingsForLog(report: AntiPatternReport): string[] {
  const lines: string[] = [];
  lines.push(
    'DETECTOR findings: ' +
      report.summary.total +
      ' [high ' +
      report.summary.bySeverity.high +
      ' · medium ' +
      report.summary.bySeverity.medium +
      ' · low ' +
      report.summary.bySeverity.low +
      ']',
  );
  for (const f of rankFindings(report.findings)) {
    lines.push(
      ' · rule=' +
        f.rule +
        ' cat=' +
        f.category +
        ' sev=' +
        f.severity +
        ' conf=' +
        f.confidence.toFixed(2) +
        ' area=' +
        f.affectedArea +
        ' | ' +
        f.message +
        ' → ' +
        f.suggestedFix,
    );
  }
  return lines;
}

// --- Ponte verso il sistema esistente ----------------------------------------

/** Ordina i findings per severity, poi confidenza (i più seri e sicuri prima). */
function rankFindings(findings: readonly DesignFinding[]): DesignFinding[] {
  return [...findings].sort((a, b) => {
    const s = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    return s !== 0 ? s : b.confidence - a.confidence;
  });
}

/**
 * Converte i findings rilevanti nelle note imperative che repairSite consuma via
 * il canale `directorNotes`. Default: solo severità >= media, massimo 5.
 */
export function findingsToDirectorNotes(
  report: AntiPatternReport,
  opts?: { minSeverity?: AntiPatternSeverity; max?: number },
): string[] {
  const minRank = SEVERITY_RANK[opts?.minSeverity ?? 'medium'];
  const max = opts?.max ?? 5;
  return rankFindings(report.findings)
    .filter((f) => SEVERITY_RANK[f.severity] >= minRank)
    .slice(0, max)
    .map((f) => f.suggestedFix);
}

/**
 * Sintesi compatta dei findings più rilevanti, pensata per essere passata a
 * directorReview come contesto (poche righe, non l'intero report).
 */
export function summarizeForReview(report: AntiPatternReport, max = 5): string[] {
  return rankFindings(report.findings)
    .slice(0, max)
    .map((f) => `[${f.severity}] ${f.message}`);
}

/* TODO (v2, NON in v1 — richiedono giudizio semantico, competenza di directorReview.ts):
 *  - copy "valido per qualsiasi azienda" (genericità semantica del testo)
 *  - blocchi servizi tecnici senza beneficio/rassicurazione
 * Restano fuori dal codice operativo: il detector deve essere deterministico,
 * non un revisore semantico approssimato.
 */
