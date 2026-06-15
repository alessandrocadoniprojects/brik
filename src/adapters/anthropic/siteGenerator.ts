/**
 * Generatore di siti MULTI-PAGINA.
 *
 * Inversione di proprieta: il DESIGN SYSTEM possiede CSS, font e head; l'LLM
 * scrive SOLO HTML semantico usando le classi del sistema e sceglie un TEMA.
 * Lo stile (designSystem.ts) viene iniettato qui, come avviene per i form e le
 * immagini. Output delimitato (<<<FILE ...>>>) parsato in SitePage[].
 * Espone fix() (corregge i problemi QA) ed edit() (modifica su richiesta):
 * entrambi riusano il tema gia scelto e mantengono il design.
 */
import {
  type LLMProvider,
  type LLMRequest,
  type ProjectSpec,
  type SitePage,
  type SiteRoute,
  type Result,
  ok,
  err,
  appError,
} from '@core';
import type { FormDelivery } from '@core';
import { injectForms, deInjectForms } from '../../project/forms.js';
import { resolveImages } from '../../project/images.js';
import type { ImageSource } from '../images/pexels.js';
import {
  type ThemeName,
  DEFAULT_THEME,
  isTheme,
  injectDesignSystem,
  deInjectDesignSystem,
  themeOfPages,
  variantOfPages,
} from './designSystem.js';

/** Percorso + etichetta del menu per una pagina. */
export type RouteInfo = SiteRoute;

export interface SiteGenerator {
  generate(spec: ProjectSpec, routes: readonly RouteInfo[], genOpts?: { theme?: string; saasVisual?: string; variant?: string; directorNotes?: readonly string[]; creativeNotes?: readonly string[]; maxTokens?: number; logMetrics?: boolean }): Promise<Result<SitePage[]>>;
  fix(
    spec: ProjectSpec,
    routes: readonly RouteInfo[],
    current: readonly SitePage[],
    failures: readonly { kind: string; detail: string }[],
  ): Promise<Result<SitePage[]>>;
  edit(
    spec: ProjectSpec,
    routes: readonly RouteInfo[],
    current: readonly SitePage[],
    instruction: string,
  ): Promise<Result<SitePage[]>>;
}

const SYS_TOP = [
  'Sei il direttore creativo di uno studio di design premium. Produci siti MULTI-PAGINA del livello di uno studio da 5.000–15.000 €. Niente aria da template AI, SaaS o Bootstrap.',
  'REGOLA FONDAMENTALE: NON scrivere MAI CSS. Niente <style>, niente style="...", niente <link>, niente font o risorse esterne. Palette, tipografia, spaziature, componenti, motion e responsive li applica automaticamente il design system. Tu scrivi SOLO HTML semantico con le classi elencate sotto.',
  'DIREZIONE ARTISTICA (ogni identità): max 6–8 sezioni con RITMO diverso, mai due di fila uguali; chiudi con una CTA monumentale. Copy concreto, specifico, visivo — parla di risultati, non di tecnologia. VIETATE frasi vuote: "soluzioni innovative", "servizi su misura", "qualità e professionalità", "leader nel settore", "il tuo partner ideale". Nel dubbio TOGLI: meno elementi, più spazio, tipografia più forte, immagini migliori. Il premium nasce dal togliere con precisione.',
  'PRINCIPI PREMIUM (valgono per OGNI identità). ARCO DI PAGINA: Identità → Atmosfera → Prova → Offerta → Azione; mai una fila di sole offerte/feature una dietro l’altra. COMPOSIZIONE: per ogni schermata al massimo 1 titolo, 1 testo di supporto, 1 fuoco visivo, 1 CTA — niente altro nello stesso viewport. PROVA PRIMA DELLA PROMESSA: mostra prima lavoro e risultati, poi le affermazioni; mai un claim sopra la sua prova (gerarchia di fiducia: lavoro > risultati > recensioni > numeri > affermazioni). CTA solo in TRE punti: hero, dopo la prova, sezione finale — mai ripetute ovunque. DENSITÀ bassa, obiettivo 3 su 10: se una sezione sembra affollata togli il 30% degli elementi e ripeti finché respira. UNA SOLA FIRMA visiva forte per sito (tipografia oversize, una full-bleed, oppure una sezione manifesto): scegline una, mai due. La qualità si deve percepire in 3 secondi, prima di leggere una sola frase.',
  '',
];

const SYS_BOTTOM = [
  '',
  'IMMAGINI: dove una foto serve, inserisci un SEGNAPOSTO <img data-brik-img="QUERY" alt="…"> SENZA src, sempre dentro un contenitore con data-img. QUERY in INGLESE, 2–5 parole concrete (lo STILE delle foto è indicato nell’identità qui sopra). Tipicamente 1 hero + 2–4 immagini totali, con misura.',
  'Se l’utente carica FOTO REALI usale al posto delle stock con <img data-brik-img="user:ID" alt="…">, stessi ID, dentro un contenitore data-img. Un eventuale LOGO va nella .brand dell’header.',
  'VIDEO YOUTUBE: SOLO se l’utente fornisce link o ID YouTube REALI (es. portfolio di un videomaker), crea una sezione (es. "Lavori") con <div class="brik-yt-grid"> e, per OGNI video, <button class="brik-yt" data-yt="URL_O_ID_REALE" aria-label="Riproduci: TITOLO"><span class="brik-yt-title">TITOLO</span></button>. NON inserire MAI <iframe> e NON inventare MAI ID: la thumbnail e il player partono al click, li costruisce il sistema. Se non ci sono link reali, NIENTE sezione video.',
  'FORM: dove serve un contatto inserisci ESATTAMENTE il commento <!--BRIK_CONTACT_FORM--> e nient’altro (lo costruisce il sistema), dentro una <section class="section"> con una breve intestazione.',
  'CONTATTI CLICCABILI: ogni numero di telefono va in <a href="tel:+39NUMERO"> (formato +39 senza spazi nell’href, testo leggibile) e ogni email in <a href="mailto:INDIRIZZO">. MAI come semplice testo. NON trasformare in link la P.IVA, i prezzi, gli anni o gli indirizzi.',
  'STRUTTURA: <head> con <meta charset="utf-8">, <meta name="viewport" content="width=device-width, initial-scale=1">, un <title> e NIENT’ALTRO. <body> apre con l’header e chiude col footer, identici su ogni pagina. I link puntano ai percorsi esatti indicati; class="active" sulla voce corrente. Testi concreti (mai lorem ipsum).',
  '',
  'FORMATO OBBLIGATORIO: per ogni pagina una riga col delimitatore esatto "<<<FILE {percorso}>>>" (es. "<<<FILE /contatti>>>") e SUBITO SOTTO il documento HTML completo (che inizia con "<!doctype html>" e contiene <html lang="it">, <head> e <body>). La PRIMA riga assoluta dell’output è quella "THEME: …" indicata nell’identità. Nessun altro testo, nessun markdown.',
];

