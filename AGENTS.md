# AGENTS.md — brik

Entry point per ogni agente che lavora su questo repo. Leggi prima questo. Per il "perché" di prodotto apri `docs/VISION.md`; per "cosa costruire" apri `docs/ROADMAP.md`. Non caricare quei file se non servono al task corrente.

## Cos'è
Generatore AI di siti vetrina, venduto ad agenzie di marketing (vedi `docs/VISION.md`). Node + tsx (nessun build step), architettura esagonale: `src/core` (porte/dominio), `src/adapters` (LLM, hosting, immagini, form), `src/intake`, `src/orchestrator`, `src/project`, `src/qa`, `src/server`. Frontend vanilla in `web/`.

## Comandi
- Test: `npm test` (esegue `tsx --test test/site.test.ts`)
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Lint: `npm run lint` — *(ESLint+Prettier: da introdurre, vedi ROADMAP)*
- Il server di produzione gira via systemd: `systemctl restart brik` (unit `brik.service`, `ExecStart=tsx --env-file=.env src/server/server.ts`).

## Baseline (NON sono regressioni tue)
- `npm run typecheck` ha **3 errori preesistenti** noti.
- `npm test` ha **1 fallimento noto** (`site.test #19`).
- Regola: non aumentare il numero di errori/fallimenti. Zero *nuovi*.

## Flusso di lavoro (obbligatorio)
1. Un blocco = una Issue = un branch `block/<id>`. Fai *claim* della Issue prima di iniziare.
2. Workflow: **analizza → conferma il piano con l'umano → implementa**. Mai codice prima del piano approvato.
3. Scrivi la spec dal template `docs/BLOCK_TEMPLATE.md`, **dichiara i file** che toccherai.
4. Implementa minimale, gira typecheck + test, non sforare la baseline.
5. Apri PR. **L'umano revisiona e fa merge.** Tu non fai merge né deploy.

## Confini (always / ask / never)
- **Always**: leggere il repo; girare test/typecheck/lint su file cambiati; scrivere sul tuo branch.
- **Ask first** (richiedi OK umano): installare dipendenze; modificare `.env`, `.gitignore`, `package.json`, `brik.service`; toccare `src/core` (porte/dominio); migrazioni dati.
- **Never**: `git push` su `main`; `git merge`; `systemctl`/deploy/restart di produzione; `--force`; cancellare file o dati; toccare `/opt/brik/data/` (runtime live); committare segreti.

## Invarianti di prodotto
Vedi `docs/INVARIANTS.md`. In sintesi: mai pubblicare placeholder; la home non va sovrascritta dalle route interne; non alterare le soglie dei detector; nessun ciclo LLM extra non richiesto; rispettare il design system.

## Quando sei bloccato
Se i test falliscono ripetutamente, se il task tocca un invariante, o se il piano richiede qualcosa nei "Never": **fermati e chiedi all'umano.** Non improvvisare, non allargare lo scope.

## Note d'ambiente
- Il server avvia **Playwright + Chrome headless** per il QA: è pesante, considera questo prima di lanciare build/QA reali in locale.
- `/opt/brik` è produzione live: nessuna prova distruttiva qui.
