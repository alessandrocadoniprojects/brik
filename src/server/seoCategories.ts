/**
 * Pagine SEO per categoria: /templates/:slug
 *
 * Data-driven: ogni categoria è un oggetto con contenuto SPECIFICO (non keyword-swap,
 * per evitare doorway/thin pages). Il render produce una pagina .mkt coerente con le
 * altre pagine marketing, con on-page SEO completo + JSON-LD BreadcrumbList e FAQPage.
 * La sitemap si genera dall'elenco slug (sitemapXml).
 */

const BASE = 'https://thebrik.it';

export interface CatFaq {
  readonly q: string;
  readonly a: string;
}
export interface CatSection {
  readonly h2: string;
  readonly body: string; // HTML semplice (paragrafi/elenchi) già sicuro, scritto da noi
}
export interface SeoCategory {
  readonly slug: string;
  readonly title: string; // <title> (≤60c)
  readonly metaDescription: string; // ≤155c
  readonly h1: string;
  readonly intro: string; // 1-2 paragrafi, HTML semplice
  readonly checks: readonly string[]; // "incluso in ogni sito"
  readonly sections: readonly CatSection[];
  readonly faq: readonly CatFaq[];
  readonly promptSeed: string; // precompila il composer via /?prompt=
  readonly ctaLabel: string; // etichetta del bottone CTA, specifica per categoria
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const CATEGORIES: readonly SeoCategory[] = [
  {
    slug: 'ristorante',
    title: 'Sito web per ristoranti — crealo in pochi minuti · Brik',
    metaDescription:
      'Crea il sito del tuo ristorante descrivendolo a parole: menù, foto dei piatti, prenotazioni e contatti. Online in pochi minuti, hosting e dominio inclusi.',
    h1: 'Il sito web per il tuo ristorante, descritto a parole',
    intro:
      '<p class="lead">Racconti il tuo ristorante in una frase e brik prepara il sito completo: pagina del menù, foto dei piatti, orari, mappa e un modo semplice per farti contattare o prenotare. Pronto e online in pochi minuti, senza toccare codice.</p>' +
      '<p>Niente template da riempire a mano e niente agenzia: descrivi cucina, atmosfera e dove sei, e ottieni una prima bozza da rifinire parlando, finché non è esattamente come la vuoi.</p>',
    checks: [
      'Pagina menù chiara, leggibile da telefono',
      'Foto dei tuoi piatti (le carichi tu)',
      'Modulo contatti e prenotazione',
      'Orari di apertura e mappa con indirizzo',
      'Pulsanti per chiamare e scrivere su WhatsApp',
      'Hosting, certificato SSL e dominio inclusi',
    ],
    sections: [
      {
        h2: 'Cosa serve davvero al sito di un ristorante',
        body:
          '<p>Chi cerca un ristorante online vuole tre cose, subito: capire <strong>cosa si mangia</strong>, <strong>dove siete</strong> e <strong>come prenotare</strong>. Un sito che mette in chiaro queste informazioni converte una ricerca in una visita o una telefonata.</p>' +
          '<p>Per questo i siti per ristoranti creati con brik mettono al centro il menù (aggiornabile quando cambi i piatti), le foto reali della tua cucina e dell\'ambiente, gli orari, la mappa e un contatto a un tocco. Tutto pensato per il telefono, da cui arriva la maggior parte delle ricerche.</p>',
      },
      {
        h2: 'Come funziona',
        body:
          '<p>Descrivi il ristorante (es. «trattoria toscana a Firenze, cucina casalinga, pranzo e cena, prenotazioni al telefono»). brik genera una prima bozza in un paio di minuti, poi la rifinisci scrivendo cosa cambiare — testi, sezioni, foto, colori. Quando sei soddisfatto, pubblichi.</p>' +
          '<p>Vuoi vedere il processo nel dettaglio? Leggi <a href="/how-it-works">come funziona</a>.</p>',
      },
    ],
    faq: [
      {
        q: 'Posso mostrare il menù sul sito?',
        a: 'Sì. Il sito include una pagina menù chiara e leggibile dal telefono, organizzata per categorie (antipasti, primi, dolci, vini…). Puoi scrivere i piatti tu o farli proporre a brik e poi correggerli.',
      },
      {
        q: 'Posso aggiornare il menù quando cambio i piatti?',
        a: 'Sì, quando vuoi: basta scrivere a brik cosa aggiungere o togliere e il menù si aggiorna, senza rifare il sito.',
      },
      {
        q: 'Posso ricevere prenotazioni o contatti dal sito?',
        a: 'Sì. Ogni sito ha un modulo di contatto e prenotazione, più pulsanti per chiamare o scrivere su WhatsApp con un tocco. Le richieste ti arrivano via email.',
      },
      {
        q: 'Posso usare le foto dei miei piatti?',
        a: 'Sì, carichi le tue foto e brik le inserisce al posto delle immagini di esempio. Se non ne hai ancora, partiamo con immagini coerenti e le sostituisci quando vuoi.',
      },
      {
        q: 'Il sito compare su Google?',
        a: 'Sì: ogni sito è ottimizzato per i motori di ricerca (titoli, descrizioni, struttura) e caricato veloce, così può essere trovato da chi cerca un ristorante nella tua zona.',
      },
      {
        q: 'Quanto costa?',
        a: 'Crei e rifinisci il sito gratis; paghi solo quando decidi di pubblicarlo. Vedi i dettagli nella pagina prezzi.',
      },
    ],
    promptSeed: 'Sito per il mio ristorante: ',
    ctaLabel: 'Crea il sito del tuo ristorante',
  },
  {
    slug: 'parrucchiere',
    title: 'Sito web per parrucchieri e saloni · Brik',
    metaDescription:
      'Crea il sito del tuo salone descrivendolo a parole: listino servizi, galleria dei lavori, prenotazione e contatti. Online in pochi minuti, hosting incluso.',
    h1: 'Il sito web per il tuo salone di parrucchiere',
    intro:
      '<p class="lead">Descrivi il tuo salone e brik prepara il sito completo: listino dei servizi, galleria dei tagli e dei colori, prenotazione e contatti a un tocco. Pronto in pochi minuti, pensato per il telefono.</p>' +
      '<p>Chi cerca un parrucchiere vuole vedere i lavori e capire come prenotare: il sito mette al centro le tue foto e un contatto immediato.</p>',
    checks: [
      'Listino servizi con prezzi indicativi',
      'Galleria dei tuoi lavori (tagli, colori, acconciature)',
      'Prenotazione e richiesta appuntamento',
      'Pulsanti per chiamare e scrivere su WhatsApp',
      'Orari di apertura e mappa',
      'Hosting, SSL e dominio inclusi',
    ],
    sections: [
      {
        h2: 'Cosa serve davvero al sito di un salone',
        body:
          '<p>Per un parrucchiere il sito vende con le <strong>immagini</strong> e con la <strong>facilità di prenotare</strong>. Una galleria curata dei tuoi lavori e un pulsante per fissare l\'appuntamento valgono più di mille parole.</p>' +
          '<p>I siti creati con brik mettono in evidenza i tuoi tagli e colori (con le tue foto reali), un listino chiaro dei servizi e la prenotazione a portata di tocco, anche via WhatsApp.</p>',
      },
      {
        h2: 'Come funziona',
        body:
          '<p>Descrivi il salone (es. «parrucchiere unisex a Bologna, taglio, colore e trattamenti, prenotazione su appuntamento»). brik genera la bozza in pochi minuti e la rifinisci parlando, poi pubblichi. Vedi <a href="/how-it-works">come funziona</a>.</p>',
      },
    ],
    faq: [
      { q: 'Posso mostrare il listino dei servizi?', a: 'Sì: il sito include un listino chiaro con i tuoi servizi e prezzi indicativi, che puoi aggiornare quando vuoi scrivendo a brik.' },
      { q: 'Posso pubblicare le foto dei miei lavori?', a: 'Sì, carichi le tue foto (tagli, colori, acconciature) e brik le mette in una galleria ordinata; se non le hai ancora, partiamo con immagini coerenti.' },
      { q: 'I clienti possono prenotare dal sito?', a: 'Sì: c\'è un modulo per richiedere l\'appuntamento e pulsanti per chiamare o scrivere su WhatsApp con un tocco. Le richieste ti arrivano via email.' },
      { q: 'Il sito compare su Google?', a: 'Sì, ogni sito è ottimizzato per la ricerca e veloce, così può essere trovato da chi cerca un parrucchiere nella tua zona.' },
      { q: 'Quanto costa?', a: 'Crei e rifinisci il sito gratis; paghi solo quando decidi di pubblicarlo. Trovi i dettagli nella pagina prezzi.' },
    ],
    promptSeed: 'Sito per il mio salone di parrucchiere: ',
    ctaLabel: 'Crea il sito del tuo salone',
  },
  {
    slug: 'palestra',
    title: 'Sito web per palestre e centri fitness · Brik',
    metaDescription:
      'Crea il sito della tua palestra descrivendola a parole: corsi e orari, abbonamenti, trainer, prova gratuita e iscrizione. Online in pochi minuti, hosting incluso.',
    h1: 'Il sito web per la tua palestra',
    intro:
      '<p class="lead">Descrivi la tua palestra e brik prepara il sito: orari dei corsi, abbonamenti, trainer e un modo semplice per prenotare la prova gratuita. Pronto in pochi minuti, ottimo da telefono.</p>' +
      '<p>Chi cerca una palestra vuole sapere quali corsi ci sono, quanto costa e come iniziare: il sito risponde subito a queste domande.</p>',
    checks: [
      'Orari dei corsi e delle attività',
      'Abbonamenti e prezzi',
      'Schede dei trainer',
      'Prenotazione della prova gratuita',
      'Mappa, orari e contatti',
      'Hosting, SSL e dominio inclusi',
    ],
    sections: [
      {
        h2: 'Cosa serve davvero al sito di una palestra',
        body:
          '<p>Il sito di una palestra converte quando mostra <strong>cosa si fa</strong> (corsi e orari), <strong>quanto costa</strong> (abbonamenti) e dà un modo immediato per <strong>provare</strong>. La prova gratuita è spesso il primo passo: rendila facile da prenotare.</p>' +
          '<p>Con brik il sito mette in chiaro il calendario dei corsi, i piani di abbonamento, chi sono i trainer e un modulo per fissare la prova.</p>',
      },
      {
        h2: 'Come funziona',
        body:
          '<p>Descrivi la palestra (es. «palestra a Torino, sala pesi, corsi di functional e spinning, abbonamenti mensili e annuali, prova gratuita»). brik genera la bozza e la rifinisci parlando. Vedi <a href="/how-it-works">come funziona</a>.</p>',
      },
    ],
    faq: [
      { q: 'Posso mostrare gli orari dei corsi?', a: 'Sì: il sito include il calendario dei corsi e delle attività, aggiornabile quando cambia la programmazione.' },
      { q: 'Posso indicare gli abbonamenti e i prezzi?', a: 'Sì, con una sezione dedicata ai piani di abbonamento; puoi modificarla quando vuoi.' },
      { q: 'Si può prenotare la prova gratuita dal sito?', a: 'Sì: c\'è un modulo per richiedere la prova o l\'iscrizione, e le richieste ti arrivano via email.' },
      { q: 'Il sito compare su Google?', a: 'Sì, ogni sito è ottimizzato per la ricerca e veloce, così ti trova chi cerca una palestra in zona.' },
      { q: 'Quanto costa?', a: 'Crei e rifinisci il sito gratis; paghi solo quando lo pubblichi. Dettagli nella pagina prezzi.' },
    ],
    promptSeed: 'Sito per la mia palestra: ',
    ctaLabel: 'Crea il sito della tua palestra',
  },
  {
    slug: 'dentista',
    title: 'Sito web per dentisti e studi dentistici · Brik',
    metaDescription:
      'Crea il sito del tuo studio dentistico descrivendolo a parole: prestazioni, team, prenotazione e contatti. Online in pochi minuti, hosting e dominio inclusi.',
    h1: 'Il sito web per il tuo studio dentistico',
    intro:
      '<p class="lead">Descrivi il tuo studio e brik prepara il sito: prestazioni, presentazione del team, orari e un modo semplice per richiedere un appuntamento. Pronto in pochi minuti, chiaro e professionale.</p>' +
      '<p>Per uno studio dentistico contano la <strong>chiarezza</strong> sulle prestazioni e la <strong>fiducia</strong>: il sito presenta i servizi e chi se ne occupa, e rende facile prenotare.</p>',
    checks: [
      'Elenco delle prestazioni',
      'Presentazione del team e delle qualifiche',
      'Richiesta di appuntamento e contatti',
      'Pulsante per chiamare (anche per urgenze)',
      'Orari e mappa dello studio',
      'Hosting, SSL e dominio inclusi',
    ],
    sections: [
      {
        h2: 'Cosa serve davvero al sito di uno studio dentistico',
        body:
          '<p>Il paziente cerca due cose: capire <strong>quali prestazioni</strong> offri (igiene, implantologia, ortodonzia…) e sentirsi <strong>in buone mani</strong>. Per questo è importante presentare i servizi in modo chiaro e dare visibilità al team e alle sue qualifiche.</p>' +
          '<p>Con brik il sito elenca le prestazioni in modo ordinato, presenta i professionisti e mette un contatto immediato per richiedere un appuntamento o segnalare un\'urgenza.</p>',
      },
      {
        h2: 'Come funziona',
        body:
          '<p>Descrivi lo studio (es. «studio dentistico a Padova, igiene, conservativa, implantologia e ortodonzia, due dottori, su appuntamento»). brik genera la bozza e la rifinisci parlando. Vedi <a href="/how-it-works">come funziona</a>.</p>',
      },
    ],
    faq: [
      { q: 'Posso elencare le prestazioni dello studio?', a: 'Sì: il sito include una sezione con le prestazioni offerte, descritte in modo chiaro e aggiornabile quando vuoi.' },
      { q: 'Posso presentare il team e le qualifiche?', a: 'Sì, con schede dei professionisti e dei loro titoli, per trasmettere competenza e fiducia.' },
      { q: 'I pazienti possono richiedere un appuntamento dal sito?', a: 'Sì: c\'è un modulo di contatto e prenotazione, più un pulsante per chiamare con un tocco. Le richieste ti arrivano via email.' },
      { q: 'Il sito compare su Google?', a: 'Sì, è ottimizzato per la ricerca e veloce, così ti trova chi cerca un dentista nella tua zona.' },
      { q: 'Quanto costa?', a: 'Crei e rifinisci il sito gratis; paghi solo quando lo pubblichi. Dettagli nella pagina prezzi.' },
    ],
    promptSeed: 'Sito per il mio studio dentistico: ',
    ctaLabel: 'Crea il sito del tuo studio',
  },
  {
    slug: 'fotografo',
    title: 'Sito web e portfolio per fotografi · Brik',
    metaDescription:
      'Crea il tuo portfolio da fotografo descrivendolo a parole: gallerie per categoria, video, pacchetti e contatti. Online in pochi minuti, hosting e dominio inclusi.',
    h1: 'Il sito portfolio per il tuo lavoro da fotografo',
    intro:
      '<p class="lead">Descrivi il tuo lavoro e brik prepara il portfolio: gallerie ordinate per tipo di servizio, eventuali video, una pagina su di te e un contatto per i preventivi. Pronto in pochi minuti, pensato per far parlare le immagini.</p>' +
      '<p>Per un fotografo il sito <em>è</em> il portfolio: deve mostrare i lavori migliori e rendere semplice chiederti un preventivo.</p>',
    checks: [
      'Gallerie del portfolio per categoria',
      'Video incorporati da YouTube (reel e backstage)',
      'Pagina "chi sono" e stile di lavoro',
      'Pacchetti e richiesta preventivo',
      'Modulo contatti e social',
      'Hosting, SSL e dominio inclusi',
    ],
    sections: [
      {
        h2: 'Cosa serve davvero al sito di un fotografo',
        body:
          '<p>Il sito di un fotografo vive di <strong>immagini</strong> e di <strong>chiarezza</strong>: gallerie curate per categoria (matrimoni, ritratti, eventi, prodotto), una presentazione del tuo stile e un modo immediato per richiederti un preventivo.</p>' +
          '<p>Con brik organizzi i tuoi lavori in gallerie ordinate e aggiungi un contatto per le richieste, così trasformi chi guarda in chi prenota.</p>',
      },
      {
        h2: 'Foto e video',
        body:
          '<p>Carichi le tue foto e brik le inserisce nelle gallerie. Puoi anche <strong>incorporare i tuoi video YouTube</strong> (showreel, backstage): si vede l\'anteprima e il player parte al clic, così la pagina resta veloce. Basta incollare i link dei video.</p>',
      },
    ],
    faq: [
      { q: 'Posso caricare le mie foto e organizzarle in gallerie?', a: 'Sì: carichi le tue foto e brik le ordina in gallerie per categoria (matrimoni, ritratti, eventi…), che puoi rinominare e riorganizzare.' },
      { q: 'Posso mostrare i miei video?', a: 'Sì: incolli i link dei tuoi video YouTube e il sito mostra l\'anteprima con play; il player si carica solo al clic, così la pagina resta leggera.' },
      { q: 'I clienti possono chiedermi un preventivo?', a: 'Sì: c\'è un modulo di contatto/preventivo e i collegamenti ai tuoi social. Le richieste ti arrivano via email.' },
      { q: 'Il sito compare su Google?', a: 'Sì, è ottimizzato per la ricerca e veloce, così ti trova chi cerca un fotografo per il proprio evento.' },
      { q: 'Quanto costa?', a: 'Crei e rifinisci il sito gratis; paghi solo quando lo pubblichi. Dettagli nella pagina prezzi.' },
    ],
    promptSeed: 'Sito portfolio per il mio lavoro di fotografo: ',
    ctaLabel: 'Crea il tuo portfolio',
  },
  {
    slug: 'commercialista',
    title: 'Sito web per commercialisti e studi · Brik',
    metaDescription:
      'Crea il sito del tuo studio di commercialista descrivendolo a parole: servizi, a chi ti rivolgi, team e contatti. Online in pochi minuti, hosting e dominio inclusi.',
    h1: 'Il sito web per il tuo studio di commercialista',
    intro:
      '<p class="lead">Descrivi il tuo studio e brik prepara il sito: servizi, a chi ti rivolgi (privati, professionisti, aziende), presentazione dello studio e un contatto per richiedere una consulenza. Chiaro e professionale, pronto in pochi minuti.</p>' +
      '<p>Chi cerca un commercialista vuole capire subito <strong>di cosa ti occupi</strong> e <strong>se fai al caso suo</strong>: il sito lo chiarisce e rende facile contattarti.</p>',
    checks: [
      'Elenco dei servizi (contabilità, dichiarazioni, consulenza)',
      'A chi ti rivolgi (privati, partite IVA, aziende)',
      'Presentazione dello studio e del team',
      'Richiesta di consulenza e contatti',
      'Orari e mappa dello studio',
      'Hosting, SSL e dominio inclusi',
    ],
    sections: [
      {
        h2: 'Cosa serve davvero al sito di un commercialista',
        body:
          '<p>Il valore del sito è la <strong>chiarezza</strong>: servizi spiegati in modo comprensibile, indicazione di a chi ti rivolgi e una presentazione che trasmetta <strong>affidabilità</strong>. Poi un contatto semplice per la prima consulenza.</p>' +
          '<p>Con brik il sito presenta i tuoi servizi in modo ordinato, distingue privati e aziende e mette un modulo per richiedere un appuntamento.</p>',
      },
      {
        h2: 'Come funziona',
        body:
          '<p>Descrivi lo studio (es. «studio commercialista a Milano, contabilità e dichiarazioni per partite IVA e PMI, consulenza fiscale»). brik genera la bozza e la rifinisci parlando. Vedi <a href="/how-it-works">come funziona</a>.</p>',
      },
    ],
    faq: [
      { q: 'Posso elencare i miei servizi?', a: 'Sì: il sito include una sezione con i servizi (contabilità, dichiarazioni, consulenza fiscale…), descritti in modo chiaro e aggiornabile.' },
      { q: 'Posso distinguere privati e aziende?', a: 'Sì, puoi organizzare i contenuti per tipo di cliente, così ognuno trova subito ciò che lo riguarda.' },
      { q: 'I clienti possono richiedere una consulenza dal sito?', a: 'Sì: c\'è un modulo di contatto e richiesta appuntamento; le richieste ti arrivano via email.' },
      { q: 'Il sito compare su Google?', a: 'Sì, è ottimizzato per la ricerca e veloce, così ti trova chi cerca un commercialista nella tua zona.' },
      { q: 'Quanto costa?', a: 'Crei e rifinisci il sito gratis; paghi solo quando lo pubblichi. Dettagli nella pagina prezzi.' },
    ],
    promptSeed: 'Sito per il mio studio di commercialista: ',
    ctaLabel: 'Crea il sito del tuo studio',
  },
  {
    slug: 'avvocato',
    title: 'Sito web per avvocati e studi legali · Brik',
    metaDescription:
      'Crea il sito del tuo studio legale descrivendolo a parole: aree di competenza, profilo, contatti per una consulenza. Online in pochi minuti, hosting e dominio inclusi.',
    h1: 'Il sito web per il tuo studio legale',
    intro:
      '<p class="lead">Descrivi il tuo studio e brik prepara il sito: aree di competenza, profilo professionale e un contatto riservato per richiedere una consulenza. Sobrio e professionale, pronto in pochi minuti.</p>' +
      '<p>Chi cerca un avvocato vuole capire <strong>di cosa ti occupi</strong> e percepire <strong>autorevolezza</strong>: il sito presenta le tue aree e la tua esperienza, con un contatto discreto.</p>',
    checks: [
      'Aree di competenza (civile, penale, lavoro, famiglia…)',
      'Profilo professionale ed esperienza',
      'Richiesta di consulenza e contatti',
      'Sedi, orari e mappa',
      'Tono sobrio, rispettoso della deontologia',
      'Hosting, SSL e dominio inclusi',
    ],
    sections: [
      {
        h2: 'Cosa serve davvero al sito di uno studio legale',
        body:
          '<p>Il sito di un avvocato comunica con <strong>sobrietà</strong> e <strong>chiarezza</strong>: aree di competenza ben definite, un profilo che dia autorevolezza e un contatto riservato. Niente promesse o toni pubblicitari: informazione corretta e professionale.</p>' +
          '<p>Con brik il sito presenta le tue aree di attività e la tua esperienza, e mette un modulo per richiedere una prima consulenza.</p>',
      },
      {
        h2: 'Come funziona',
        body:
          '<p>Descrivi lo studio (es. «studio legale a Roma, diritto civile, del lavoro e di famiglia, consulenza su appuntamento»). brik genera la bozza e la rifinisci parlando. Vedi <a href="/how-it-works">come funziona</a>.</p>',
      },
    ],
    faq: [
      { q: 'Posso indicare le mie aree di competenza?', a: 'Sì: il sito include una sezione con le aree di attività, descritte in modo chiaro e aggiornabile quando vuoi.' },
      { q: 'Posso presentare il mio profilo ed esperienza?', a: 'Sì, con una pagina dedicata al profilo professionale, mantenendo un tono sobrio e conforme alla deontologia.' },
      { q: 'I clienti possono richiedere una consulenza dal sito?', a: 'Sì: c\'è un modulo di contatto per richiedere un appuntamento; le richieste ti arrivano via email.' },
      { q: 'Il sito compare su Google?', a: 'Sì, è ottimizzato per la ricerca e veloce, così ti trova chi cerca un avvocato nella tua zona o area.' },
      { q: 'Quanto costa?', a: 'Crei e rifinisci il sito gratis; paghi solo quando lo pubblichi. Dettagli nella pagina prezzi.' },
    ],
    promptSeed: 'Sito per il mio studio legale: ',
    ctaLabel: 'Crea il sito del tuo studio',
  },
  {
    slug: 'bnb',
    title: 'Sito web per B&B e affittacamere · Brik',
    metaDescription:
      'Crea il sito del tuo B&B descrivendolo a parole: camere e foto, servizi, richieste di prenotazione dirette e dintorni. Online in pochi minuti, hosting incluso.',
    h1: 'Il sito web per il tuo B&B',
    intro:
      '<p class="lead">Descrivi il tuo bed & breakfast e brik prepara il sito: camere con foto, servizi inclusi, posizione e dintorni, e un modo diretto per ricevere richieste di prenotazione. Pronto in pochi minuti, perfetto da telefono.</p>' +
      '<p>Un sito tuo ti fa ricevere <strong>prenotazioni dirette</strong>, senza le commissioni dei portali: l\'ospite vede le camere e ti contatta direttamente.</p>',
    checks: [
      'Pagina camere con foto e descrizioni',
      'Servizi inclusi (colazione, wifi, parcheggio…)',
      'Richiesta di prenotazione diretta',
      'Posizione, mappa e cosa vedere nei dintorni',
      'Pulsanti per chiamare e scrivere su WhatsApp',
      'Hosting, SSL e dominio inclusi',
    ],
    sections: [
      {
        h2: 'Cosa serve davvero al sito di un B&B',
        body:
          '<p>L\'ospite decide con le <strong>foto delle camere</strong>, i <strong>servizi</strong> e la <strong>posizione</strong>. E se può prenotare direttamente da te, risparmi le commissioni dei portali e costruisci un rapporto diretto.</p>' +
          '<p>Con brik il sito mostra le camere con le tue foto, elenca i servizi, racconta i dintorni e mette un contatto immediato per le richieste di prenotazione.</p>',
      },
      {
        h2: 'Come funziona',
        body:
          '<p>Descrivi la struttura (es. «B&B con 4 camere in Salento, colazione inclusa, vicino al mare, prenotazione diretta»). brik genera la bozza e la rifinisci parlando. Vedi <a href="/how-it-works">come funziona</a>.</p>',
      },
    ],
    faq: [
      { q: 'Posso mostrare le camere con le foto?', a: 'Sì: il sito include una pagina camere con foto e descrizioni; carichi le tue immagini e brik le inserisce in modo ordinato.' },
      { q: 'Posso ricevere prenotazioni dirette dal sito?', a: 'Sì: c\'è un modulo per le richieste di prenotazione e pulsanti per chiamare o scrivere su WhatsApp, così eviti le commissioni dei portali. Le richieste ti arrivano via email.' },
      { q: 'Posso raccontare i dintorni e cosa vedere?', a: 'Sì, con una sezione dedicata alla posizione e ai luoghi di interesse vicini, utile per convincere chi sta scegliendo dove dormire.' },
      { q: 'Il sito compare su Google?', a: 'Sì, è ottimizzato per la ricerca e veloce, così ti trova chi cerca un B&B nella tua zona.' },
      { q: 'Quanto costa?', a: 'Crei e rifinisci il sito gratis; paghi solo quando lo pubblichi. Dettagli nella pagina prezzi.' },
    ],
    promptSeed: 'Sito per il mio B&B: ',
    ctaLabel: 'Crea il sito del tuo B&B',
  },
];

const bySlug = new Map<string, SeoCategory>(CATEGORIES.map((c) => [c.slug, c] as const));
export function getCategory(slug: string): SeoCategory | null {
  return bySlug.get(slug) ?? null;
}
export function allCategorySlugs(): string[] {
  return CATEGORIES.map((c) => c.slug);
}

const NAV =
  '<nav class="nav"><div class="nav-inner">' +
  '<a class="nav-logo" href="/"><img src="/brik-logo.png" alt="Brik" /></a>' +
  '<div class="nav-links">' +
  '<a href="/how-it-works">Come funziona</a><a href="/templates">Modelli</a><a href="/pricing">Prezzi</a>' +
  '<a class="btn btn-primary nav-cta" href="/">Crea il sito</a>' +
  '</div></div></nav>';

const FOOT =
  '<footer class="foot"><div class="foot-inner">' +
  '<div class="foot-brand"><a class="nav-logo" href="/"><img src="/brik-logo.png" alt="Brik" /></a>' +
  '<p>Il sito della tua attività, descritto a parole. Creato, verificato e pubblicato in pochi minuti.</p>' +
  '<p class="foot-legal">Atlantix Srl · P.IVA 11262860965<br>Via Imperia, 43 — 20142 Milano</p></div>' +
  '<div><h4>Prodotto</h4><a href="/how-it-works">Come funziona</a><a href="/templates">Modelli</a><a href="/pricing">Prezzi</a></div>' +
  '<div><h4>Inizia</h4><a href="/">Crea il sito</a><a href="/?login=1">Accedi</a></div>' +
  '</div><div class="foot-fine"><div class="wrap"><span>© 2026 Brik</span><span>Fatto in Italia</span></div></div></footer>';

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com" />' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />' +
  '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Spline+Sans+Mono:wght@400;500&display=swap" rel="stylesheet" />';

export function renderCategoryPage(cat: SeoCategory): string {
  const url = BASE + '/templates/' + cat.slug;
  const promptHref = '/?prompt=' + encodeURIComponent(cat.promptSeed);

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Modelli', item: BASE + '/templates' },
      { '@type': 'ListItem', position: 3, name: cat.h1, item: url },
    ],
  };
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: cat.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  const checks =
    '<ul class="checks">' + cat.checks.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>';
  const sections = cat.sections
    .map((s) => '<section class="section wrap"><h2>' + esc(s.h2) + '</h2><div class="prose">' + s.body + '</div></section>')
    .join('');
  const faq =
    '<section class="faq wrap"><div class="section-head"><h2>Domande frequenti</h2></div>' +
    cat.faq
      .map((f) => '<details><summary>' + esc(f.q) + '</summary><div class="ans">' + esc(f.a) + '</div></details>')
      .join('') +
    '</section>';

  return (
    '<!doctype html><html lang="it"><head>' +
    '<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />' +
    '<title>' + esc(cat.title) + '</title>' +
    '<meta name="description" content="' + esc(cat.metaDescription) + '" />' +
    '<meta name="robots" content="index,follow" />' +
    '<link rel="canonical" href="' + url + '" />' +
    '<meta property="og:title" content="' + esc(cat.h1) + '" />' +
    '<meta property="og:description" content="' + esc(cat.metaDescription) + '" />' +
    '<meta property="og:type" content="website" />' +
    '<meta property="og:url" content="' + url + '" />' +
    FONTS +
    '<link rel="stylesheet" href="/marketing.css" />' +
    '<link rel="icon" type="image/png" href="/favicon.png" />' +
    '<script type="application/ld+json">' + JSON.stringify(breadcrumbLd) + '</script>' +
    '<script type="application/ld+json">' + JSON.stringify(faqLd) + '</script>' +
    '</head><body class="mkt">' +
    NAV +
    '<nav class="wrap" aria-label="breadcrumb" style="font-size:.85rem;opacity:.7;padding:18px 0 0">' +
    '<a href="/">Home</a> › <a href="/templates">Modelli</a> › <span>' + esc(cat.h1) + '</span></nav>' +
    '<header class="hero wrap"><h1>' + esc(cat.h1) + '</h1>' + cat.intro +
    '<div class="hero-actions"><a class="btn btn-primary btn-lg" href="' + promptHref + '">' + esc(cat.ctaLabel) + '</a>' +
    '<a class="btn btn-ghost" href="/templates">Tutti i modelli</a></div></header>' +
    '<section class="section wrap"><h2>Incluso in ogni sito</h2>' + checks + '</section>' +
    sections +
    faq +
    '<section class="cta-band"><div class="wrap"><h2>La tua attività merita di essere online</h2>' +
    '<p class="lead">Descrivila in una frase. Al resto pensa Brik.</p>' +
    '<a class="btn btn-primary btn-lg" href="' + promptHref + '">Crea il mio sito</a></div></section>' +
    FOOT +
    '</body></html>'
  );
}

/** Sitemap XML da pagine marketing fisse + categorie. */
export function sitemapXml(): string {
  const staticPaths = ['/', '/how-it-works', '/pricing', '/templates'];
  const urls = [...staticPaths, ...allCategorySlugs().map((s) => '/templates/' + s)];
  const body = urls
    .map((p) => '  <url><loc>' + BASE + p + '</loc></url>')
    .join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + '\n</urlset>\n';
}