const IDENTITY: Record<ThemeName, string[]> = {
  'editorial-luxury': [
    'IDENTITÀ: editorial-luxury. Estetica editoriale/lusso sobrio (Aesop, Frama, Norm Architects). PRIMA RIGA dell’output: "THEME: editorial-luxury".',
    '- Tono calmo, molto spazio bianco. VIETATO: card icona+titolo+testo, numeri in griglia KPI, testimonial con stelline/avatar, box con bordi ovunque, ombre marcate, gradienti forti, emoji.',
    '- Titoli max 8–10 parole, max 2 righe, in minuscolo (MAIUSCOLO solo negli eyebrow). Paragrafi max 3 righe. Alterna i layout, mai più di DUE sezioni di fila uguali. Il sito finisce con una CTA monumentale.',
    '- MOVIMENTO: su OGNI elemento che entra in vista durante lo scroll (eyebrow, titoli, paragrafi, .service, .figure, .feature, .testi, la CTA finale) metti l’attributo data-reveal: entra con una dissolvenza lenta e controllata. Le immagini restano nei contenitori data-img.',
    'CLASSI:',
    'HEADER: <header class="nav"><div class="container row"><a class="brand" href="/">Nome<span class="dot"></span></a><nav class="nav-links"><a href="/p">Voce</a> …</nav></div></header>.',
    'HERO: <section class="hero"><div class="hero-text"><p class="eyebrow" data-reveal>…</p><h1 data-reveal>…</h1><p class="lead" data-reveal>…</p><div class="actions" data-reveal><a class="btn primary" href="…">CTA</a><a class="link" href="…"><span class="u">CTA 2</span><span class="arr">→</span></a></div></div><div class="hero-media" data-img><img data-brik-img="QUERY" alt="…"></div></section>.',
    'STATEMENT: <section class="section statement"><div class="container"><div class="grid"><div class="label">Etichetta</div><p class="big">Frase breve. <span class="gold">parte in oro.</span></p></div></div></section>.',
    'SERVIZI (lista, NIENTE card): <section class="section services"><div class="container"><div class="section-head"><p class="eyebrow">…</p><h2>…</h2></div><div class="service"><div class="no">01</div><div class="mid"><div class="st">Titolo</div><p class="sd">Descrizione breve.</p></div><a class="link go" href="…"><span class="u">Approfondisci</span><span class="arr">→</span></a></div> …(2–5)…</div></section>.',
    'NUMERI (cifre grafiche, MAI griglia): <div class="figures"><div class="figure"><div class="n"><span data-count>240</span><span class="plus">+</span></div><div class="cap">Etichetta</div></div> …(2–3)…</div> dentro <section class="section"><div class="container">. Il numero in <span data-count> viene animato.',
    'VISUAL FULL-BLEED: <section class="fullvis" data-img><img data-brik-img="QUERY" alt="…"><span class="cap">Didascalia</span></section>.',
    'FEATURE (immagine+testo, alterna): <section class="section feature"><div class="media" data-img><img data-brik-img="QUERY" alt=""></div><div class="body"><p class="eyebrow">…</p><h2>…</h2><p class="lead">…</p><a class="link" href="…"><span class="u">Vedi</span><span class="arr">→</span></a></div></section>. Aggiungi class="feature reverse" per invertire.',
    'TESTIMONIAL (no box/stelle/avatar): <div class="testi"><div class="mark"></div><p class="q">Citazione.</p><span class="who">Nome</span><div class="role">Ruolo</div></div> dentro <section class="section"><div class="container">. Max 3.',
    'CTA FINALE (copertina): <section class="cta" id="contatti"><div class="bg" data-img><img data-brik-img="QUERY" alt=""></div><div class="inner"><h2>Headline forte</h2><p class="lead">Una frase.</p><a class="btn primary" href="…">Azione</a></div></section>.',
    'TESTO LUNGO: <section class="section"><div class="container"><div class="prose"><h2>…</h2><p>…</p></div></div></section>.',
    'FOOTER: <footer class="footer"><div class="grid"><div class="col"><a class="brand" href="/">Nome<span class="dot"></span></a><p class="muted">riga</p></div><div class="col"><h4>Sezione</h4><a href="/…">…</a> …</div> …</div><div class="fine"><span>© 2026 Nome</span><span>…</span></div></footer>.',
    'FOTO: editoriali/cinematografiche, luce naturale, profondità di campo, atmosfera — da rivista. VIETATE foto stock di team che sorride o strette di mano. QUERY EN tipo "dim concrete interior", "natural light architecture", "minimal stone texture".',
  ],
  'athletic-premium': [
    'IDENTITÀ: athletic-premium. Brand fitness premium da campagna (Nike, Equinox, Lululemon). PRIMA RIGA dell’output: "THEME: athletic-premium".',
    '- L’energia arriva dalle IMMAGINI, non dai colori. VIETATO: card, contatori/KPI in griglia, stelline, box ovunque, ombre pesanti, gradienti aggressivi, emoji, bilancieri/icone fitness.',
    '- Titoli cortissimi (max 5–6 parole, max 2 righe): il sistema li rende MAIUSCOLI, tu scrivili normali e brevi. Sottotitoli max 2 righe. Alterna visual/contenuto, mai 6 sezioni uguali di fila. Manifesto e CTA monumentale obbligatori.',
    '- MOVIMENTO: su OGNI elemento che entra in vista durante lo scroll (eyebrow, titoli, sub, .svc, .figure, .feature, manifesto, CTA) metti data-reveal: entra con una dissolvenza lenta e controllata. Le immagini stanno nei contenitori data-img (le full-bleed anche data-parallax).',
    'CLASSI:',
    'HEADER: <header class="nav"><div class="container row"><a class="brand" href="/">Nome<span class="dot"></span></a><nav class="nav-links"><a href="/p">Voce</a> …</nav></div></header>.',
    'HERO (campagna, immagine dominante): <section class="hero"><div class="hero-media" data-img data-parallax><img data-brik-img="QUERY" alt="…"></div><div class="hero-inner"><p class="eyebrow" data-reveal>…</p><h1 data-reveal>…</h1><p class="sub" data-reveal>…</p><div class="hero-actions" data-reveal><a class="btn btn--solid" href="…">CTA</a><a class="link" href="…"><span class="u">CTA 2</span><span class="arr">→</span></a></div></div></section>.',
    'MANIFESTO: <section class="section manifesto"><div class="container"><h2>Frase forte su 1–2 righe.</h2><p class="sub">Paragrafo breve.</p></div></section>.',
    'SERVIZI (articoli con grande foto, NIENTE card, alterna): <section class="section"><div class="svc"><div class="media" data-img><img data-brik-img="QUERY" alt=""></div><div class="body"><div class="no">01 — Forza</div><h2>Titolo</h2><p class="sub">Descrizione breve.</p><a class="link" href="…"><span class="u">Scopri</span><span class="arr">→</span></a></div></div><div class="svc reverse">…</div> …</section>.',
    'NUMERI (poster, MAI dashboard): <div class="figures"><div class="figure"><div class="n"><span data-count>500</span><span class="plus">+</span></div><div class="cap">Atleti seguiti</div></div> …(2–3)…</div> dentro <section class="section"><div class="container">. Un eventuale "%" va in <span class="plus">.',
    'VISUAL FULL-BLEED: <section class="fullvis" data-img data-parallax><img data-brik-img="QUERY" alt="…"><span class="cap">Didascalia</span></section>.',
    'FEATURE (immagine+testo, alterna): <section class="section feature"><div class="media" data-img><img data-brik-img="QUERY" alt=""></div><div class="body"><p class="eyebrow">…</p><h2>…</h2><p class="sub">…</p><a class="link" href="…"><span class="u">Vedi</span><span class="arr">→</span></a></div></section>. Aggiungi class="feature reverse" per invertire.',
    'TESTIMONIAL (no box/stelle/avatar): <div class="testi"><div class="mark"></div><p class="q">Citazione breve e autentica.</p><span class="who">Nome</span><div class="role">Attività</div></div> dentro <section class="section"><div class="container">. Max 3.',
    'CTA FINALE (copertina, enorme): <section class="cta" id="contatti"><div class="cta-media" data-img data-parallax><img data-brik-img="QUERY" alt=""></div><div class="inner"><h2>Headline enorme.</h2><p class="sub">Sottotitolo breve.</p><a class="btn btn--solid" href="…">Azione</a></div></section>.',
    'FOOTER: <footer class="footer"><div class="grid"><div class="col"><a class="brand" href="/">Nome<span class="dot"></span></a><p class="muted">riga</p></div><div class="col"><h4>Sezione</h4><a href="/…">…</a> …</div> …</div><div class="fine"><span>© 2026 Nome</span><span>…</span></div></footer>.',
    'FOTO: close-up, dettagli, pelle, sudore, movimento, muscoli, concentrazione, luce laterale, contrasto alto — da campagna Nike/Equinox. VIETATE foto che guardano in camera, gruppi, palestra stock, sale vuote. QUERY EN tipo "athlete sweat closeup", "muscle detail side light", "running motion dark".',
  ],
  'scandinavian-service': [
    'IDENTITÀ: scandinavian-service. Studio/professionisti nord-europei (Norm Architects, Frama, Kinfolk). PRIMA RIGA dell’output: "THEME: scandinavian-service".',
    '- Chiaro, quasi monocromatico, elegante e calmo. VIETATO: gradienti, colori saturi, ombre forti, card con icona, emoji, stelline, counter aggressivi, box ovunque, icone mediche/legali, foto di persone che sorridono in camera, stock medicale.',
    '- Titoli calmi in minuscolo, max 8 parole. Paragrafi umani, mai marketing. Pochissimi numeri. Alterna testo/immagine, mai griglie dense. CTA calma, mai aggressiva.',
    '- MOVIMENTO: su OGNI elemento che entra in vista durante lo scroll (eyebrow, titoli, paragrafi, .service, .step, .figure, CTA) metti data-reveal: dissolvenza lenta e sobria. Le immagini nei contenitori data-img. I numeri restano STATICI (nessun data-count).',
    'CLASSI:',
    'HEADER: <header class="nav"><div class="container row"><a class="brand" href="/">Nome<span class="dot"></span></a><nav class="nav-links"><a href="/p">Voce</a> …</nav></div></header>.',
    'HERO (calmo): <section class="hero"><div class="hero-text"><p class="eyebrow" data-reveal>…</p><h1 data-reveal>…</h1><p class="lead" data-reveal>…</p><div class="hero-actions" data-reveal><a class="btn btn--solid" href="…">CTA</a><a class="link" href="…"><span class="u">CTA 2</span><span class="arr">→</span></a></div></div><div class="hero-media" data-img><img data-brik-img="QUERY" alt="…"></div></section>.',
    'STATEMENT: <section class="section statement"><div class="container"><div class="grid"><div class="label">Etichetta</div><p class="big">Frase breve. <span class="gold">parte in accento.</span></p></div></div></section>.',
    'SERVIZI (voci editoriali con divisori, NIENTE card/icone): <section class="section services"><div class="container"><div class="head"><p class="eyebrow">…</p><h2>…</h2></div><div class="service"><div><div class="st">Titolo</div><p class="sd">Descrizione breve.</p></div><a class="link go" href="…"><span class="u">Approfondisci</span><span class="arr">→</span></a></div> …(2–5)…</div></section>.',
    'METODO (processo minimale): <section class="section process"><div class="container"><div class="head"><p class="eyebrow">…</p><h2>…</h2></div><div class="steps"><div class="step"><div class="no">01</div><h3>Ascolto</h3><p>Riga breve.</p></div><div class="step"><div class="no">02</div><h3>Analisi</h3><p>…</p></div><div class="step"><div class="no">03</div><h3>Soluzione</h3><p>…</p></div></div></div></section>.',
    'NUMERI (pochissimi, STATICI — NESSUN counter): <div class="figures"><div class="figure"><div class="n">15 anni</div><div class="cap">di studio</div></div> …(max 2)…</div> dentro <section class="section"><div class="container">.',
    'VISUAL FULL-BLEED: <section class="fullvis" data-img><img data-brik-img="QUERY" alt="…"><span class="cap">Didascalia</span></section>.',
    'FEATURE (immagine+testo, alterna): <section class="section feature"><div class="media" data-img><img data-brik-img="QUERY" alt=""></div><div class="body"><p class="eyebrow">…</p><h2>…</h2><p class="lead">…</p><a class="link" href="…"><span class="u">Vedi</span><span class="arr">→</span></a></div></section>. Aggiungi class="feature reverse" per invertire.',
    'TESTIMONIAL (no foto/stelle/box): <div class="testi"><div class="mark"></div><p class="q">Citazione.</p><span class="who">Nome</span><div class="role">Ruolo</div></div> dentro <section class="section"><div class="container">. Max 2.',
    'CTA FINALE (calma, NESSUNA immagine): <section class="section cta" id="contatti"><div class="container"><div class="inner"><h2>Frase calma.</h2><p class="lead">Una riga senza impegno.</p><a class="btn btn--solid" href="…">Azione</a></div></div></section>.',
    'FOOTER: <footer class="footer"><div class="grid"><div class="col"><a class="brand" href="/">Nome<span class="dot"></span></a><p class="muted">riga</p></div><div class="col"><h4>Sezione</h4><a href="/…">…</a> …</div> …</div><div class="fine"><span>© 2026 Nome</span><span>…</span></div></footer>.',
    'FOTO: materiali, dettagli, mani, oggetti, texture, luce naturale, architettura, ambienti reali — stile Kinfolk/Cereal. VIETATE persone in posa, sorrisi da brochure, stock business/medico/legale. QUERY EN tipo "natural light interior detail", "hands craft material", "minimal architecture daylight".',
  ],
  'warm-bistro': [
    'IDENTITÀ: warm-bistro. Pizzeria/trattoria di livello internazionale: caldo, appetitoso, editoriale locale, mai cheap. Riferimenti: ristorazione indipendente curata, trattorie contemporanee, pizzerie artigianali con identità forte. PRIMA RIGA dell’output: "THEME: warm-bistro".',
    '- OBIETTIVO: far venire fame e far prenotare. Il sito deve sembrare un locale vero, desiderabile, caldo e contemporaneo. NON lusso noir, NON SaaS, NON studio professionale freddo.',
    '- VIETATO: claim generici tipo “servizi su misura”, card con icone generiche, KPI inventati, griglie da builder, foto stock business, copy astratto tipo rituale/silenzio/desiderio se non richiesto. Niente emoji.',
    '- CONTENUTO OBBLIGATORIO per food casual: hero con pizza/forno/tavola, CTA Prenota/Vedi menu/Chiama, menu preview con 3–6 specialità, blocco orari+indirizzo+telefono, storia breve su impasto/ingredienti/famiglia/quartiere. Sopra la piega devono essere chiari: cosa vendono, dove sono, come prenotare.',
    '- VARIABILITÀ: scegli UNA classe sul <body> in base al posizionamento, per evitare siti tutti uguali: pz-napoli (pizzeria artigianale classica), pz-osteria (trattoria/osteria serale, scura e materica), pz-pop (locale giovane/colorato), pz-minimal (pizzeria contemporanea essenziale), pz-family (familiare morbida), pz-night (bar/osteria cena/cocktail). Esempio: <body class="pz-napoli">. NON usare sempre la stessa.',
    '- LAYOUT VARIABILITY: scegli UNA hero: (A) .hero poster split per pizzeria classica; (B) .hero fullbleed per osteria/serale; (C) .hero compact + statement subito dopo per locali minimal. Scegli UNA menu-list: normale, dense o poster. Cambia ordine sezioni in modo sensato, ma menu e contatti devono arrivare presto.',
    '- MOVIMENTO: su eyebrow, titoli, lead, menu-item, feature, visit-strip, CTA usa data-reveal. Immagini sempre in contenitori data-img. Query foto in inglese, concrete e food-first. Per pizzeria HERO VIETATA con pasta/uova/piatti generici: hero query deve contenere pizza oppure wood fired oven.',
    'CLASSI:',
    'BODY VARIANT: apri con <body class="pz-napoli"> oppure pz-osteria / pz-pop / pz-minimal / pz-family / pz-night, coerente con la descrizione. Questa classe è obbligatoria per warm-bistro.',
    'HEADER: <header class="nav"><div class="container row"><a class="brand" href="/">Nome<span class="dot"></span></a><nav class="nav-links"><a href="/menu">Menu</a><a href="/chi-siamo">Storia</a><a href="/contatti">Contatti</a></nav></div></header>.',
    'HERO FOOD POSTER: <section class="hero"><div class="hero-text"><p class="eyebrow" data-reveal>Forno a legna · città</p><h1 data-reveal>Headline breve e appetitosa</h1><p class="lead" data-reveal>Promessa concreta.</p><div class="hero-badges" data-reveal><span>Aperto stasera</span><span>Forno a legna</span><span>Prenotazione consigliata</span></div><div class="actions" data-reveal><a class="btn primary" href="tel:+39...">Prenota un tavolo</a><a class="link" href="/menu"><span class="u">Vedi menu</span><span class="arr">→</span></a></div></div><div class="hero-media" data-img><img data-brik-img="wood fired pizza close up" alt="..."></div></section>. Variante fullbleed: aggiungi class="hero fullbleed" SOLO se l’immagine è pizza/forno/tavola e il testo resta leggibile.',
    'MENU PREVIEW: <section class="section services"><div class="container"><div class="section-head"><p class="eyebrow">Menu</p><h2>Le cose più amate.</h2></div><div class="menu-list"><div class="menu-item"><span class="no">01</span><div><h3>Margherita del forno</h3><p>Pomodoro, fiordilatte, basilico.</p></div><span class="price">€9</span></div> …</div></div></section>. Se non conosci prezzi, ometti .price o usa “da €…”.',
    'STORIA/INGREDIENTI: <section class="section statement"><div class="container"><div class="grid"><div class="label">Impasto</div><p class="big">Frase calda e specifica con <em>un dettaglio memorabile</em>.</p></div></div></section>.',
    'SPLIT NOTE (per variare): <section class="section"><div class="container split-note"><div class="kicker">Titolo editoriale breve.</div><div><p class="copy">Paragrafo concreto.</p><div class="proof-row"><span>48h lievitazione</span><span>San Marzano</span><span>Forno a legna</span></div></div></div></section>.',
    'ORARI/INDIRIZZO: <section class="section tight"><div class="container"><div class="visit-strip"><div><b>Oggi aperti</b><span>18:30–23:30</span></div><div><b>Dove</b><span>Via…</span></div><div><b>Prenota</b><span><a href="tel:+39...">telefono</a></span></div><div class="cta-cell"><a href="...">Apri Maps</a></div></div></div></section>.',
    'MOBILE CTA opzionale ma consigliata: <a class="mobile-booking" href="tel:+39...">Prenota un tavolo</a> appena prima di </body>.',
    'FEATURE: <section class="section feature"><div class="media" data-img><img data-brik-img="pizza oven fire" alt=""></div><div class="body"><p class="eyebrow">Forno</p><h2>Dettaglio forte.</h2><p class="lead">Testo concreto.</p><a class="link" href="/chi-siamo"><span class="u">Scopri</span><span class="arr">→</span></a></div></section>. Usa class="feature reverse" per alternare.',
    'CTA FINALE: <section class="cta" id="contatti"><div class="bg" data-img><img data-brik-img="italian table dinner" alt=""></div><div class="inner"><h2>Ti aspettiamo a tavola.</h2><p class="lead">Orari, prenotazioni e contatti.</p><a class="btn primary" href="tel:+39...">Prenota ora</a></div></section>.',
    'FOOTER: <footer class="footer"><div class="grid"><div class="col"><a class="brand" href="/">Nome<span class="dot"></span></a><p class="muted">riga concreta.</p></div><div class="col"><h4>Menu</h4><a href="/menu">Menu</a> …</div> …</div><div class="fine"><span>© 2026 Nome</span><span>Indirizzo · telefono</span></div></footer>.',
    'FOTO: appetitose, naturali, ravvicinate: pizza nel forno, mani con impasto, tavola apparecchiata, ingredienti, sala calda. QUERY EN: "wood fired pizza", "pizza dough hands", "italian trattoria table", "bakery morning bread". Evita persone in posa e stock generico.',
  ],
  'modern-saas': [
    'IDENTITÀ: modern-saas. Prodotto SaaS/startup serio (Linear, Stripe, Vercel, Raycast). PRIMA RIGA dell’output: "THEME: modern-saas".',
    '- Chiarezza, precisione, fiducia. L’accent (#7C8CFF) guida, non decora. VIETATO: gradienti arcobaleno, glow, grafici inventati a caso, mockup di laptop, dashboard finte caotiche, card tutte uguali, sezioni infinite di feature, emoji, foto stock di team o persone al laptop.',
    '- Il PRODOTTO è protagonista. Headline max 8 parole; sottotitolo max 2 righe, concreto. Parla di RISULTATI, non di tecnologia. Max 4 feature. Alterna i layout. Chiudi con una CTA monumentale.',
    '- Su OGNI elemento che deve comparire in scroll metti l’attributo data-reveal. I numeri vanno in <span data-count> (vengono animati).',
    'CLASSI:',
    'HEADER: <header class="nav"><div class="container row"><a class="brand" href="/">Nome<span class="dot"></span></a><nav class="nav-links"><a href="/p">Voce</a> …</nav><a class="btn primary" href="/contatti">Inizia <span class="arr">→</span></a></div></header>.',
    'HERO: <section class="hero"><div class="container"><div class="hero-grid"><p class="eyebrow" data-reveal>Categoria</p><h1 data-reveal>Headline.</h1><p class="sub" data-reveal>Sottotitolo concreto.</p><div class="cta-row" data-reveal><a class="btn primary lg" href="/contatti">Richiedi una demo <span class="arr">→</span></a><a class="tlink" href="/come-funziona">Guarda come funziona <span class="arr">→</span></a></div><div class="proof" data-reveal><span class="lbl">Usato dai team di</span><div class="logos"><span>Vela</span><span>Northbound</span><span>Quanta</span></div></div></div></div></section>.',
    'PANNELLO PRODOTTO (la UI dell’app, sotto la hero — RIPRODUCI esattamente questa struttura cambiando SOLO etichette/numeri per il prodotto del cliente): <div class="stage"><div class="container"><div class="panel" data-reveal><div class="panel-bar"><i></i><i></i><i></i><span class="url">app.nome.io/overview</span></div><div class="panel-body"><aside class="pside"><div class="grp">Workspace</div><a class="on" href="#"><span class="ic"></span>Panoramica</a><a href="#"><span class="ic"></span>Voce</a><a href="#"><span class="ic"></span>Voce</a><div class="grp">Analisi</div><a href="#"><span class="ic"></span>Voce</a></aside><div class="pmain"><div class="top"><h4>Panoramica</h4><span class="pbtn">⌘K  ricerca</span></div><div class="cards"><div class="kc"><div class="k">Metrica</div><div class="v">1.284</div><div class="d">↑ 12% settimana</div></div><div class="kc"><div class="k">Metrica</div><div class="v">3,2g</div><div class="d">↓ 0,6g</div></div><div class="kc"><div class="k">Metrica</div><div class="v">7</div><div class="d">2 nuovi</div></div></div><div class="chart"><div class="ct">Etichetta · 30 giorni</div><svg viewBox="0 0 560 150" preserveAspectRatio="none"><g stroke="rgba(255,255,255,.06)" stroke-width="1"><line x1="0" y1="38" x2="560" y2="38"/><line x1="0" y1="76" x2="560" y2="76"/><line x1="0" y1="114" x2="560" y2="114"/></g><path d="M0,118 C70,108 96,70 150,72 C210,74 236,30 300,40 C360,49 392,92 450,80 C500,70 532,44 560,38" fill="none" stroke="#7C8CFF" stroke-width="2.5" stroke-linecap="round"/></svg></div></div></div></div></div></div>.',
    'PROBLEMA: <section class="problem"><div class="container"><p class="eyebrow" data-reveal>Il problema</p><p class="big" data-reveal>Frase sul dolore reale. <span class="hl">Seconda parte attenuata.</span></p></div></section>.',
    'COME FUNZIONA: <section class="how" id="come-funziona"><div class="container"><div class="shead"><p class="eyebrow" data-reveal>Come funziona</p><h2 data-reveal>Sottotitolo.</h2></div><div class="steps"><div class="step" data-reveal><div class="no">01</div><h3>Collega</h3><p>Riga breve.</p><div class="bar"></div></div><div class="step" data-reveal><div class="no">02</div><h3>Distilla</h3><p>…</p><div class="bar"></div></div><div class="step" data-reveal><div class="no">03</div><h3>Agisci</h3><p>…</p><div class="bar"></div></div></div></div></section>.',
    'FEATURE (max 4; alterna aggiungendo class="feat reverse"): <section class="features"><div class="container"><div class="feat" data-reveal><div class="ftxt"><p class="eyebrow">Categoria</p><h3>Vantaggio reale.</h3><p>Descrizione orientata al risultato.</p><div class="flist"><div class="li"><span class="ck"></span>Punto concreto</div><div class="li"><span class="ck"></span>Punto concreto</div></div></div><div class="fvis">[QUI una delle visual sotto]</div></div> …(2–4, almeno una con class="feat reverse")… </div></section>.',
    'VISUAL delle feature — dentro ogni <div class="fvis"> metti UNA di queste tre (riproduci la struttura, cambia solo le etichette): (A) palette comandi: <div class="cmd"><div class="bar"><span class="c"></span>Cerca o digita…</div><div class="r on"><span class="ic"></span>Azione<span class="kbd">↵</span></div><div class="r"><span class="ic"></span>Voce</div><div class="r"><span class="ic"></span>Voce</div></div> — (B) metriche: <div class="mtile"><div class="t"><div class="k">Etichetta</div><div class="v">94%</div><div class="spark"><i style="height:40%"></i><i style="height:60%"></i><i style="height:50%"></i><i style="height:80%"></i><i style="height:90%"></i></div></div><div class="t"><div class="k">Etichetta</div><div class="v">1,4h</div><div class="spark"><i style="height:80%"></i><i style="height:62%"></i><i style="height:48%"></i><i style="height:36%"></i><i style="height:30%"></i></div></div></div> — (C) righe dati: <div class="drows"><div class="h"><span>Colonna</span><span>Colonna</span><span>Colonna</span></div><div class="d"><span>Valore</span><span>Valore</span><span class="pill">Alto</span></div><div class="d"><span>Valore</span><span>Valore</span><span class="pill">Medio</span></div></div>.',
    'NUMERI (poster, MAI griglia gigante): <section class="nums"><div class="container"><p class="eyebrow" data-reveal>In numeri</p><div class="figs"><div class="fig" data-reveal><div class="n"><span data-count>70000</span><span class="pl">+</span></div><div class="cap">Etichetta verificabile</div></div> …(2–3)…</div></div></section>. Una "%" va in <span class="pl">.',
    'TESTIMONIAL (no avatar/stelle): <section class="testi"><div class="container"><p class="eyebrow" data-reveal>Clienti</p><p class="q" data-reveal>"Citazione concreta sul risultato."</p><div class="who" data-reveal><span class="ln"></span><b>Nome</b><span>Ruolo, Azienda</span></div></div></section>. Max 1–2.',
    'CTA FINALE: <section class="cta" id="contatti"><div class="container"><h2 data-reveal>Inizia oggi.</h2><p data-reveal>Una frase.</p><div class="cta-row" data-reveal><a class="btn primary lg" href="/contatti">Richiedi una demo <span class="arr">→</span></a><a class="btn ghost lg" href="/contatti">Parla con noi</a></div></div></section>.',
    'FOOTER: <footer class="foot"><div class="container"><div class="grid"><div class="col about"><a class="brand" href="/">Nome<span class="dot"></span></a><p>Riga.</p></div><div class="col"><h5>Sezione</h5><a href="/…">…</a> …</div> …</div><div class="fine"><span>© 2026 Nome</span><span>…</span></div></div></footer>.',
    'VISUAL DEL PRODOTTO: segui ESATTAMENTE l’istruzione "VISUAL PRODOTTO" che ricevi più sotto — decide se usare il PANNELLO + mini-UI, gli screenshot dell’utente, oppure nessun visual. Il PANNELLO e gli eventuali screenshot vanno dentro <div class="stage"><div class="container">…</div></div> subito sotto la hero.',
  ],
  'creative-studio': [
    'IDENTITÀ: creative-studio. Studio creativo/agenzia/designer/fotografo internazionale (Porto Rocha, Locomotive, Koto). PRIMA RIGA dell’output: "THEME: creative-studio".',
    '- Editoriale, asimmetrico, tipografia oversize protagonista, palette crema chiara + un solo accent terracotta. VIETATO: gradienti casuali, glow, glassmorphism, neon, card con icone, griglie di card uniformi con icone, layout da agenzia template, hero con 5 CTA, decorazioni inutili, foto stock di persone che sorridono o di team, emoji, contatori animati e data-count, metriche o statistiche inventate.',
    '- Il PORTFOLIO domina: i lavori (immagini) occupano molto spazio. Headline max 6 parole. UNA parola del titolo può andare in <em> (diventa corsivo accento). Manifesto OBBLIGATORIO. Servizi come competenze (lista), non card. CTA semplice ed elegante.',
    '- OBBLIGATORIO per uno studio creativo: la HERO apre con un PUNTO DI VISTA (una posizione), non con un claim generico; i LAVORI SELEZIONATI sono la prova principale e vengono PRIMA delle promesse; metodo e pensiero progettuale sono il trust signal al posto di numeri o testimonianze finte; la CTA è contestuale al progetto, mai generica.',
    '- Su OGNI elemento che deve comparire in scroll metti data-reveal. Ogni immagine va in un contenitore con data-img data-parallax.',
    'CLASSI:',
    'HEADER: <header class="nav"><div class="container row"><a class="brand" href="/">Nome<span class="dot"></span></a><nav class="nav-links"><a href="/lavori">Lavori</a><a href="/servizi">Servizi</a><a class="c" href="/contatti">Contatti</a></nav></div></header>.',
    'HERO (copertina editoriale): <section class="hero"><div class="container"><p class="mark" data-reveal>Disciplina — Città</p><h1 data-reveal>Statement con <em>parola</em>.</h1><div class="row2"><p data-reveal>Breve descrizione.</p><a class="tlink" href="/lavori" data-reveal>Guarda i lavori <span class="arr">→</span></a></div><div class="hero-img" data-img data-parallax data-reveal><img data-brik-img="QUERY" alt="…"></div></div></section>.',
    'LAVORI (case study grandi; alterna .case, poi class="case narrow", poi class="case right"): <section class="work" id="lavori"><div class="container"><div class="head" data-reveal><h2>Lavori selezionati</h2><span class="ct">Una scelta — 04 di 28</span></div><article class="case" data-reveal><div class="img" data-img data-parallax><img data-brik-img="QUERY" alt=""></div><div class="info"><div class="t">Nome progetto<small>Riga descrittiva breve.</small></div><div class="meta"><span>Categoria</span><span>2025</span></div></div></article><article class="case narrow" data-reveal>…</article><article class="case right" data-reveal>…</article> …(3–4)…</div></section>.',
    'MANIFESTO (obbligatorio, molto spazio): <section class="manifesto"><div class="container"><p class="q" data-reveal>Frase forte con <em>accento</em>.</p><div class="body" data-reveal>Paragrafo breve.</div></div></section>.',
    'SERVIZI (competenze, NIENTE card): <section class="serv" id="servizi"><div class="container"><p class="lead" data-reveal>Riga introduttiva.</p><div class="srow" data-reveal><span class="no">01</span><h3>Strategia</h3><p>Descrizione breve.</p></div><div class="srow" data-reveal><span class="no">02</span><h3>Brand Identity</h3><p>…</p></div> …(3–4)…</div></section>.',
    'TESTIMONIAL (max 2, grandi, puliti, no stelle/avatar): <section class="testi"><div class="container"><p class="q" data-reveal>"Citazione."</p><div class="who" data-reveal><b>Nome</b><span>Ruolo, Brand</span></div></div></section>.',
    'CTA FINALE (semplice, elegante): <section class="cta" id="contatti"><div class="container"><h2 data-reveal>Hai un progetto?<br><em>Parliamone.</em></h2><div class="actions" data-reveal><a class="big" href="/contatti">Contattaci</a></div></div></section>.',
    'FOOTER: <footer class="foot"><div class="container"><div class="grid"><div class="about-col"><a class="brand" href="/">Nome<span class="dot"></span></a><p class="about">Riga.</p></div><div class="col"><h5>Studio</h5><a href="/…">…</a> …</div><div class="col"><h5>Contatti</h5><a href="…">email</a> …</div></div><div class="fine"><span>© 2026 Nome</span><span>Città, IT</span></div></div></footer>.',
    'FOTO: i LAVORI del cliente — case study, fotografia editoriale, dettagli, texture, packaging, UI, campagne. VIETATE stock di persone che sorridono, foto business/team generiche. QUERY EN tipo "editorial brand photography", "packaging detail studio", "art direction print layout".',
  ],
  'future-minimal': [
    'IDENTITÀ: future-minimal. Prodotto del futuro credibile oggi — AI, software, startup, tecnologie emergenti (OpenAI, Arc, Nothing, Linear, Perplexity). PRIMA RIGA dell’output: "THEME: future-minimal".',
    '- Precisione, silenzio, intelligenza, controllo. Sembra avanzato e pulito, MAI cyberpunk, MAI landing AI generica. VIETATO: gradienti viola/blu, glow, sfere 3D, robot, cervelli/circuiti, immagini cyberpunk, dashboard finte caotiche, icone AI stock, troppi badge, troppi effetti, emoji.',
    '- Copy intelligente e specifico, MAI hype. VIETATE frasi come "AI-powered revolution", "next generation platform", "unlock the future". Meglio: "Riduce il rumore.", "Evidenzia ciò che conta.", "Ti aiuta a decidere prima.". Headline breve (max 7 parole), subheadline precisa. Max 5 feature, alterna i layout. Molto spazio, griglie sottili, linee leggere. Chiudi con CTA sobria.',
    '- Reveal leggeri: metti data-reveal su ogni elemento che entra in scroll. I numeri in <span data-count>. NIENTE foto di persone al laptop/ologrammi/sfondi spaziali.',
    'CLASSI:',
    'HEADER: <header class="nav"><div class="container row"><a class="brand" href="/">Nome<span class="dot"></span></a><nav class="nav-links"><a href="/p">Voce</a> …</nav><a class="btn primary" href="/contatti">Richiedi accesso <span class="arr">→</span></a></div></header>.',
    'HERO (dichiarazione di prodotto, non promo): <section class="hero"><div class="container"><div class="hero-grid"><p class="eyebrow" data-reveal>Categoria</p><h1 data-reveal>Headline breve.</h1><p class="sub" data-reveal>Subheadline precisa.</p><div class="cta-row" data-reveal><a class="btn primary lg" href="/contatti">Prova il prodotto <span class="arr">→</span></a><a class="tlink" href="/come-funziona">Scopri come funziona <span class="arr">→</span></a></div><div class="proof" data-reveal><span class="lbl">Usato da</span><div class="logos"><span>Vela</span><span>Northbound</span><span>Quanta</span></div></div></div></div></section>.',
    'SEZIONE PRODOTTO (OBBLIGATORIA — mostra COME funziona, subito sotto la hero). Se l’utente ha caricato screenshot reali usali: <div class="stage"><div class="container"><div class="shot" data-img><img data-brik-img="user:ID" alt="…"></div></div></div>. ALTRIMENTI costruisci una UI minimale in CSS (niente grafici complessi inventati): <div class="stage"><div class="container"><div class="panel" data-reveal><div class="panel-bar"><i></i><i></i><i></i><span class="url">app.nome.io</span></div><div class="panel-body"><aside class="pside"><div class="grp">Workspace</div><a class="on" href="#"><span class="ic"></span>Panoramica</a><a href="#"><span class="ic"></span>Voce</a><a href="#"><span class="ic"></span>Voce</a></aside><div class="pmain"><div class="top"><h4>Panoramica</h4><span class="pbtn">⌘K</span></div><div class="prow"><span class="pl"><span class="pc"></span>Voce</span><span class="pv">valore</span></div><div class="prow"><span class="pl"><span class="pc"></span>Voce</span><span class="pv">valore</span></div><div class="prow"><span class="pl"><span class="pc"></span>Voce</span><span class="pv">valore</span></div></div></div></div></div></div>.',
    'FEATURE (max 5; alterna con class="feat reverse"): <section class="features"><div class="container"><div class="feat" data-reveal><div class="ftxt"><p class="eyebrow">Categoria</p><h3>Vantaggio concreto.</h3><p>Descrizione specifica, mai hype.</p><div class="flist"><div class="li"><span class="ck"></span>Punto concreto</div><div class="li"><span class="ck"></span>Punto concreto</div></div></div><div class="fvis">[UI qui sotto]</div></div> …(2–5)… </div></section>.',
    'VISUAL di feature — dentro <div class="fvis"> metti un piccolo elemento UI in CSS (MAI foto): elenco azioni <div class="ui"><div class="ui-bar"><span class="d"></span>Etichetta</div><div class="ui-row on"><span><span class="k">01</span> Voce</span><span class="kbd">↵</span></div><div class="ui-row"><span><span class="k">02</span> Voce</span></div><div class="ui-row"><span><span class="k">03</span> Voce</span></div></div> oppure barre <div class="ui"><div class="ui-bar"><span class="d"></span>Metrica</div><div class="bars"><i style="height:40%"></i><i style="height:62%"></i><i style="height:52%"></i><i style="height:84%"></i><i style="height:94%"></i></div></div>.',
    'NUMERI (sobri, opzionali): <section class="nums"><div class="container"><p class="eyebrow" data-reveal>In numeri</p><div class="figs"><div class="fig" data-reveal><div class="n"><span data-count>99</span><span class="pl">%</span></div><div class="cap">Etichetta</div></div> …(2–3)…</div></div></section>.',
    'CTA FINALE (sobria): <section class="cta" id="contatti"><div class="container"><h2 data-reveal>Una riga di chiusura.</h2><p data-reveal>Frase precisa.</p><div class="cta-row" data-reveal><a class="btn primary lg" href="/contatti">Richiedi accesso <span class="arr">→</span></a><a class="btn ghost lg" href="/come-funziona">Scopri come funziona</a></div></div></section>.',
    'FOOTER: <footer class="foot"><div class="container"><div class="grid"><div class="col"><a class="brand" href="/">Nome<span class="dot"></span></a><p class="about">Riga.</p></div><div class="col"><h5>Sezione</h5><a href="/…">…</a> …</div> …</div><div class="fine"><span>© 2026 Nome</span><span>…</span></div></div></footer>.',
    'FOTO: solo se servono — interfacce reali, oggetti minimali, dettagli UI, micro pattern, composizioni astratte sobrie. VIETATE persone al laptop, robot, ologrammi, sfondi spaziali, stock tech. QUERY EN tipo "minimal product interface", "clean abstract object", "soft monochrome surface".',
  ],
  'modern-community': [
    'IDENTITÀ: modern-community. Club contemporaneo — community, membership, creator economy, academy, coworking, eventi (Airbnb, Notion, Patreon, Soho House, Substack). PRIMA RIGA dell’output: "THEME: modern-community".',
    '- Calore, appartenenza, energia umana, fiducia. Deve far pensare "questo è il posto giusto per me", MAI landing da corso online, MAI gruppo Facebook. VIETATO: foto stock di gruppi, persone in posa che sorridono, emoji ovunque, gradienti creator, viola/rosa saturi, card infinite, badge "exclusive" abusati, testimonial finti, countdown fake, copy aggressivo.',
    '- Copy caldo, diretto, umano, MAI guru/motivazionale finto. VIETATO "trasforma la tua vita", "community esclusiva per pochi". Meglio: "Un posto pratico dove crescere con più direzione.", "Meno tentativi a caso. Più confronto reale.". Una parola del titolo può andare in <em class="serif"> (corsivo serif accento). Benefici max 4–5, concreti. CTA = ingresso, non acquisto.',
    '- Reveal e hover morbidi: data-reveal su ciò che entra in scroll; ogni immagine in un contenitore con data-img.',
    'STRUTTURA: Hero, Per chi è, Cosa trovi dentro, Come funziona, Community proof, Pricing/accesso, CTA finale.',
    'CLASSI:',
    'HEADER: <header class="nav"><div class="container row"><a class="brand" href="/">Nome<span class="dot"></span></a><nav class="nav-links"><a href="/programma">Programma</a><a href="/prezzi">Prezzi</a><a class="btn primary" href="/accedi">Entra</a></nav></div></header>.',
    'HERO: <section class="hero"><div class="container"><div class="hero-grid"><div><p class="eyebrow" data-reveal>Il club</p><h1 data-reveal>Cresci meglio, <em class="serif">insieme.</em></h1><p class="sub" data-reveal>Subheadline concreta.</p><div class="cta-row" data-reveal><a class="btn primary lg" href="/accedi">Unisciti alla community <span class="arr">→</span></a><a class="tlink" href="/programma">Scopri com’è dentro <span class="arr">→</span></a></div></div><div class="hero-img" data-img data-parallax data-reveal><img data-brik-img="QUERY" alt="…"></div></div></div></section>.',
    'PER CHI È (OBBLIGATORIA, qualifica il pubblico, NIENTE card banali): <section class="section"><div class="container"><div class="shead" data-reveal><h2>Per chi è</h2></div><div class="fit"><div class="fit-col yes" data-reveal><h3><span class="mk">✓</span> È per te se</h3><ul><li>…</li><li>…</li><li>…</li></ul></div><div class="fit-col no" data-reveal><h3><span class="mk">—</span> Non è per te se</h3><ul><li>…</li><li>…</li></ul></div></div></div></section>.',
    'COSA TROVI (benefici, max 4–5, righe con divisori): <section class="section benefits"><div class="container"><div class="shead" data-reveal><h2>Cosa trovi dentro</h2></div><div class="benefit" data-reveal><div class="no">01</div><div><h3>Titolo</h3><p>Beneficio concreto.</p></div></div> …(3–5)… </div></section>.',
    'COME FUNZIONA: <section class="section"><div class="container"><div class="shead" data-reveal><h2>Come funziona</h2></div><div class="steps"><div class="step" data-reveal><div class="no">01</div><h3>Entri</h3><p>Riga breve.</p></div><div class="step" data-reveal><div class="no">02</div><h3>Partecipi</h3><p>…</p></div><div class="step" data-reveal><div class="no">03</div><h3>Cresci</h3><p>…</p></div></div></div></section>.',
    'COMMUNITY PROOF (numeri semplici, screenshot reali o citazioni — MAI proof inventata): <section class="section"><div class="container"><div class="proof"><div class="pstat" data-reveal><div class="n"><span data-count>1200</span><span class="pl">+</span></div><div class="cap">Membri attivi</div></div><div class="pquote" data-reveal><p class="q">"Citazione breve e vera."</p><div class="who"><b>Nome</b> — Ruolo</div></div></div></div></section>. Per uno screenshot reale usa <div class="pcard" data-img><img data-brik-img="user:ID" alt=""></div> dentro .proof.',
    'PRICING (chiaro e onesto, non aggressivo): <section class="section"><div class="container"><div class="shead" data-reveal><h2>Accesso</h2></div><div class="plans"><div class="plan" data-reveal><div class="pname">Mensile</div><div class="price">€39<span>/mese</span></div><ul><li>…</li><li>…</li></ul><a class="btn ghost" href="/accedi">Entra</a></div><div class="plan best" data-reveal><div class="pname">Annuale</div><div class="price">€390<span>/anno</span></div><ul><li>…</li><li>…</li></ul><a class="btn primary" href="/accedi">Entra</a></div></div></div></section>.',
    'CTA FINALE (ingresso, non acquisto): <section class="section cta" id="accedi"><div class="container"><h2 data-reveal>Pronto a <em class="serif">entrare?</em></h2><p data-reveal>Una riga calda.</p><a class="btn primary lg" data-reveal href="/accedi">Unisciti alla community <span class="arr">→</span></a></div></section>.',
    'FOOTER: <footer class="foot"><div class="container"><div class="grid"><div class="col"><a class="brand" href="/">Nome<span class="dot"></span></a><p class="about">Riga.</p></div><div class="col"><h5>Sezione</h5><a href="/…">…</a> …</div> …</div><div class="fine"><span>© 2026 Nome</span><span>…</span></div></div></footer>.',
    'FOTO: momenti reali, foto editoriali calde, dettagli di call/chat/eventi/persone in contesto, NON in posa. VIETATE gruppi stock, café/laptop generici, persone che indicano lo schermo, foto troppo perfette. QUERY EN tipo "warm candid gathering", "people working together natural light", "community event detail".',
  ],
  'industrial-bold': [
    'IDENTITÀ: industrial-bold. Manifattura moderna e dominante — industria, edilizia, logistica, impianti, energia, automotive, macchinari, B2B tecnico (Tesla Factory, Caterpillar premium, Porsche Engineering, SpaceX, Rimowa). PRIMA RIGA dell’output: "THEME: industrial-bold".',
    '- Forza, affidabilità, precisione, scala, materia, durata. MAI sito industriale vecchio, MAI brochure tecnica, MAI corporate blu. VIETATO: blu corporate, foto stock di operai sorridenti, icone industriali stock, gradienti, card con icone, layout da brochure, tabelle dense in homepage, CTA troppo commerciali, immagini piccole.',
    '- Le IMMAGINI sono fondamentali e GRANDI (full-width). Headline forte e corta (il sistema la rende MAIUSCOLA, tu scrivila normale e breve). Copy solido, preciso, concreto, senza frasi vuote. VIETATO "soluzioni innovative a 360°", "leader nel settore", "qualità e professionalità". I numeri sono DATI industriali, non KPI marketing. Processo e proof obbligatori. CTA diretta.',
    '- data-reveal su ciò che entra in scroll; ogni immagine in un contenitore con data-img (le full-width anche data-parallax). I numeri in <span data-count>.',
    'CLASSI:',
    'HEADER: <header class="nav"><div class="container row"><a class="brand" href="/">Nome<span class="dot"></span></a><nav class="nav-links"><a href="/servizi">Servizi</a><a href="/azienda">Azienda</a><a class="btn" href="/contatti">Contatti</a></nav></div></header>.',
    'HERO (scala e potenza; immagine dominante FUORI dal container, full-width): <section class="hero"><div class="container"><p class="eyebrow" data-reveal>Settore</p><h1 data-reveal>Costruito per durare.</h1><p class="sub" data-reveal>Subheadline tecnica ma chiara.</p><div class="cta-row" data-reveal><a class="btn" href="/contatti">Richiedi una consulenza <span class="arr">→</span></a><a class="tlink" href="/servizi">I servizi <span class="arr">→</span></a></div></div><div class="hero-media" data-img data-parallax data-reveal><img data-brik-img="QUERY" alt="…"></div></section>.',
    'SERVIZI (righe industriali, NIENTE card/icone): <section class="section"><div class="container"><div class="shead" data-reveal><h2>Servizi</h2><p>Riga.</p></div><div class="svcs"><div class="svc" data-reveal><div class="no">01</div><h3>Produzione</h3><p>Descrizione concreta.</p></div><div class="svc" data-reveal><div class="no">02</div><h3>Installazione</h3><p>…</p></div><div class="svc" data-reveal><div class="no">03</div><h3>Manutenzione</h3><p>…</p></div></div></div></section>.',
    'NUMERI (dati industriali, MAI KPI marketing): <section class="section"><div class="container"><div class="figs"><div class="fig" data-reveal><div class="n"><span data-count>25</span></div><div class="cap">anni di produzione</div></div><div class="fig" data-reveal><div class="n"><span data-count>12000</span><span class="pl"> m²</span></div><div class="cap">di stabilimento</div></div><div class="fig" data-reveal><div class="n"><span data-count>48</span><span class="pl">h</span></div><div class="cap">tempo medio intervento</div></div></div></div></section>.',
    'VISUAL FULL-BLEED (immagine grande): <section class="fullvis" data-img data-parallax><img data-brik-img="QUERY" alt="…"><span class="cap">Didascalia</span></section>.',
    'FEATURE (immagine+testo, alterna): <section class="section"><div class="container"><div class="feat" data-reveal><div class="media" data-img><img data-brik-img="QUERY" alt=""></div><div><p class="eyebrow">Capacità</p><h3>Titolo</h3><p>Descrizione tecnica.</p></div></div></div></section>. Aggiungi class="feat reverse" per invertire.',
    'PROCESSO (OBBLIGATORIO, numerato, tecnico): <section class="section"><div class="container"><div class="shead" data-reveal><h2>Processo</h2></div><div class="process"><div class="pstep" data-reveal><div class="no">01</div><h3>Analisi</h3><p>…</p></div><div class="pstep" data-reveal><div class="no">02</div><h3>Progettazione</h3><p>…</p></div><div class="pstep" data-reveal><div class="no">03</div><h3>Produzione</h3><p>…</p></div><div class="pstep" data-reveal><div class="no">04</div><h3>Installazione</h3><p>…</p></div><div class="pstep" data-reveal><div class="no">05</div><h3>Assistenza</h3><p>…</p></div></div></div></section>.',
    'PROOF (certificazioni / settori / loghi REALI — non inventare): <section class="section"><div class="container"><div class="shead" data-reveal><h2>Affidabilità</h2></div><div class="certs"><span class="cert">ISO 9001</span><span class="cert">CE</span><span class="cert">UNI EN 1090</span></div><div class="logos"><span>Cliente</span><span>Cliente</span><span>Cliente</span></div></div></section>.',
    'CTA FINALE (diretta): <section class="section cta" id="contatti"><div class="container"><h2 data-reveal>Parliamo del tuo progetto.</h2><p data-reveal>Una riga tecnica.</p><div class="cta-row" data-reveal><a class="btn" href="/contatti">Richiedi una consulenza tecnica <span class="arr">→</span></a><a class="btn ghost" href="/contatti">Scarica la scheda tecnica</a></div></div></section>.',
    'FOOTER: <footer class="foot"><div class="container"><div class="grid"><div class="col"><a class="brand" href="/">Nome<span class="dot"></span></a><p class="about">Riga.</p></div><div class="col"><h5>Sezione</h5><a href="/…">…</a> …</div> …</div><div class="fine"><span>© 2026 Nome</span><span>…</span></div></div></footer>.',
    'FOTO: macchinari reali, materiali, texture, produzione, dettagli tecnici, officine pulite, mani al lavoro, cantieri ordinati, componenti meccanici. GRANDI. VIETATE operai stock che sorridono, fabbriche generiche, render finti, foto patinate o piccole. QUERY EN tipo "industrial machine detail", "steel fabrication workshop", "heavy manufacturing closeup".',
  ],
};

