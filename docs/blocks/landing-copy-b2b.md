# block/landing-copy-b2b — Landing copy → posizionamento B2B white-label

**Tipo:** solo copy (HTML statico). Nessun cambio di layout, logica o funzionalità.

## Obiettivo
Allineare i testi della superficie marketing al pubblico reale del prodotto — **freelance marketing / agenzie** che generano siti per i loro clienti — coerente col pricing multi-sito e col fatto che i siti pubblicati sono **white-label** (nessun riferimento a brik). Già coerente con `VISION.md` (rivenditore, white-label grigio); la copy era rimasta B2C.

## File dichiarati
- `web/index.html` (hero, step "Come funziona" 03, sezione "Tutto incluso", label prezzo, FAQ, closing, footer, title/meta/og)
- `web/pricing.html`, `web/how-it-works.html`, `web/templates.html` (solo stringhe **condivise identiche**: label prezzo, CTA "Crea il primo sito", footer-tagline, closing band)
- `docs/VISION.md`, `docs/ROADMAP.md` (nota di allineamento)

## Criterio di accettazione
1. **Hero** — Titolo: "Siti di alta qualità per i tuoi clienti, generati in minuti." · Sottotitolo: "Da una semplice descrizione, Brik costruisce un sito completo — testi, immagini, pagine e contatti. Lo consegni a tuo nome: nessun riferimento a Brik." · CTA primaria: "Crea il primo sito" · invariato "Nessuna carta richiesta · provi gratis".
2. **Come funziona — step 03** — Titolo "Consegna"; testo "Pubblichi con un click, o lo passi al cliente per l'ok."
3. **Tutto incluso** — nuova voce "Senza marchio Brik" ("I siti escono puliti, a nome tuo o del cliente. Nessun badge, nessun riferimento a noi.") + "Design professionale per categoria" ("Basi di design curate per settore, così ogni sito sembra fatto su misura.") che sostituisce "Template di alto livello".
4. **Prezzo** — i tre label 3/10/30 "… siti pubblicati contemporaneamente." → "… siti online per i tuoi clienti."
5. **FAQ** — +2: "Il sito mostra che è fatto con Brik?" / "Posso gestire più clienti con un solo account?" (testi come da brief).
6. **Closing** — Titolo "Consegna ai tuoi clienti siti di cui andare fieri." · Sottotitolo "Descrivili in una frase. Al resto pensa Brik — e il tuo nome resta l'unico in vista." · CTA "Crea il primo sito".
7. **Footer tagline** — "Siti per i tuoi clienti, descritti a parole. Creati, verificati e consegnati a nome tuo."
8. Nessuna stringa vecchia residua ("pubblicati contemporaneamente", "Crea il mio sito", "Il sito della tua attività, descritto a parole"). White-label veritiero: nessun badge brik iniettato nel pubblicato.

## Vincoli / invarianti
- Solo testi. Nessun cambio di layout/logica/funzionale. Nessuna nuova dipendenza.
- Niente i18n nel progetto: nessuna chiave da aggiornare.
- Le occorrenze "siti pubblicati" in meta/FAQ di `pricing.html` che descrivono il **meccanismo di billing** (slot `maxPublished`) restano invariate: non sono il label white-label.
