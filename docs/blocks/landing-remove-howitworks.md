# block/landing-remove-howitworks — Rimuovi la sezione "Come funziona" dalla landing

**Tipo:** solo rimozione di markup (HTML statico). Nessuna ristrutturazione, nessun cambio di logica/layout.

## Obiettivo
Eliminare dalla landing (`web/index.html`) la sezione inline "Come funziona" / "Dal testo al sito in tre passaggi" (i 3 step Descrivi / Genera / Consegna). Per il pubblico addetti-ai-lavori l'explainer base è ridondante.

## Audit (pre-rimozione)
- **Link nav (`web/index.html:85`) e footer (`:191`) "Come funziona" → `/how-it-works`** (pagina dedicata), NON un'ancora inline (nessun `#come-funziona`). → si **lasciano** (regola: se il link punta alla pagina, non toccarlo). Nessuna ancora morta.
- La sezione inline **non ha `id`** → nessun link interno la referenzia.
- **Pagina dedicata `/how-it-works` (`web/how-it-works.html`) esiste e va lasciata intatta.**
- **CSS `.steps/.step/.step-ic/.step-n` (`web/marketing.css`) è CONDIVISO** con `web/how-it-works.html` (che usa gli stessi `class="steps"/"step"`) → **NON è orfano**, si mantiene.

## File dichiarati
- `web/index.html` — rimozione del solo `<section>` "Come funziona".
- `docs/VISION.md`, `docs/ROADMAP.md` (nota), `docs/blocks/landing-remove-howitworks.md` (questa spec).

## Criterio di accettazione
1. La sezione inline ("Come funziona" eyebrow + "Dal testo al sito in tre passaggi" + i 3 `.step`) è rimossa da `web/index.html`.
2. Nav e footer "Come funziona" → `/how-it-works` restano invariati (nessuna ancora morta).
3. `web/how-it-works.html` non toccata; CSS `.steps` mantenuto (condiviso).
4. Giunzione hero → "Tutto incluso" pulita: una sola blank line, nessuna banda vuota o bordo rotto (verifica screenshot desktop).
5. Solo rimozione: nessun'altra modifica di markup/CSS/logica.