function saasVisualAddendum(mode: string): string {
  if (mode === 'user') return 'VISUAL PRODOTTO (modalità: screenshot utente): l’utente ha caricato screenshot reali del prodotto. NON costruire il PANNELLO in CSS e NON inventare UI. Nella hero — dentro <div class="stage"><div class="container">…</div></div> — e in 1–2 feature mostra gli screenshot con <div class="shot" data-img><img data-brik-img="user:ID" alt="…"></div> usando gli ID forniti. Le altre feature usano il layout solo-testo <div class="feat solo"><div class="ftxt">…</div></div>. Se NON ti vengono forniti screenshot dell’utente, NON inventare immagini: comportati invece come la modalità "grafiche generate" (PANNELLO + mini-UI in CSS).';
  if (mode === 'none') return 'VISUAL PRODOTTO (modalità: nessun visual): NON inserire il PANNELLO, NON inserire mini-UI, NON usare <img> o screenshot. Salta del tutto la sezione <div class="stage">. TUTTE le feature usano solo testo: <div class="feat solo"><div class="ftxt">…</div></div> (niente .fvis).';
  return 'VISUAL PRODOTTO (modalità: grafiche generate): nella hero USA il PANNELLO PRODOTTO e nelle feature usa le mini-UI (.cmd/.mtile/.drows) esattamente come dai template. NON usare <img> né foto: le interfacce sono UI in CSS.';
}
export function systemPrompt(theme: ThemeName, opts?: { saasMode?: string; directorNotes?: readonly string[]; creativeNotes?: readonly string[] }): string {
  const add = theme === 'modern-saas' && opts && opts.saasMode ? [saasVisualAddendum(opts.saasMode)] : [];
  // Direzione creativa (Step 3): orienta la PRIMA generazione. Framing positivo,
  // distinto dalla revisione. Resta dentro design system/classi/identità esistenti.
  const creative = opts && opts.creativeNotes && opts.creativeNotes.length
    ? ['DIREZIONE CREATIVA DEL PROGETTO (orienta tono, priorità dei contenuti, CTA, anti-cliché e direzione visiva; resta dentro il design system, le classi e l\'identità già scelti; quando la direzione indica una struttura (es. portfolio e lavori PRIMA delle promesse, niente schema da builder) SEGUILA: la struttura delle sezioni deve riflettere la direzione creativa):\n' + opts.creativeNotes.join('\n')]
    : [];
  // Note del direttore creativo: presenti SOLO in una rigenerazione, dopo che la prima
  // versione non ha superato il gate qualità. Vanno prima del FORMATO (che resta in coda).
  const notes = opts && opts.directorNotes && opts.directorNotes.length
    ? ['REVISIONE DEL DIRETTORE CREATIVO — la versione precedente NON era al livello di uno studio da 20.000 €. Rifalla MEGLIO risolvendo con precisione questi punti: ' + opts.directorNotes.map((n) => '• ' + n).join('  ')]
    : [];
  return [...SYS_TOP, ...IDENTITY[theme], ...add, ...creative, ...notes, ...SYS_BOTTOM].join('\n');
}

