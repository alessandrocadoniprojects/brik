# block/hero-firststep — Hero = primo passo reale dell'intake (skip "Da dove vuoi partire?")

**Tipo:** client UI + copy. Nessun nuovo flusso, nessun cambio backend.

## Obiettivo
Quando il box hero contiene già una descrizione ricca, l'utente non deve più passare dallo step "Da dove vuoi partire?" come primo ostacolo: la sua descrizione implica già il path "scrivo io". Si elimina l'attrito percepito del doppio passaggio mantenendo lo step raggiungibile per chi parte da un sito/social esistente.

## Contesto (audit)
- Primo step intake = `askStartingPoint` ("Da dove vuoi partire?", `web/app.js`), a pulsanti, 5 path: existing-site / social-or-maps / materials / guided-from-zero / **free-description**.
- Il box passa già la descrizione al flusso (`startFromLanding → beginCreate`); la descrizione NON viene ri-chiesta. La ridondanza era percepita, non di dati.
- `free-description` è già una `StartingPointMode` valida (`src/server/startingPoint.ts`), gestita a valle (pizzeria-intake, `/api/projects` startingPoint, `normalizeStartingPoint`).

## File dichiarati
- `web/app.js` — helper `isSelfDescribed()` + skip condizionale in `beginCreate`.
- `web/index.html` — copy box: label "Che attività mettiamo online?", placeholder "Pizzeria a Verona, forno a legna…", bottone "Inizia".
- `web/marketing.css` — una regola per `.promptbox-label`.
- `docs/VISION.md`, `docs/ROADMAP.md` (nota), `docs/blocks/hero-firststep.md` (questa spec).

## Soglia "descrizione sufficiente"
`isSelfDescribed(text)` = trim length **≥ 15 caratteri** E **≥ 2 parole**. Sopra soglia → skip (preselezione `{mode:'free-description'}`). Sotto soglia → `askStartingPoint` come oggi.

## Criterio di accettazione
1. Descrizione ricca nel box → lo step "Da dove vuoi partire?" NON appare; si entra diretti nello step successivo dell'intake. (Verificato Playwright: "Pizzeria a Verona, forno a legna, menù e contatti" → step assente.)
2. Input corto ("Bar") → lo step "Da dove vuoi partire?" appare ancora (path da sito/social/materiali raggiungibili). (Verificato Playwright.)
3. Le chip restano e funzionano da risposte rapide (riempiono l'input → al submit, essendo descrizioni ricche, saltano lo step).
4. Copy box: label "Che attività mettiamo online?", placeholder "Pizzeria a Verona, forno a legna…", bottone "Inizia".
5. Nessun nuovo flusso/endpoint: riuso di `{mode:'free-description'}`; `pendingStartingPoint` valorizzato come se l'utente avesse scelto quel path.

## Vincoli / invarianti
- Minimale; lo step non è eliminato, solo non obbligato come primo passo quando la descrizione c'è già.
- Nessun cambio backend; `app.js` è JS (fuori dal typecheck TS) → verifica `node --check` + test comportamentale Playwright.
