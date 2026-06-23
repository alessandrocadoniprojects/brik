# INVARIANTS — brik

Regole di prodotto che nessun blocco può violare. Estratte dai `FASE*.md`. Il Reviewer le verifica a ogni PR.

- **Mai pubblicare placeholder.** Le route interne incomplete sono marcate `<html data-brik-pending="1">`; `isPlaceholderHtml()` le riconosce. Il publish non manda mai online placeholder o link rotti.
- **La home non viene mai sovrascritta.** Le route interne e le modifiche utente non toccano la home (`completePages` sostituisce solo i placeholder). La home, una volta reale, non cambia.
- **WYSIWYG al publish.** Ciò che si vede in preview è ciò che va online. `finalize` resta OFF salvo decisione esplicita.
- **Nessun ciclo LLM extra non richiesto.** Le ottimizzazioni di preview riorganizzano le chiamate, non ne aggiungono. Stesso totale di generazioni.
- **Soglie dei detector invariate.** Non alterare le soglie dei detector (anti-pattern, image quality, ecc.) senza un blocco dedicato e approvato.
- **Design system.** Autorevolezza per sobrietà e gerarchia tipografica, mai per volume o numeri gonfiati. Rispettare token/classi del design system, non inline ad hoc.
- **Routing per stringa.** Le route interne si calcolano per stringa (`r.route !== homeKey`), non per identità di oggetto.