/** Requisiti raggruppati per pagina (dai criteri tipizzati). */
function requirementsByRoute(spec: ProjectSpec, routes: readonly RouteInfo[]): string {
  const blocks: string[] = [];
  for (const { route, label } of routes) {
    const lines: string[] = [];
    for (const c of spec.criteria) {
      const k = c.check;
      if (!k) continue;
      if (k.kind === 'content-present' && k.route === route) lines.push(`- DEVE contenere il testo ESATTO: "${k.text}".`);
      else if (k.kind === 'responsive' && k.route === route) lines.push('- Usabile su mobile (375px) senza overflow orizzontale.');
      else if (k.kind === 'form-submission' && k.route === route) {
        const fl = k.fields.map((f) => `"${f.label}"`).join(', ');
        lines.push(`- Un form di contatto con i campi ${fl}: inserisci ESATTAMENTE il segnaposto <!--BRIK_CONTACT_FORM--> dove deve apparire (lo costruisce il sistema, non scriverlo tu).`);
      } else if (k.kind === 'navigation' && k.fromRoute === route) {
        lines.push(`- Un link con testo "${k.linkText}" che punta a "${k.toRoutePattern}".`);
      }
    }
    blocks.push(`## Pagina ${route} (${label})\n` + (lines.length ? lines.join('\n') : '- Contenuto coerente con il sito.'));
  }
  return blocks.join('\n\n');
}

