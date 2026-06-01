/**
 * Scenari di eval — prompt realistici stile utente non-tecnico, su più categorie
 * del beachhead (attività locali, lead, prenotazioni, portfolio).
 *
 * Tutti single-page (route "/"), perché il generatore produce un index.html.
 * I criteri estratti saranno un mix di content-present (frasi esatte tra
 * virgolette), form-submission (form + conferma) e responsive (mobile).
 * La difficoltà cresce col numero di frasi esatte da rispettare.
 */
import type { ProjectCategory } from '../core/index.js';

export interface EvalScenario {
  readonly id: string;
  readonly category: ProjectCategory;
  readonly title: string;
  readonly description: string;
  readonly knownRoutes: readonly string[];
  readonly statements: readonly string[];
}

const r = ['/'] as const;

export const SCENARIOS: readonly EvalScenario[] = [
  {
    id: 'biz-restaurant',
    category: 'business-landing',
    title: 'Trattoria da Mario',
    description: 'Sito vetrina di una trattoria sarda con contatti.',
    knownRoutes: r,
    statements: [
      'La home deve mostrare il titolo "Trattoria da Mario"',
      'Deve esserci la scritta "Cucina sarda dal 1985"',
      'Mostra la specialita "Malloreddus alla campidanese"',
      'Ci deve essere un form contatti con nome, email e messaggio che mostra "Grazie, ti ricontatteremo presto" dopo invio',
      'Il sito deve funzionare bene su mobile',
    ],
  },
  {
    id: 'biz-salon',
    category: 'business-landing',
    title: 'Salone Bellezza Viva',
    description: 'Sito vetrina di un parrucchiere con servizi e contatti.',
    knownRoutes: r,
    statements: [
      'In alto deve esserci il nome "Salone Bellezza Viva"',
      'Mostra il servizio "Taglio e piega" e il servizio "Colore"',
      'Indica gli orari "Aperto da martedi a sabato"',
      'Voglio un form di contatto con nome e telefono che mostra "Richiesta inviata" dopo invio',
      'Deve essere usabile bene da telefono',
    ],
  },
  {
    id: 'lead-coach',
    category: 'lead-landing',
    title: 'Coaching con Elena',
    description: 'Landing per un fitness coach che raccoglie contatti.',
    knownRoutes: r,
    statements: [
      'Titolo grande "Trasforma il tuo corpo in 12 settimane"',
      'Sottotitolo "Programmi personalizzati di allenamento e nutrizione"',
      'Un modulo per lasciare nome ed email che mostra "Ti scrivero a breve" dopo invio',
      'Deve funzionare su mobile',
    ],
  },
  {
    id: 'lead-consultant',
    category: 'lead-landing',
    title: 'Studio Rossi Consulenza',
    description: 'Landing per un consulente aziendale.',
    knownRoutes: r,
    statements: [
      'Headline "Facciamo crescere la tua impresa"',
      'Mostra i tre servizi "Strategia", "Finanza" e "Marketing"',
      'Form di richiesta consulenza con nome, email e azienda che mostra "Grazie, ti contatteremo" dopo invio',
      'Ottimizzato per smartphone',
    ],
  },
  {
    id: 'booking-bnb',
    category: 'booking',
    title: 'B&B Il Glicine',
    description: 'Sito di un B&B con richiesta di prenotazione.',
    knownRoutes: r,
    statements: [
      'Nome struttura "B&B Il Glicine"',
      'Descrizione "Tre camere immerse nel verde della campagna toscana"',
      'Un form di prenotazione con nome, email, data di arrivo e numero di ospiti che mostra "Richiesta di prenotazione ricevuta" dopo invio',
      'Deve funzionare bene su mobile',
    ],
  },
  {
    id: 'booking-dentist',
    category: 'booking',
    title: 'Studio Dentistico Sorriso',
    description: 'Sito di uno studio dentistico con richiesta appuntamento.',
    knownRoutes: r,
    statements: [
      'Nome "Studio Dentistico Sorriso"',
      'Scritta "Il tuo sorriso, la nostra missione"',
      'Form appuntamento con nome, telefono e data preferita che mostra "Appuntamento richiesto" dopo invio',
      'Usabile da telefono',
    ],
  },
  {
    id: 'portfolio-photographer',
    category: 'portfolio',
    title: 'Luca Bianchi Fotografo',
    description: 'Portfolio di un fotografo con contatti.',
    knownRoutes: r,
    statements: [
      'Nome "Luca Bianchi Fotografo"',
      'Sottotitolo "Matrimoni e ritratti in tutta Italia"',
      'Form contatti con nome, email e messaggio che mostra "Messaggio inviato, grazie" dopo invio',
      'Deve funzionare su mobile',
    ],
  },
  {
    id: 'ecommerce-shop',
    category: 'ecommerce',
    title: 'Bottega Verde',
    description: 'Negozio a pagina singola con prodotti e richiesta ordine.',
    knownRoutes: r,
    statements: [
      'Nome negozio "Bottega Verde"',
      'Slogan "Cosmetici naturali fatti a mano"',
      'Prodotto "Sapone all\'olio d\'oliva"',
      'Prodotto "Crema viso alla calendula"',
      'Form ordine con nome, email e prodotto desiderato che mostra "Ordine ricevuto, ti contattiamo presto" dopo invio',
      'Deve funzionare su mobile',
    ],
  },
  {
    id: 'blog-personal',
    category: 'blog',
    title: 'Pensieri Lenti',
    description: 'Blog personale a pagina singola con articoli e newsletter.',
    knownRoutes: r,
    statements: [
      'Titolo del blog "Pensieri Lenti"',
      'Sottotitolo "Note su libri, viaggi e cucina"',
      'Articolo "Tre giorni in Appennino"',
      'Articolo "La ricetta del pane di segale"',
      'Iscrizione newsletter con email che mostra "Iscrizione confermata" dopo invio',
      'Deve funzionare su mobile',
    ],
  },
  {
    id: 'directory-local',
    category: 'directory',
    title: 'Guida di Borgo Antico',
    description: 'Piccola directory locale a pagina singola con segnalazioni.',
    knownRoutes: r,
    statements: [
      'Titolo "Guida di Borgo Antico"',
      'Voce "Trattoria del Ponte"',
      'Voce "Libreria Aldina"',
      'Form per segnalare un\'attivita con nome ed email che mostra "Segnalazione inviata" dopo invio',
      'Deve funzionare su mobile',
    ],
  },
  {
    id: 'crud-todo',
    category: 'crud-app',
    title: 'Lista della Spesa',
    description: 'Mini app a pagina singola per aggiungere voci a una lista.',
    knownRoutes: r,
    statements: [
      'Titolo "Lista della Spesa"',
      'Per aggiungere un articolo c\'e un campo di testo e un pulsante "Aggiungi"; dopo l\'aggiunta compare il messaggio "Articolo aggiunto"',
      'Deve funzionare su mobile',
    ],
  },
  {
    id: 'stress-many-strings',
    category: 'business-landing',
    title: 'Officina Meccanica Rapido',
    description: 'Sito vetrina con molte informazioni esatte da rispettare.',
    knownRoutes: r,
    statements: [
      'Titolo "Officina Meccanica Rapido"',
      'Slogan "Auto come nuova in giornata"',
      'Indirizzo "Via Garibaldi 22, Milano"',
      'Telefono "02 1234567"',
      'Orari "Lun-Ven 8:00-18:00"',
      'Servizio "Tagliando completo" e servizio "Cambio gomme"',
      'Form contatti con nome, email e messaggio che mostra "Grazie per averci contattato" dopo invio',
      'Deve funzionare bene su mobile',
    ],
  },
];