/** Blocco prompt: foto REALI caricate dall'utente (segnaposto user:ID). */
function userPhotosBlock(photos: readonly { readonly id: string; readonly alt?: string; readonly isNew?: boolean }[] | undefined): string[] {
  const list = (photos ?? []).filter((p) => p && p.id);
  if (!list.length) return [];
  const anyNew = list.some((p) => p.isNew);
  return [
    '',
    "FOTO REALI DELL'UTENTE (caricate dall'utente). Usale AL POSTO delle foto stock dove rappresentano davvero l'attività (hero, galleria, prodotti, team).",
    'Inseriscile con <img data-brik-img="user:ID" alt="..."> dentro un contenitore .media o .hero-media, usando ESATTAMENTE questi ID. Niente src. Usa le foto stock solo per riempire dove non c\'è una foto utente adatta. NON inventare altri user:ID oltre a questi.',
    'Se una di queste foto è un LOGO, mettila nella .brand dell\'header (resta piccola: l\'altezza è limitata via CSS), NON in un hero o in una .media a tutta larghezza.',
    ...(anyNew ? ['Le foto contrassegnate (NUOVA) sono appena state caricate: se la richiesta dice "questa"/"questa foto"/"sostituisci con questa", si riferisce a quelle. Inseriscile o sostituiscile dove indicato.'] : []),
    'Foto disponibili:',
    ...list.map((p) => '- user:' + p.id + (p.isNew ? ' (NUOVA)' : '') + (p.alt ? ' — ' + p.alt : '')),
  ];
}

/** Blocco prompt: testi/dati REALI forniti dall'utente (allegati / sito importato). */
function realContentBlock(content: string | undefined): string[] {
  const c = (content ?? '').trim();
  if (!c) return [];
  return [
    '',
    "MATERIALE REALE FORNITO DALL'UTENTE (allegati / sito esistente).",
    'È la FONTE dei testi e dei dati veri: usali per riempire la bozza invece di inventare contenuti o lorem ipsum.',
    'Adattali ai blocchi del sito (titoli, descrizioni, servizi, contatti, orari, prezzi…), riscrivili per scorrevolezza se serve. Non sei obbligato a usarli tutti né a copiarli alla lettera, ma NON inventare fatti non presenti qui.',
    '--- INIZIO MATERIALE ---',
    c,
    '--- FINE MATERIALE ---',
  ];
}

function navSpec(routes: readonly RouteInfo[]): string {
  return routes.map((r) => `${r.label} -> ${r.route}`).join(' | ');
}

function cleanHtml(seg: string): string | null {
  let s = seg.trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.search(/<!doctype html|<html/i);
  if (start === -1) return null;
  return s.slice(start);
}

/** Rimuove CSS/risorse che l'LLM non dovrebbe scrivere: lo stile lo dà il design system. */
function sanitizeHead(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
}


/** Parsa l'output delimitato in pagine; valida che tutte le route attese ci siano. */
/** Esegue fn su items con al massimo `limit` task in parallelo, preservando l'ordine. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = new Array(n).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Estrae le pagine grezze dai delimitatori <<<FILE route>>>, senza vincoli sull'insieme atteso. */
function parseSitePages(raw: string): SitePage[] {
  const text = raw.trim();
  const re = /<<<FILE\s+([^\s>]+)\s*>>>/g;
  const marks: { route: string; end: number; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) marks.push({ route: m[1] as string, idx: m.index, end: re.lastIndex });

  const pages: SitePage[] = [];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i]!.end;
    const to = i + 1 < marks.length ? marks[i + 1]!.idx : text.length;
    const html = cleanHtml(text.slice(from, to));
    if (html) pages.push({ route: marks[i]!.route, html });
  }
  return pages;
}

/** Generazione/correzione: l'output DEVE contenere tutte le pagine attese. */
function parseSite(raw: string, expected: readonly string[]): Result<SitePage[]> {
  const pages = parseSitePages(raw);
  if (pages.length === 0) return err(appError('SITE_NO_FILES', 'Output senza delimitatori <<<FILE ...>>>.', { retryable: true }));
  const have = new Set(pages.map((p) => p.route));
  const missing = expected.filter((r) => !have.has(r));
  if (missing.length) return err(appError('SITE_MISSING_PAGES', 'Mancano pagine nell\'output: ' + missing.join(', '), { retryable: true }));
  const byRoute = new Map(pages.map((p) => [p.route, p] as const));
  return ok(expected.map((r) => byRoute.get(r)!));
}

/**
 * Modifiche: l'output puo contenere SOLO le pagine cambiate (le altre restano invariate).
 * Tiene solo le route note, deduplica e ne richiede almeno una valida.
 */
function parseSiteSubset(raw: string, expected: readonly string[]): Result<SitePage[]> {
  const pages = parseSitePages(raw).filter((p) => expected.includes(p.route));
  if (pages.length === 0) return err(appError('SITE_NO_FILES', 'Output senza pagine valide nel formato <<<FILE ...>>>.', { retryable: true }));
  const byRoute = new Map(pages.map((p) => [p.route, p] as const));
  return ok([...byRoute.values()]);
}

function delimited(pages: readonly SitePage[]): string {
  return pages.map((p) => `<<<FILE ${p.route}>>>\n${p.html}`).join('\n\n');
}

type SitePatch = { route: string; find: string; replace: string };

/** Estrae i blocchi <<<PATCH /route>>> @@FIND ... @@REPLACE ... @@END. Normalizza CRLF. */
export function parsePatches(raw: string): SitePatch[] {
  const text = raw.replace(/\r\n/g, '\n');
  const out: SitePatch[] = [];
  const re = /<<<PATCH\s+(\/[^\s>]*)\s*>>>[^\n]*\n@@FIND[^\n]*\n([\s\S]*?)\n@@REPLACE[^\n]*\n([\s\S]*?)\n@@END/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ route: m[1]!, find: m[2]!, replace: m[3]! });
  return out;
}

/**
 * Applica le patch alle pagine ATTUALI de-injectate, per match ESATTO e UNICO.
 * Fallisce (e si fa fallback al full-edit) se anche una sola patch non trova un
 * match univoco: cosi non si corrompe mai l'HTML. Ritorna solo le pagine cambiate.
 */
export function applyPatches(
  ctx: readonly SitePage[],
  patches: readonly SitePatch[],
  expected: readonly string[],
): Result<SitePage[]> {
  if (patches.length === 0) return err(appError('PATCH_EMPTY', 'Nessuna patch valida.', { retryable: true }));
  const ctxByRoute = new Map(ctx.map((p) => [p.route, p.html] as const));
  const work = new Map<string, string>();
  for (const p of patches) {
    if (!expected.includes(p.route)) return err(appError('PATCH_BAD_ROUTE', 'Patch su route inattesa: ' + p.route, { retryable: true }));
    if (!p.find) return err(appError('PATCH_EMPTY_FIND', 'Patch senza testo da cercare.', { retryable: true }));
    const curHtml = work.has(p.route) ? work.get(p.route)! : ctxByRoute.get(p.route);
    if (curHtml === undefined) return err(appError('PATCH_NO_PAGE', 'Pagina assente per la patch: ' + p.route, { retryable: true }));
    const i = curHtml.indexOf(p.find);
    if (i === -1) return err(appError('PATCH_NOT_FOUND', 'Testo da sostituire non trovato in ' + p.route, { retryable: true }));
    if (curHtml.indexOf(p.find, i + 1) !== -1) return err(appError('PATCH_AMBIGUOUS', 'Testo da sostituire non univoco in ' + p.route, { retryable: true }));
    work.set(p.route, curHtml.slice(0, i) + p.replace + curHtml.slice(i + p.find.length));
  }
  const changed: SitePage[] = [...work.entries()].map(([route, html]) => ({ route, html }));
  return ok(changed);
}

/** Footer "canonico" estratto da una pagina (per uniformare il chrome dopo la generazione parallela). */
function pickFooter(html: string): string | null {
  const m = html.match(/<footer[\s\S]*?<\/footer>/i);
  return m ? m[0] : null;
}
/**
 * In generazione PARALLELA ogni pagina nasce da una chiamata separata: header e menu
 * restano coerenti (il menu e vincolato da navSpec), ma il footer (testo libero) puo
 * divergere. Qui rendiamo IDENTICO il footer di tutte le pagine copiando quello della
 * home. La replace usa una funzione per non interpretare eventuali "$" nel footer.
 */
function unifyFooter(pages: SitePage[]): SitePage[] {
  const home = pages.find((p) => p.route === '/') ?? pages[0];
  const canonical = home ? pickFooter(home.html) : null;
  if (!canonical) return pages;
  return pages.map((p) => {
    const cur = pickFooter(p.html);
    if (!cur || cur === canonical) return p;
    return { route: p.route, html: p.html.replace(cur, () => canonical) };
  });
}

export function makeAnthropicSiteGenerator(
  llm: LLMProvider,
  opts: { readonly tier?: LLMRequest['tier']; readonly delivery?: FormDelivery; readonly images?: ImageSource; readonly userPhotos?: readonly { readonly id: string; readonly alt?: string; readonly isNew?: boolean }[] } = {},
): SiteGenerator {
  const tier = opts.tier ?? 'balanced';
  let metricsOn = false; // attivo solo durante la home fast (logMetrics) per le metriche di misura
  const expectedRoutes = (routes: readonly RouteInfo[]) => routes.map((r) => r.route);

  const finish = async (
    raw: string,
    spec: ProjectSpec,
    routes: readonly RouteInfo[],
    theme: ThemeName,
    variant?: string,
  ): Promise<Result<SitePage[]>> => {
    const parsed = parseSite(raw, expectedRoutes(routes));
    if (!parsed.ok) return parsed;
    return ok(await bake(parsed.value, spec, theme, variant));
  };

  /** Pipeline comune: da pagine "grezze" (de-injected) a pagine finite (form + immagini + design system). */
  const bake = async (rawPages: readonly SitePage[], spec: ProjectSpec, theme: ThemeName, variant?: string): Promise<SitePage[]> => {
    const cleaned: SitePage[] = rawPages.map((p) => ({ route: p.route, html: sanitizeHead(p.html) }));
    const descriptor = opts.delivery?.describe({ siteId: spec.id, subject: spec.title });
    let pages: SitePage[] = injectForms(cleaned, spec, descriptor);
    if (opts.images) {
      const tImg = Date.now();
      pages = await resolveImages(pages, opts.images);
      if (metricsOn) console.log('    \u23f1 image_resolution_time: ' + ((Date.now() - tImg) / 1000).toFixed(1) + 's');
    }
    return injectDesignSystem(pages, theme, variant) as SitePage[];
  };

  /**
   * Modifica MIRATA: il modello restituisce solo le pagine cambiate; quelle non
   * incluse restano quelle ATTUALI (gia finite, immagini gia risolte). Ritorna
   * comunque l'insieme COMPLETO nell'ordine atteso, cosi il gate di regressione
   * gira su tutto come prima.
   */
  /** Bake delle pagine cambiate (de-injectate) + merge nelle pagine attuali, nell'ordine atteso. */
  const mergeChangedPages = async (
    changedDeInjected: readonly SitePage[],
    spec: ProjectSpec,
    theme: ThemeName,
    current: readonly SitePage[],
    expected: readonly string[],
  ): Promise<SitePage[]> => {
    const bakedChanged = await bake(changedDeInjected, spec, theme);
    const byRoute = new Map<string, SitePage>(current.map((p) => [p.route, p] as const));
    for (const p of bakedChanged) byRoute.set(p.route, p); // sovrascrive solo le pagine cambiate
    const merged: SitePage[] = [];
    for (const r of expected) {
      const pg = byRoute.get(r);
      if (pg) merged.push(pg);
    }
    return merged;
  };

  const finishScoped = async (
    raw: string,
    spec: ProjectSpec,
    routes: readonly RouteInfo[],
    theme: ThemeName,
    current: readonly SitePage[],
  ): Promise<Result<SitePage[]>> => {
    const expected = expectedRoutes(routes);
    const changed = parseSiteSubset(raw, expected);
    if (!changed.ok) return changed;
    return ok(await mergeChangedPages(changed.value, spec, theme, current, expected));
  };

  /** Pagine attuali pulite per il prompt di fix/edit: senza form e senza il CSS del design system (evita di mandare i font base64). */
  const contextPages = (current: readonly SitePage[]): SitePage[] =>
    deInjectDesignSystem(deInjectForms(current)).map((p) => ({ route: p.route, html: sanitizeHead(p.html) }));

  /** Modifica FULL: il modello riemette le pagine cambiate per intero (formato <<<FILE>>>). Fallback del path patch. */
  const fullEdit = async (
    spec: ProjectSpec,
    routes: readonly RouteInfo[],
    current: readonly SitePage[],
    instruction: string,
    theme: ThemeName,
  ): Promise<Result<SitePage[]>> => {
    const system = [
      systemPrompt(theme),
      'Questa e una MODIFICA richiesta dall\'utente: applica SOLO il cambiamento richiesto, lasciando invariato tutto il resto (contenuti, struttura, le altre pagine). Usa sempre le stesse classi e NON scrivere CSS. Mantieni lo stesso TEMA.',
      'OUTPUT: restituisci SOLO le pagine che cambiano davvero, ciascuna nel formato delimitato <<<FILE /route>>>. NON includere le pagine che restano identiche.',
      'REGOLA IMPORTANTE: se la modifica tocca elementi CONDIVISI presenti su tutte le pagine (header, menu di navigazione, footer, logo, palette), allora restituisci TUTTE le pagine. Nel dubbio se la modifica sia condivisa o locale, restituisci TUTTE le pagine.',
    ].join('\n');
    const prompt = [
      `THEME corrente (NON cambiarlo): ${theme}`,
      `Titolo del sito: ${spec.title}`,
      `Pagine e menu: ${navSpec(routes)}`,
      '',
      'MODIFICA RICHIESTA:',
      instruction,
      ...userPhotosBlock(opts.userPhotos),
      ...realContentBlock(spec.content),
      '',
      'PAGINE ATTUALI:',
      delimited(contextPages(current)),
    ].join('\n');
    const res = await llm.complete({ system, prompt, tier, maxTokens: 32000 });
    if (!res.ok) return err(res.error);
    return finishScoped(res.value.text, spec, routes, theme, current);
  };

  return {
    async generate(spec, routes, genOpts) {
      const theme: ThemeName = genOpts && typeof genOpts.theme === 'string' && isTheme(genOpts.theme) ? (genOpts.theme as ThemeName) : DEFAULT_THEME;
      const saasMode = genOpts && typeof genOpts.saasVisual === 'string' ? genOpts.saasVisual : undefined;
      const variant = genOpts && (genOpts.variant === 'dark' || genOpts.variant === 'light') ? genOpts.variant : undefined;
      const directorNotes = genOpts && Array.isArray(genOpts.directorNotes) && genOpts.directorNotes.length ? genOpts.directorNotes : undefined;
      const creativeNotes = genOpts && Array.isArray(genOpts.creativeNotes) && genOpts.creativeNotes.length ? genOpts.creativeNotes : undefined;
      const homeMaxTokens = genOpts && typeof genOpts.maxTokens === 'number' && genOpts.maxTokens > 0 ? genOpts.maxTokens : undefined;
      const logMetrics = !!(genOpts && genOpts.logMetrics);
      const sysOpts = { ...(saasMode ? { saasMode } : {}), ...(directorNotes ? { directorNotes } : {}), ...(creativeNotes ? { creativeNotes } : {}) };

      const single = async (): Promise<Result<SitePage[]>> => {
        const prompt = [
          `Titolo del sito: ${spec.title}`,
          `Descrizione: ${spec.description}`,
          `Categoria: ${spec.category}`,
          '',
          `Pagine del sito e menu (uguale su tutte): ${navSpec(routes)}`,
          '',
          'Requisiti per pagina:',
          requirementsByRoute(spec, routes),
          ...userPhotosBlock(opts.userPhotos),
          ...realContentBlock(spec.content),
        ].join('\n');
        const sys = systemPrompt(theme, sysOpts);
        const tok = homeMaxTokens ?? 32000;
        if (logMetrics) { metricsOn = true; console.log('    \u23f1 home_prompt_chars: ' + (sys.length + prompt.length) + ' \u00b7 home_max_tokens: ' + tok); }
        const tLlm = Date.now();
        const res = await llm.complete({ system: sys, prompt, tier, maxTokens: tok });
        if (!res.ok) { metricsOn = false; return err(res.error); }
        if (logMetrics) console.log('    \u23f1 home_llm_time: ' + ((Date.now() - tLlm) / 1000).toFixed(1) + 's \u00b7 home_output_chars: ' + res.value.text.length);
        const out = await finish(res.value.text, spec, routes, theme, variant);
        metricsOn = false;
        return out;
      };

      // Generazione per-pagina in parallelo (default ON; BRIK_GEN_PARALLEL=0 torna alla chiamata unica).
      const parallelOn = process.env.BRIK_GEN_PARALLEL !== '0';
      if (!parallelOn || routes.length < 2) return single();

      const sys = [
        systemPrompt(theme, sysOpts),
        'Genera UNA SOLA pagina del sito: quella indicata sotto. OUTPUT: la riga THEME e UN SOLO blocco "<<<FILE /route>>>" col documento HTML completo. NESSUN\'altra pagina, nessun altro testo.',
        'CHROME CONDIVISO (cruciale): header, menu di navigazione e footer DEVONO essere IDENTICI su ogni pagina del sito — stessa .brand, stesso menu con TUTTE le voci nell\'ordine dato, stesso footer. Cambia solo il contenuto centrale specifico di questa pagina.',
      ].join('\n');
      const baseLines = [
        `Titolo del sito: ${spec.title}`,
        `Descrizione: ${spec.description}`,
        `Categoria: ${spec.category}`,
        '',
        `Pagine del sito e menu (IDENTICO su tutte, in quest'ordine): ${navSpec(routes)}`,
      ];
      const photoBlock = userPhotosBlock(opts.userPhotos);
      const realBlock = realContentBlock(spec.content);
      // [TIMING TEMP] istante zero condiviso: gli offset di start/end di ogni pagina
      // sono relativi a qui, cosi possiamo leggere se le pagine si sovrappongono
      // (parallelo vero) o sono scaglionate (segno di throttling). RIMUOVERE dopo la diagnosi.
      const tParallel0 = Date.now();
      const genOne = async (r: RouteInfo): Promise<SitePage | null> => {
        const isHome = r.route === '/' || r.route === '';
        const tStart = Date.now();
        console.log(`    \u23f1 [page-timing] START route=${r.route}${isHome ? ' (HOME)' : ''} start=+${tStart - tParallel0}ms`);
        const prompt = [
          ...baseLines,
          '',
          `GENERA SOLO QUESTA PAGINA: ${r.route} (${r.label}).`,
          'Requisiti di questa pagina:',
          requirementsByRoute(spec, [r]),
          ...photoBlock,
          ...realBlock,
        ].join('\n');
        const res = await llm.complete({ system: sys, prompt, tier, maxTokens: 14000 });
        const tEnd = Date.now();
        console.log(`    \u23f1 [page-timing] END   route=${r.route}${isHome ? ' (HOME)' : ''} end=+${tEnd - tParallel0}ms dur=${((tEnd - tStart) / 1000).toFixed(1)}s ok=${res.ok}`);
        if (!res.ok) return null;
        const parsed = parseSitePages(res.value.text);
        if (!parsed.length) return null;
        return { route: r.route, html: parsed[0]!.html };
      };
      const results = await mapLimit(routes, 4, genOne);
      // [TIMING TEMP] riepilogo: tempo di parete totale del batch parallelo. Se ~= durata
      // della home, la home e il pavimento; se >> della pagina piu lenta, c'e accodamento.
      console.log(`    \u23f1 [page-timing] BATCH ${routes.length} pagine, wall=${((Date.now() - tParallel0) / 1000).toFixed(1)}s, concorrenza=4`);
      if (results.some((p) => !p)) return single(); // fallback sicuro alla chiamata unica
      return ok(await bake(unifyFooter(results as SitePage[]), spec, theme, variant));
    },

    async fix(spec, routes, current, failures) {
      const theme = themeOfPages(current);
      const system = [
        systemPrompt(theme),
        'Questa e una CORREZIONE: ricevi le pagine attuali (gia in stile design system) e i problemi rilevati. Correggi SOLO i problemi indicati, mantenendo invariato il resto. Usa sempre le stesse classi e NON scrivere CSS. Restituisci di nuovo TUTTE le pagine nel formato delimitato (con la riga THEME).',
      ].join('\n');
      const prompt = [
        `THEME corrente (NON cambiarlo): ${theme}`,
        `Titolo del sito: ${spec.title}`,
        `Pagine e menu: ${navSpec(routes)}`,
        '',
        'PROBLEMI DA CORREGGERE:',
        failures.map((f) => `- [${f.kind}] ${f.detail}`).join('\n'),
        '',
        'PAGINE ATTUALI:',
        delimited(contextPages(current)),
      ].join('\n');

      const res = await llm.complete({ system, prompt, tier, maxTokens: 32000 });
      if (!res.ok) return err(res.error);
      return finish(res.value.text, spec, routes, theme);
    },

    async edit(spec, routes, current, instruction) {
      const theme = themeOfPages(current);
      const ctx = contextPages(current);
      const expected = expectedRoutes(routes);
      const system = [
        systemPrompt(theme),
        'Questa e una MODIFICA dell\'utente: applica SOLO il cambiamento richiesto, lasciando invariato tutto il resto. Stesse classi, NIENTE CSS, stesso TEMA.',
        'Scegli UNA modalita di output, senza mischiarle:',
        '- PATCH (preferita per modifiche LOCALIZZATE su una o poche pagine): per ogni punto da cambiare scrivi ESATTAMENTE un blocco:',
        '<<<PATCH /route>>>',
        '@@FIND',
        '<HTML ATTUALE copiato CARATTERE PER CARATTERE dalle PAGINE ATTUALI, abbastanza da essere UNICO in quella pagina>',
        '@@REPLACE',
        '<nuovo HTML che lo sostituisce>',
        '@@END',
        'Puoi usare piu blocchi PATCH (anche su pagine diverse). Il testo dopo @@FIND deve comparire UNA sola volta nella pagina e combaciare esattamente. Per INSERIRE, metti nel FIND un ancoraggio vicino (un tag esistente) e rimettilo nel REPLACE col nuovo contenuto.',
        '- FULL (SOLO se la modifica e ampia/strutturale o tocca elementi CONDIVISI su tutte le pagine come header, menu, footer, logo, palette): restituisci le pagine COMPLETE che cambiano nel formato <<<FILE /route>>>; se cambiano elementi condivisi includi TUTTE le pagine.',
      ].join('\n');
      const prompt = [
        `THEME corrente (NON cambiarlo): ${theme}`,
        `Titolo del sito: ${spec.title}`,
        `Pagine e menu: ${navSpec(routes)}`,
        '',
        'MODIFICA RICHIESTA:',
        instruction,
        ...userPhotosBlock(opts.userPhotos),
        ...realContentBlock(spec.content),
        '',
        'PAGINE ATTUALI:',
        delimited(ctx),
      ].join('\n');

      const res = await llm.complete({ system, prompt, tier, maxTokens: 32000 });
      if (!res.ok) return err(res.error);
      const raw = res.value.text;

      if (/<<<PATCH\s/.test(raw)) {
        const applied = applyPatches(ctx, parsePatches(raw), expected);
        if (applied.ok) return ok(await mergeChangedPages(applied.value, spec, theme, current, expected));
        return fullEdit(spec, routes, current, instruction, theme); // patch non applicabile -> full
      }
      if (/<<<FILE\s/.test(raw)) return finishScoped(raw, spec, routes, theme, current);
      return fullEdit(spec, routes, current, instruction, theme);
    },
  };
}
