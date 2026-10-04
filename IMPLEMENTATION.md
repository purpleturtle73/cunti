# IMPLEMENTATION — Cunti

Documento di riferimento dell'implementazione. **Va tenuto aggiornato a ogni modifica**: nuove funzionalità, nuovi test, decisioni architetturali e changelog in fondo.

## Architettura

| Componente | Scelta | Perché |
|---|---|---|
| Framework | SvelteKit (Svelte 5, runes) + adapter-node | full-stack in un solo container, SSR |
| Database | SQLite via better-sqlite3, WAL | single-user, backup = un file (`/data/cunti.db`) |
| Grafici | SVG custom (nessuna libreria) | pieno controllo del design, zero dipendenze runtime |
| Font | Inter Variable + Space Grotesk Variable (bundle @fontsource) | nessuna richiesta esterna, funziona offline |
| Container | Containerfile multi-stage su node:22-slim | prebuilt binaries di better-sqlite3 (glibc) |
| Deploy | Podman Quadlet (systemd), immagine da ghcr.io | standard dell'utente; niente compose |

### Struttura

```
src/
  hooks.server.ts              avvia lo scheduler prezzi (guard anti doppio-init)
  lib/format.ts                formattazione it-IT (EUR, valute generiche, %, date, quantità)
  lib/server/
    db.ts                      schema + helper SQLite (instruments, transactions, prices, brokers, fx_rates, settings)
    prices.ts                  fetcher Yahoo/CoinGecko (valuta strumento), FX EURUSD, refreshAll, scheduler 6h
    portfolio.ts               motore: posizioni (PMC), lotti di acquisto (FIFO), serie giornaliera, TWR, periodi, drawdown, conversione EUR
    backup.ts                  backup/restore SQLite, rotazione 10gg, scheduler giornaliero
    staging.ts                 staging generico degli import a due fasi (token UUID, TTL 1h, per dominio)
    transactions.ts            transazioni: import a due fasi, export CSV, svuotamento con backup
    txcsv.ts                   parser CSV import transazioni (puro, testabile)
    tax.ts                     stime fiscali italiane
    *.test.ts                  unit test vitest
  lib/components/
    AreaChart.svelte           area+linea con crosshair/tooltip, linea "investito" tratteggiata
    Donut.svelte               allocazione con gap 2°, hover, centro dinamico
    Bars.svelte                flussi mensili PAC (investito/disinvestito)
    LotsTable.svelte           tabella dei singoli acquisti (lotti FIFO) con filtro aperte/chiuse
    StatTile.svelte            tile statistica
  routes/
    +layout.svelte             shell: barra laterale collassabile (desktop) / drawer con burger (mobile)
    +page.svelte               dashboard (hero, pill periodi, marker operazioni, tiles, fisco, posizioni, lotti)
    transactions/              CRUD transazioni + modifica inline, duplica, export CSV (import in /admin)
    spese/                     tracker spese: dashboard, movimenti, import a due fasi, categorie/regole
    instruments/               solo redirect 301 → /admin (gestione spostata lì)
    positions/[id]/            dettaglio posizione
    admin/                     amministrazione: strumenti, broker, import/svuota transazioni, spese, backup/restore, report refresh
    api/refresh/+server.ts     POST refresh prezzi manuale
    api/health/+server.ts      healthcheck (SELECT 1 sul DB)
    api/backups/[name]/        GET download backup
    api/brokers/[id]/logo/     GET logo broker (BLOB dal DB)
scripts/make-demo-db.js        genera DATA_DIR/demo-cunti.db con dati generici (uso manuale)
```

### Navigazione: barra laterale collassabile

- **Desktop** (>900px): la barra è una colonna della griglia (`--side-w`: 230px estesa, 76px ridotta) con transizione su `grid-template-columns`. Il tasto **burger** nell'intestazione della barra alterna i due stati; da ridotta restano solo le icone (etichette in `title`, logo senza nome, footer compatto). La preferenza è per browser in `localStorage` (`cunti:sidebar-collapsed`), letta in un `$effect` **dopo** l'idratazione così l'HTML SSR resta uno solo.
- **Mobile** (≤900px): la barra diventa un drawer `position: fixed` fuori schermo, aperto dal burger della topbar; scrim cliccabile, `Esc` per chiudere, chiusura automatica al cambio pagina (`$effect` su `page.url.pathname`). Nel drawer la barra è sempre estesa, anche se su desktop è ridotta.
- Ogni strumento nelle tabelle è **nome + ticker** (`<span class="ticker">`, stile globale in `app.css`); nel donut il ticker compare in legenda e al centro all'hover, dove il nome per esteso non ci starebbe.

### Backup e restore

- Motore in `lib/server/backup.ts`, cartella `DATA_DIR/backups`.
- **Creazione**: SQLite online backup API (`db.backup()`), consistente anche con WAL; nome `cunti-YYYYMMDD-HHmmssSSS.db` (millisecondi per evitare collisioni).
- **Scheduler**: controllo orario, backup se l'ultimo (`settings.last_backup`) ha più di 24h → almeno 1/giorno anche con container riavviati.
- **Rotazione**: alla creazione si eliminano i backup **automatici** più vecchi di 10 giorni, insieme ai json abbinati (sotto); i file caricati a mano (`upload-*.db`) non vengono toccati.
- **Json di configurazione abbinati**: `categories.json`/`categories-meta.json` (spese, fuori dal DB) vengono copiati a ogni backup con **lo stesso stem** del `.db` (`cunti-<stamp>.categories.json`) — versionati 1:1, non un'unica copia "ultima nota". Ruotati ed eliminati insieme al `.db` a cui sono abbinati; `restoreBackup()` li ripristina insieme alle tabelle. Senza json abbinato (backup precedenti alla funzionalità, o `.db` caricati a mano) il restore procede comunque e i json restano quelli attuali.
- **Restore**: `ATTACH` del file + transazione unica: `DELETE` di tutte le tabelle e `INSERT … SELECT` copiando solo le **colonne in comune** (un backup con schema più vecchio resta ripristinabile); `defer_foreign_keys` durante la copia, checkpoint WAL alla fine. Prima del restore viene creato un backup di sicurezza dello stato corrente (anch'esso con i suoi json abbinati, quindi recuperabile a sua volta).
- **Sicurezza**: nomi validati con regex + verifica che il path risolto stia in `backups/` (no traversal); il file viene aperto e verificato (tabelle attese) prima del restore. Upload limitato a `.db`.
- Pannello in `/admin`: backup manuale, lista con dimensione/data, download, ripristino (con conferma), eliminazione, upload di un file da ripristinare.

### Transazioni: modifica inline, duplica, import a due fasi, svuotamento

**Consultazione vs gestione** (stessa divisione delle spese): `/transactions` è inserimento manuale + storico + export; import di massa e svuotamento stanno in `/admin`.

- **Modifica inline**: nella tabella storico ogni riga ha ✎ che la trasforma in riga di input (tutti i campi: data, strumento, tipo, broker, quantità, prezzo, commissioni, note). Tecnica: un unico `<form id="edit-tx">` vuoto fuori dalla tabella + attributo HTML `form="edit-tx"` sugli input nelle celle (un `<form>` non può avvolgere un `<tr>`). Salva → action `update`; ✕ annulla.
- **Duplica** (⧉): action `duplicate` copia il record (`INSERT … SELECT`) e apre subito la copia in modifica inline (l'action ritorna `duplicatedId`).
- **Scelta strumento per ticker**: i due menu (nuova operazione e modifica inline) mostrano **solo il simbolo** (`SWDA.MI`, `bitcoin`), col nome completo nel `title`: inserendo un'operazione si ragiona per ticker, non per ragione sociale. L'ordine è per ticker (`localeCompare`, quindi case-insensitive: `DEMOB.MI`, `democoin`, `DEMOW.MI`) — `allInstruments()` resta ordinato per nome, che è l'ordine giusto altrove ma arbitrario in una lista di soli simboli.
- **Import CSV a due fasi** (in `/admin`, sezione «Transazioni: importa CSV»): `importTransactions` valida e parsa (parser puro `txcsv.ts`), poi `stageTxImport` mette il risultato in staging e ritorna l'anteprima — **nessuna scrittura sul DB**. L'anteprima mostra quante righe sono nuove, quante già presenti (con i numeri di riga) e la tabella delle operazioni che entrerebbero (ticker, data, tipo, quantità, prezzo, commissioni, broker), troncata a `PREVIEW_ROWS` = 50 con il conteggio delle altre. `Conferma import` (`applyTransactionImport`) inserisce, `Annulla` (`cancelTransactionImport`) scarta il token. Header obbligatorio `data;tipo;quantita;prezzo` **più `strumento` e/o `isin`** (opzionali `commissioni`, `broker`, `note`); separatore `;` o `,` autodetect; date `YYYY-MM-DD` o `DD/MM/YYYY`; decimali con virgola o punto (gestiti separatori migliaia); `tipo` = buy/sell/acquisto/vendita; campi quotati e BOM Excel gestiti. Con errori di formato (riportati riga per riga) non viene messo in staging nulla. Limite file 2 MB.
- **Niente conflitti da risolvere** (differenza dalle spese): il dedup delle transazioni è **binario** — una riga o è nuova, o è identica a una esistente e si salta. Le spese hanno invece dedup a conteggio e il concetto di conflitto di categoria, quindi la loro anteprima ha una tabella di scelta per riga che qui non serve.
- **La conferma ri-deduplica**: `applyTxStaging` passa da `insertTransactionsDedup`, non da un INSERT nudo, quindi se il DB è cambiato tra anteprima e conferma (inserimento manuale della stessa operazione) non nascono doppioni, e i numeri riportati sono quelli effettivi. Il token viene consumato: un secondo invio dà «Import scaduto o già applicato» invece di inserire due volte.
- **Svuotamento** (`/admin`, «Transazioni: svuota»): `wipeTransactions()` fa `await createBackup()` **prima** del `DELETE FROM transactions`, quindi un backup fallito annulla il wipe. Tripla frizione come per le spese: `confirm()` nativo, campo in cui scrivere `ELIMINA`, guardia server che rifiuta con 400 se la parola non combacia. Tocca **solo** `transactions`: strumenti, storico prezzi, cambi e broker restano (nessuna tabella referenzia `transactions(id)`, quindi non ci sono cascate). È il contrario di «elimina strumento», che invece cascata su transazioni e prezzi — e il motivo è che anagrafica e storico prezzi sono costosi da ricostruire e servono al reimport per risolvere `strumento`/`isin`. Abilita il ciclo **export → modifica a mano → svuota → reimporta** anche per gli investimenti.
- **Identificazione strumento via ISIN**: la colonna `isin` risolve lo strumento contro `instruments.isin`, normalizzando maiuscole/spazi/trattini. Se una riga ha entrambi, **l'ISIN vince** e il simbolo fa da conferma: se risolve a uno strumento diverso la riga è un errore, se non risolve affatto viene ignorato (i ticker dei broker spesso differiscono dal simbolo Yahoo). ISIN sconosciuto → errore di riga; ISIN censito su più strumenti → errore di ambiguità (la colonna non è UNIQUE a schema). Con le due colonne presenti ogni riga può usarne una sola, ma almeno una deve essere valorizzata.
- **Export CSV**: stesse colonne dell'import, ISIN incluso (`data;strumento;isin;tipo;quantita;prezzo;commissioni;broker;note`) → round-trip completo.
- **Deduplica import** (`insertTransactionsDedup` in db.ts): chiave di duplicato = strumento + tipo + data + quantità + prezzo + commissioni (note e broker esclusi di proposito). Le righe già presenti nel DB vengono saltate e segnalate con il numero di riga; il controllo gira dentro la transazione SQLite, quindi elimina anche i doppioni interni al file. Reimportare lo stesso CSV è idempotente. `stageTxImport` replica la stessa chiave in sola lettura per l'anteprima (inclusi i doppioni interni al file).
- Validazione condivisa `readTxForm()` tra `create` e `update` (controlli esistenza strumento/broker, date non future lato CSV, numeri finiti).

### Eliminazione strumento

Cascata (transazioni + prezzi) protetta su due livelli: doppia `confirm` client (la seconda esplicita sul numero di transazioni) e guardia server — l'action `delete` rifiuta con 400 se lo strumento ha transazioni e manca `force=1` (impostato solo dopo la seconda conferma).

### Logging e diagnostica

- `lib/server/log.ts`: `log`/`logError` su stdout/stderr con timestamp ISO e scope (`[prices]`, `[transazioni]`, `[spese]`, `[instruments]`, `[backup]`, `[http]`, `[server]`).
- Eventi loggati: avvio scheduler, inizio/esito refresh per simbolo (incluso errore Yahoo/CoinGecko per ticker inesistenti), import CSV transazioni (CSV rifiutato, staging creato, import applicato con inserite/saltate) e svuotamento transazioni, creazione strumento (punti scaricati o download fallito), eliminazione strumento.
- **Dove leggerli**: sviluppo → terminale di `npm run dev`; container → `podman logs -f cunti` o, con Quadlet, `journalctl --user -u cunti.service -f`.
- **In-app**: `/admin` mostra il report dell'ultimo refresh (`settings.last_refresh_report`): simbolo, esito, punti scaricati, errore.

### Valute (EUR/USD)

- `instruments.currency` (`EUR` default, `USD` selezionabile): prezzi e transazioni dello strumento sono nella sua valuta (CoinGecko: `vs_currency`; Yahoo quota nella valuta nativa del ticker).
- Serie cambio **EURUSD** da Yahoo (`EURUSD=X`, USD per 1 EUR) in tabella `fx_rates`, aggiornata nel refresh solo se esistono strumenti non-EUR; `eur = usd / rate`.
- `makeFxConverter()` (portfolio.ts): rate carry-forward (ultimo ≤ data), backfill col primo per date precedenti, identità senza dati FX.
- Motore: PMC tenuto **doppio** — in valuta strumento (display) e in EUR al cambio delle date di acquisto (aggregati e fisco, coerente col criterio fiscale italiano); serie giornaliera e flussi convertiti al cambio del giorno. Tutti i totali/graﬁci/fisco sono in EUR; PMC e prezzo nelle tabelle sono nella valuta dello strumento (`fmtCurrency`, locale sempre it-IT).

### Broker

- Tabella `brokers` (nome unico, logo BLOB + mime, max 512 KB, PNG/JPEG/SVG/WebP); `transactions.broker_id` con `ON DELETE SET NULL` (migrazione via `pragma table_info` per DB esistenti).
- CRUD nel pannello `/admin` (creazione con logo, cambio logo, eliminazione); selezione broker (opzionale) nel form transazioni; logo servito da `/api/brokers/[id]/logo`.

### Healthcheck

- `GET /api/health` → `SELECT 1` sul DB, 200/500.
- `HEALTHCHECK` nel Containerfile (fetch da Node ogni 30s, start-period 15s); nel Quadlet `Notify=healthy` fa dichiarare "avviato" il servizio systemd solo a healthcheck superato.
- **Quadlet**: `HealthCmd`/`HealthInterval`/`HealthTimeout`/`HealthStartPeriod`/`HealthRetries` dichiarati anche nell'unit `.container` (README), non solo nell'immagine — `Notify=healthy` valuta l'healthcheck alla creazione del container e senza questi campi fallisce con `sdnotify policy "healthy" requires a healthcheck to be set` (es. immagine pull-ata precedente all'aggiunta dell'HEALTHCHECK, o comunque non affidarsi solo al valore ereditato dall'immagine).

### Spese (tracker finanze personali)

Dettagli di progetto in PLAN_SPESE.md; stato: M1–M3 implementate (2026-07-06).

- **Dati**: tabella `expenses` (date, description, card, amount firmato, category TEXT libera); indici su data/categoria/card. Unica tabella nuova: regole e proprietà categorie stanno su **file di testo** in `DATA_DIR`.
- **Regole**: `categories.json` (formato storico `{categoria: [keyword…]}`, riletto a ogni uso) — `categorize.ts` replica lo script Python: substring case-insensitive, keyword più lunga vince, categoria esplicita del CSV vince sempre; keyword con metacaratteri regex segnalate (mai matchate). `categories-meta.json` (gestito da UI, editabile a mano): icona, colore, flag `transfer` (giroconti esclusi dai totali).
- **Import a due fasi** (`expenses.ts`): parse (`expensecsv.ts`: colonne minime data_ops/descrizione/importo; card/moneyin/moneyout/categoria opzionali — le derivate vengono solo validate; extra ignorate; card di default da form) → categorizzazione → **staging su file** (meccanismo condiviso in `staging.ts`: `DATA_DIR/import-staging/spese/<token>.json`, TTL 1h; un token di un altro dominio viene rifiutato in lettura) → anteprima con: nuove/duplicate/categorizzate per fonte, **conflitti di categoria** (stessa chiave, categoria diversa) con scelta per riga DB/CSV → conferma applica in transazione unica. **Dedup a conteggio**: chiave data+descrizione+card+importo, si inseriscono solo le occorrenze mancanti (doppioni legittimi preservati, reimport idempotente).
- **Round-trip**: export CSV (`/api/expenses/export`) nello stesso formato dell'import (moneyin/moneyout ricalcolate); "Svuota spese" con conferma testuale ELIMINA + backup automatico pre-wipe. Ciclo: export → edit a mano → wipe → reimport.
- **Divisione UI**: `/spese` = consultazione (tiles, grafici, movimenti con categoria inline, export); **/admin** = gestione (import CSV, categorie, regole, card, svuota). Chips dei filtri attivi sopra i grafici con ✕ per filtro e "Mostra tutto"; parametro `anno` esplicito (`?anno=` vuoto = tutti gli anni, altrimenti default = anno più recente).
- **Esclusioni dai totali**: flag "Escludi dai totali" per categoria (chiave `transfer` in `categories-meta.json`) — copre giroconti (`investimenti`, `ignore`) e doppi conteggi (`carte_credito` = totale carta già presente come voci singole). Le voci restano nei movimenti ma spariscono da entrate/uscite/saldo/grafici.
- **Card/conti** (tabella `cards`, come i broker): nome unico = valore del campo `card` nel CSV + logo BLOB (Mastercard/Visa/banca), CRUD in /admin, logo servito da `/api/cards/[id]/logo` e mostrato nei movimenti; eliminazione non tocca le spese (join per nome).
- **Gestione (in /admin)**: pannello categorie (icona da set predefinito `expense-icons.ts`, flag esclusione, **rinomina con propagazione** a DB+categories.json+meta), strumenti regole (test descrizione, retro-applicazione alle unknown con anteprima, **report utilizzo keyword** con match e ultimo utilizzo — per pulizia file).
- **Dashboard** `/spese`: tiles (uscite/entrate mese, saldo YTD, top categoria), barre per anno cliccabili (`InOutBars.svelte`, entrate vs uscite, esclusioni applicate), dettaglio anno per mese, donut uscite per categoria e classifica con Δ vs stesso periodo anno precedente (anche su tutto lo storico). **Home**: riga tile spese (snippet renderizzato sia con che senza investimenti) con link a `/spese`.
- **Backup**: i due file sono fuori dal DB quindi non inclusi nei `.db`. `createBackup()` ne salva una copia **con lo stesso stem del `.db`** (`cunti-<stamp>.categories.json`): versionata 1:1 col backup, non un'unica copia "ultima nota" (che sarebbe sempre quella di adesso, inutile al restore di un backup vecchio). `rotate()`/`deleteBackup()` eliminano anche i json abbinati; `restoreBackup()` li ripristina insieme al `.db`. Backup precedenti a questa funzionalità o caricati a mano → nessun json abbinato, il restore procede comunque sui json attuali.
- **Export investimenti**: `/api/transactions/export` — CSV nello stesso formato dell'import transazioni (round-trip anche lì); bottone in pagina Transazioni.

### Dati demo

`scripts/make-demo-db.js` (npm `demo:db`): genera `DATA_DIR/demo-cunti.db` **separato dall'app** con dati generici (2 ETF EUR, 1 crypto USD, 2 broker con logo SVG, PAC 18 rate, vendita crypto, prezzi e EURUSD sintetici deterministici, date relative a oggi). Se il file esiste chiede conferma (senza TTY: annulla). Nessun seed automatico nel container: per usarlo si copia manualmente come `cunti.db`.

## Calcoli finanziari

- **PMC (prezzo medio di carico)**: media ponderata degli acquisti **commissioni incluse**; le vendite riducono la quantità senza toccare il PMC (metodo del costo medio, coerente col regime amministrato). Posizione azzerata → PMC azzerato.
- **Plusvalenza realizzata** = ricavato netto commissioni − quantità × PMC.
- **Lotti di acquisto (`buildLots`)**: ogni acquisto è un lotto con costo unitario **commissione inclusa**; le vendite consumano i lotti dal più vecchio (**FIFO**), quindi ogni riga porta la quota ancora aperta (`remaining`), il capitale residuo, il valore corrente e il P&L latente, più il realizzato già incassato su quel lotto. La somma dei lotti aperti coincide con `costBasis`/`unrealized` della posizione (verificato dai test). **Scelta deliberata**: la vista per lotto usa FIFO perché "questo acquisto è in guadagno?" ha senso solo su un lotto identificabile, mentre posizione e fisco restano a **costo medio** — i due totali del non realizzato coincidono, il realizzato per singolo lotto no (quello fiscale resta quello della posizione).
- **Serie giornaliera**: dal primo acquisto a oggi; prezzi weekend/festivi carry-forward dell'ultimo noto; transazioni più vecchie dello storico prezzi (crypto, limite 365gg) → backfill col primo prezzo disponibile.
- **TWR**: indice giornaliero `r_t = (V_t − V_{t−1} − F_t) / (V_{t−1} + F_t)` — i rendimenti di periodo non sono distorti dai versamenti del PAC. Baseline di periodo = giorno precedente all'apertura della finestra; se la finestra copre tutta la serie, baseline virtuale a inception (twr=1, valore=0) così il primo giorno è incluso.
- **P&L assoluto di periodo** = ΔValore − flussi netti del periodo.
- **Rendimento annualizzato**: `twr^(1/anni) − 1`, mostrato solo oltre ~3 mesi di storia.
- **Max drawdown / miglior / peggior giorno**: sull'indice TWR e sui rendimenti giornalieri.

## Fisco (stime, non consulenza)

- ETF (regime **amministrato**): 26% sulle plusvalenze, trattenuto dalla banca alla vendita. Aliquota **per strumento** (`tax_rate_pct`, default 26) per gestire ETF con quota titoli di stato whitelist (12,5%). Le **minusvalenze ETF non compensano** le plusvalenze ETF (redditi di capitale): finiscono nella colonna "minusvalenze" senza ridurre l'imposta.
- Crypto (regime **dichiarativo**, exchange estero): aliquota per anno di realizzo — 26% fino al 2025, **33% dal 2026** (L. 207/2024, franchigia 2k abolita dal 2025); gains e losses crypto compensati nello stesso anno; quadri RT/RW a carico dell'utente.
- **Imposte latenti**: aliquota applicata alle plusvalenze non realizzate ("se vendessi tutto oggi").
- **Costi ricorrenti**: bollo 0,2%/anno sul valore ETF, IVAFE 0,2% sul valore crypto, costo TER annuo stimato (`ter_pct × valore`).
- **P&L netto** = lordo − imposte realizzate stimate − imposte latenti.

## Prezzi

- **Yahoo Finance** (ETF `.MI`, EUR): endpoint `v8/finance/chart`, range `max` al primo download, `10d` agli aggiornamenti. Gotcha: User-Agent da browser completo → 429; si usa `Mozilla/5.0` minimale + fallback query1→query2→query1 con pausa 4s sui 429.
- **CoinGecko** (crypto, `vs_currency` = valuta dello strumento): `market_chart`, max **365 giorni** con l'API gratuita.
- Scheduler: refresh all'avvio se più vecchio di 6h, poi ogni 6h; 1,5s di pausa tra strumenti (rate limit); lock anti-sovrapposizione; report in `settings.last_refresh_report`.

## Sicurezza / rete

- Nessuna autenticazione **by design**: solo LAN/VPN.
- `csrf.checkOrigin: false` (svelte.config.js): l'app è raggiunta con hostname/IP diversi e adapter-node richiederebbe un `ORIGIN` fisso. Accettabile solo perché non esposta su internet.

## Test

### Unit test (vitest — `npm test`, eseguiti in CI)

- `src/lib/server/tax.test.ts` (pure, senza DB): aliquota crypto per anno (26/33), imposte latenti al 26% e con aliquota custom 12,5%, nessuna imposta su posizioni in perdita, compensazione gains/losses crypto nello stesso anno, **non**-compensazione minusvalenze ETF, bollo/IVAFE/TER, netProfit = lordo − imposte.
- `src/lib/server/portfolio.test.ts` (DB SQLite isolato in `tmp/test-data`): PMC con commissioni incluse, vendita (plusvalenza vs PMC, PMC invariato), azzeramento posizione, `buildSnapshot` (totali, serie giornaliera, flussi, TWR di periodo, P&L assoluto); conversione USD→EUR (`makeFxConverter`: carry-forward/backfill/identità; `buildPosition`: PMC in USD, aggregati in EUR ai cambi delle date); `buildLots` (un lotto per acquisto con commissione nel carico, consumo FIFO su più lotti con realizzato per lotto, commissione di vendita che riduce il ricavo, somma dei lotti = posizione, lotti esposti nello snapshot col ticker).
- `src/lib/server/backup.test.ts` (DB isolato in `tmp/test-backup`): creazione backup (file valido, `last_backup`), rotazione oltre 10 giorni, validazione nomi (traversal), restore che riporta i dati allo stato del backup, rifiuto di file non-SQLite; **json abbinati**: `createBackup` salva i json con lo stesso stem del `.db`, `restoreBackup` li riporta allo stato *di quel backup* (non all'attuale), restore di un backup senza json abbinato non tocca i json correnti, rotazione/cancellazione eliminano anche i json abbinati.
- `src/lib/server/txcsv.test.ts` (puro): separatori `;`/`,`, decimali it/US con migliaia, date ISO e italiane, header con accenti/maiuscole, campi quotati, BOM, errori riga per riga (data/strumento/tipo/quantità/prezzo/broker invalidi, date future), colonne obbligatorie mancanti, file vuoto; **ISIN**: risoluzione dal solo ISIN, coerenza ISIN+simbolo, discordanza e ISIN sconosciuto, riga senza identificativo, ISIN ambiguo su più strumenti, intestazione senza né `strumento` né `isin`.
- `src/lib/server/tximport.test.ts` (DB isolato in `tmp/test-import`): dedup contro il DB (reimport idempotente), dedup dei doppioni interni al batch, ogni campo chiave rende unica la riga, note/broker diversi non evitano il dedup.
- `src/lib/server/transactions.test.ts` (DB isolato in `tmp/test-transactions`): staging che non scrive sul DB, ticker/valuta/broker risolti in anteprima, doppioni interni al file contati, anteprima troncata ma staging completo, conferma che inserisce e consuma il token, reimport idempotente, ri-dedup se il DB cambia tra anteprima e conferma, annulla, token inesistente e **token di dominio sbagliato** (spese↔transazioni) → `null`, export round-trip, wipe che cancella tutto e lascia intatti strumenti/prezzi/broker creando un backup.
- `src/lib/server/staging.test.ts` (DATA_DIR isolata in `tmp/test-staging`): round-trip write/read nella sottocartella del dominio, isolamento fra domini, token malformati (vuoto, corto, traversal) che non lanciano e non escono dalla cartella, token ben formato inesistente, discard idempotente, pulizia pigra che elimina gli scaduti e risparmia i validi, raccolta dei file sciolti del vecchio layout.
- `src/lib/server/expensecsv.test.ts` (puro): formato storico completo, formato grezzo minimo, header `data`, colonne extra ignorate, categoria vuota/unknown→null, incoerenza moneyin/moneyout, errori riga per riga, header senza colonne obbligatorie.
- `src/lib/server/expenses.test.ts` (DB isolato in `tmp/test-expenses`): motore regole (longest-match case-insensitive, keyword regex sospette, json malformato, card default, categoria CSV che vince), import due fasi (nuovo→conferma, reimport idempotente, dedup a conteggio con terza occorrenza, conflitto risolto CSV e DB, token inesistente), export round-trip (reimport = tutto duplicato), wipe con backup + ripristino da reimport.

### Verifiche end-to-end svolte in sviluppo (2026-07-05)

- `svelte-check`: 0 errori, 0 warning; autofixer Svelte MCP pulito.
- Server di produzione con dati demo: tutte le route 200; create/delete transazione via form actions; coerenza numeri DB ↔ dashboard.
- Fetch prezzi reali riusciti (SWDA.MI, VNGA80.MI, bitcoin).
- Screenshot ispezionati (dashboard, transazioni, posizione): corretti 2 difetti (overflow form, etichetta asse troncata).
- Immagine Podman buildata e smoke test 200 sul container.

## CI/CD

`.github/workflows/ci.yml`:

- push su `main` / PR → job `test` (svelte-check, vitest, build) + job `image` in sola verifica (build senza push).
- push tag `v*` → test + build + **push su ghcr.io** (`<version>`, `<major>.<minor>`, `latest`), login con `GITHUB_TOKEN`.

Deploy: Podman Quadlet con `AutoUpdate=registry` (vedi README).

## Roadmap

- **Panoramica unificata**: home mista portafoglio+spese, dashboard investimenti spostata in `/investimenti` (design in PLAN_SPESE.md § "Panoramica unificata"); da fare dopo il collaudo con lo storico spese reale.
- **Spese — rifiniture (M4)**: editor in-app di `categories.json`, budget mensile per categoria, note su movimento, azioni bulk sulla lista movimenti (piano in PLAN_SPESE.md).

## Changelog

### 2026-10-04 — Transazioni alla pari delle spese: import a due fasi in /admin, svuotamento, scelta per ticker
- **Svuota transazioni** (`/admin`, «Transazioni: svuota»): `wipeTransactions()` con backup automatico **prima** del `DELETE`, conferma scritta `ELIMINA` + `confirm()` nativo + guardia server, calco di `wipeExpenses`. Tocca solo `transactions`: strumenti, prezzi, cambi e broker restano (servono al reimport e sono costosi da ricostruire). Completa il ciclo **export → edit → svuota → reimporta** anche per gli investimenti, che prima esisteva solo per le spese.
- **Import CSV transazioni a due fasi, spostato in `/admin`**: prima scriveva subito dalla pagina `/transactions`. Ora `importTransactions` mette in staging e mostra un'anteprima (righe nuove, già presenti con i numeri di riga, tabella delle operazioni che entrerebbero troncata a 50), e solo `Conferma import` scrive; `Annulla` scarta. La conferma passa da `insertTransactionsDedup`, quindi ri-deduplica se il DB è cambiato dopo l'anteprima e riporta i numeri reali. Nessuna tabella di conflitti: a differenza delle spese il dedup qui è binario. Rimossa l'action `import` e la sezione «Importa da CSV» da `/transactions`, che resta inserimento manuale + storico + export, con un rimando all'Amministrazione.
- **Scelta strumento per ticker**: i menu di nuova operazione e modifica inline mostrano solo il simbolo (nome completo nel `title`), ordinati per ticker; `allInstruments()` resta ordinato per nome per il resto dell'app.
- **Staging condiviso** (`staging.ts`): il meccanismo (token UUID, TTL 1h, write/read/discard, pulizia pigra) era dentro `expenses.ts`. Estratto e **indicizzato per dominio** (`import-staging/<spese|transazioni>/`), così che il sweeper di un dominio non elimini i token in volo dell'altro e un token non sia applicabile dal dominio sbagliato. Firme pubbliche di `expenses.ts` invariate: `expenses.test.ts` è passato senza modifiche, che era la rete di sicurezza del refactor. Nota: un import spese *in volo* al momento del deploy va ricaricato (vedrà «Import scaduto»); i file del vecchio layout piatto vengono raccolti dalla pulizia.
- **Export transazioni testabile**: query e serializzazione spostate da `api/transactions/export/+server.ts` a `exportTransactionsCsv()` in `transactions.ts` (la route è ora un wrapper sottile come quella delle spese). Formato CSV **invariato**, round-trip verificato da test.
- Verifiche: `svelte-check` 0 errori/0 warning, build ok, **79 unit test verdi** (18 nuovi tra `transactions.test.ts` e `staging.test.ts`). Smoke test HTTP su DB demo (41 transazioni): reimport dell'export → 0 nuove / 41 duplicate; CSV misto → anteprima 1 nuova / 1 saltata, `Annulla` non scrive, token consumato rifiutato, `Conferma` inserisce esattamente 1 riga coi valori attesi; wipe senza `ELIMINA` rifiutato, con `ELIMINA` 42 transazioni eliminate con backup creato e strumenti/prezzi/broker intatti; dashboard, `/transactions`, `/admin` e `/positions/1` a 200 con zero transazioni (onboarding mostrato); reimport finale che ripristina le 41 operazioni.

### 2026-10-03 — Fix: i json delle spese ora sono versionati per backup, non più un'unica copia sovrascritta
- **Bug trovato in review del piano** (PLAN_SPESE.md): `categories.json`/`categories-meta.json` venivano copiati in `backups/` con **nome fisso**, sovrascritto a ogni `createBackup()` — quindi la copia era sempre quella di *adesso*, mai quella di un backup passato. Ripristinare un `.db` vecchio non riportava indietro i json: restavano quelli correnti, fuori sincrono con le categorie/meta del DB appena ripristinato (categoria rinominata nel frattempo, flag giroconto cambiato, ecc.).
- **Fix** in `backup.ts`: i json vengono ora salvati con **lo stesso stem del `.db`** (`cunti-<stamp>.categories.json`), quindi 1:1 con ogni backup. `rotate()` e `deleteBackup()` eliminano anche i json abbinati; `restoreBackup()` li ripristina insieme alle tabelle. Backup precedenti al fix (o `.db` caricati a mano) non hanno json abbinato: il restore delle tabelle procede comunque, i json restano quelli attuali — nessuna regressione, solo nessun recupero json su quei backup specifici.
- **PLAN_SPESE.md**: risolta anche un'incoerenza di stato — "copia dei json accanto ai backup" era segnata sia fatta (Extra) sia da fare (M4) sia come mitigazione ancora da valutare (nota Attenzione); ora un solo paragrafo "Backup dei json" con lo stato reale. Aggiunta ai Da fare la pulizia delle 4 keyword in sintassi regex mai matchate in `categories.json` (già identificate nel piano ma non tracciate).
- Verifiche: `svelte-check` 0 errori/0 warning, 61 unit test verdi (4 nuovi su rotazione/restore/cancellazione dei json abbinati).

### 2026-09-06 — Ticker ovunque, ISIN nell'import, lotti di acquisto, barra laterale collassabile
- **Ticker nel nome dello strumento**: tabelle posizioni e transazioni, legenda e centro del donut, titolo e intestazione del dettaglio posizione, select di modifica transazione, etichette dei marker sul grafico. Stile condiviso `.ticker` in `app.css`; helper testuale `instrumentLabel()` in `lib/format.ts`. Nella riga transazione il ticker porta l'ISIN in `title`.
- **ISIN nel CSV di import**: nuova colonna opzionale `isin`; `strumento` non è più obbligatoria di per sé, ne basta una delle due. ISIN prevalente sul simbolo, errore se i due indicano strumenti diversi o se l'ISIN è sconosciuto/ambiguo. Export CSV allineato (colonna `isin` in seconda posizione) per il round-trip.
- **Spaccato dei singoli acquisti**: nuovo motore `buildLots` (lotti con consumo FIFO delle vendite) e componente `LotsTable.svelte`, con filtro aperte/chiuse/tutte, ordinamento per data o risultato e riga totali. Mostrato in dashboard sotto "Posizioni" (con strumento+ticker) e nel dettaglio posizione (senza colonna strumento). Scelta: tabella dedicata invece che colonne in più nello storico transazioni — lo storico resta il registro delle operazioni (anche le vendite), i lotti sono la vista "questo acquisto è in guadagno?".
- **Barra laterale collassabile**: burger che riduce la barra a sole icone su desktop (preferenza in `localStorage`) e apre il drawer sotto i 900px, con scrim, `Esc` e chiusura al cambio pagina.
- **Marker operazioni più leggibili**: triangoli verso l'alto (acquisto) e verso il basso (vendita) con trattino di aggancio al punto della serie invece dei pallini sovrapposti, e filtro impostato su "Tutte" di default (prima era "Nessuna", quindi di fatto invisibile).
- Verifiche: `svelte-check` 0 errori/0 warning, build ok, 56 unit test verdi (13 nuovi tra ISIN e lotti). Smoke test SSR su DB demo: dashboard/transazioni/dettaglio posizione 200 con ticker e tabella lotti; import di un CSV con solo ISIN inserito e reimport correttamente deduplicato. Nota: `backup.test.ts > restore` è al limite del timeout di 5s (fallito su una macchina sotto carico, verde da solo) — è lento per `db.backup()` + checkpoint WAL, non per il codice modificato qui.

### 2026-09-06 — Log più verbosi (access log + eventi mancanti)
- **Access log** (`hooks.server.ts`, scope `http`): un rigo per richiesta (metodo, path+query, status, durata ms). Gli asset statici non passano da `handle` (serviti da adapter-node prima), quindi restano fuori.
- **Startup** (scope `server`): log di `DATA_DIR`/`PORT` all'avvio, prima degli scheduler.
- **Backup** (scope `backup`, prima quasi muto): scheduler avviato (ultimo backup), creazione (nome+dimensione), restore (avvio+fine), eliminazione, upload; fallimenti di backup/restore/delete dalle action di `/admin` ora loggati con `logError` (prima solo `fail()` verso la UI, niente in `podman logs`); rimosso `console.error` grezzo nello scheduler a favore di `logError`.
- Verifiche: `svelte-check` 0 errori/0 warning, 48 unit test verdi.

### 2026-09-06 — Fix Quadlet: healthcheck esplicito nell'unit
- **Bug**: `Notify=healthy` nel Quadlet falliva con `invalid argument: sdnotify policy "healthy" requires a healthcheck to be set` — l'healthcheck del Containerfile da solo non basta perché Quadlet valuta l'healthcheck alla creazione del container, non quello ereditato dall'immagine (es. tag `latest` pull-ato prima dell'aggiunta dell'HEALTHCHECK).
- **Fix**: aggiunti `HealthCmd`/`HealthInterval`/`HealthTimeout`/`HealthStartPeriod`/`HealthRetries` direttamente nello snippet Quadlet in README, stessa CMD del Containerfile.

### 2026-07-07 — Decisione: panoramica unificata
- Registrato in PLAN_SPESE.md il design della **panoramica unificata** (home mista portafoglio+spese, dashboard investimenti → `/investimenti`) e lo stato fatto/da fare del piano spese; roadmap allineata (panoramica, M4, collaudo storico reale, squash pre-push).

### 2026-07-06 — Spese: esclusioni, card con logo, gestione in admin, chips filtri
- **Esclusioni dai totali**: il flag per categoria (già `transfer` nel meta) ora è esposto come "Escludi dai totali" e copre giroconti (`investimenti`, `ignore`) e doppi conteggi (`carte_credito`); verificato e2e (saldo ignora le categorie flaggate).
- **Card/conti con logo**: nuova tabella `cards` (nome = valore CSV, logo BLOB come i broker), CRUD in /admin, endpoint `/api/cards/[id]/logo`, logo accanto alla card nei movimenti.
- **Riorganizzazione**: import CSV, categorie, regole e svuota spostati da /spese ad **/admin** (sezioni "Spese: …"); /spese resta consultazione (tiles, grafici, movimenti, export) con link "Gestione →".
- **Filtri**: chips dei filtri attivi sopra i grafici (✕ per singolo filtro, "Mostra tutto"); `?anno=` vuoto esplicito = tutti gli anni; donut/classifica categorie visibili anche senza anno selezionato (tutto lo storico).
- **Privacy repo**: sanificati PLAN_SPESE.md e `expensecsv.test.ts` (importi stipendio realistici → fittizi, rimossi codici carta e riferimenti nominali).
- Verifiche: svelte-check 0 errori/0 warning, 48 test verdi, e2e (import via admin, flag esclusione via meta file, card con logo servito, chips renderizzate, saldo con esclusioni corretto).

### 2026-07-06 — Sezione Spese (M1–M3) + export/import allineati
- **Spese**: implementate M1–M3 del piano — tabella `expenses`, parser CSV bancario, regole keyword da `categories.json` (file di testo, semantica dello script Python storico), import a due fasi con anteprima e diff dei conflitti di categoria, dedup a conteggio, lista movimenti con filtri e categoria inline, pannello categorie (icone SVG, giroconto, rinomina con propagazione), test regole + retro-applicazione + report utilizzo keyword, dashboard (tiles, barre per anno/mese cliccabili, donut e classifica con Δ anno precedente), riga tile spese in home, nav attivata.
- **Export/import allineati**: export CSV round-trip per spese (`/api/expenses/export`) e per transazioni investimenti (`/api/transactions/export`, bottone in pagina); "Svuota spese" con backup automatico per il ciclo export→edit→wipe→reimport.
- **Backup**: i backup ora salvano anche l'ultima copia di `categories.json`/`categories-meta.json` in `backups/`.
- Nuovi componenti: `InOutBars.svelte` (entrate/uscite generico, cliccabile), `CategoryIcon.svelte` + set icone `expense-icons.ts`.
- Verifiche: svelte-check 0 errori 0 warning, **48 unit test verdi** (20 nuovi per spese), e2e completo su server dev (import storico con categorie → conferma; import grezzo con card di default → regole applicate; conflitto categoria risolto "usa CSV"; rename con propagazione; setMeta su file; export round-trip; wipe con backup e json copiati; tiles in home anche senza investimenti; filtri anno/mese).

### 2026-07-06 — Icone tipo, riordino admin, piano Spese
- **Transazioni**: icona colorata del tipo strumento accanto al nome (linea di trend blu = ETF, moneta viola = crypto), colori coerenti con i badge esistenti.
- **Admin riordinato**: Strumenti → Broker (anagrafiche) → Ultimo aggiornamento prezzi (diagnostica) → Backup (manutenzione, in fondo).
- **PLAN_SPESE.md**: piano della sezione Spese (decisione Cunti vs Grafana/Metabase, schema, import con dedup a conteggio, dashboard, milestone M1–M4). Rivisto due volte in giornata dopo analisi del flusso reale (script `categ.py` + `cat.json`): Cunti ingerisce il CSV pre-script (moneyin/moneyout/categoria opzionali e derivati); le regole keyword restano su **file di testo** `DATA_DIR/categories.json` (stesso formato attuale, fonte di verità, riletto a ogni import) con la stessa semantica dello script (substring case-insensitive, longest-match); la UI aggiunge validazione, report utilizzo keyword e test. Lo script Python non va ricreato. Terza revisione: import a due fasi con anteprima e diff dei conflitti di categoria, export CSV round-trip + "svuota spese" con backup per la modifica di massa via editor, icone/colore/flag giroconto per categoria in `categories-meta.json` gestito da UI, rinomina categoria con propagazione.
- Verifiche: svelte-check 0 errori, 28 test verdi, e2e con dati demo (icone renderizzate 36 etf + 5 crypto, ordine sezioni admin corretto).

### 2026-07-06 — Strumenti dentro Amministrazione
- Pagina `/instruments` eliminata: gestione strumenti (form di creazione, tabella con TER/aliquota inline, eliminazione con doppia conferma) spostata come prima sezione di `/admin`; azioni rinominate `createInstrument`/`updateInstrument`/`deleteInstrument` con messaggi per sezione come backup/broker.
- `/instruments` risponde 301 → `/admin` (bookmark); voce "Strumenti" rimossa dalla nav; link di onboarding (dashboard e transazioni) puntano a `/admin`.
- Verifiche: svelte-check 0 errori, 28 test verdi, e2e (redirect 301, sezione presente, create con ticker inesistente → warning, update, delete).

### 2026-07-06 — Dedup import, guardia delete strumento, logging
- **Import CSV con deduplica** (sostituisce l'append cieco): righe identiche a transazioni esistenti (strumento+tipo+data+quantità+prezzo+commissioni) saltate e segnalate con numero di riga; dedup anche dei doppioni interni al file; reimport idempotente. Helper `insertTransactionsDedup` in db.ts + 4 unit test dedicati (`tximport.test.ts`).
- **Eliminazione strumento**: doppia conferma client (la seconda esplicita: "verranno eliminate anche le N transazioni") + guardia server (400 senza `force=1` se esistono transazioni).
- **Logging**: nuovo `lib/server/log.ts` (timestamp ISO + scope); log su refresh prezzi (per simbolo, errori ticker inesistenti), import CSV, creazione/eliminazione strumenti. Sezione "Ultimo aggiornamento prezzi" in `/admin` con il report per simbolo. Lettura log: `journalctl --user -u cunti.service -f` / `podman logs -f cunti` / terminale dev.
- Verifiche: svelte-check 0 errori, 28 unit test verdi, autofixer pulito, e2e (doppio import stesso CSV → 0 nuove righe, delete senza force → 400, con force → cascata, log presenti, sezione admin visibile).

### 2026-07-06 — Full width, import CSV, modifica inline, aliquota solo ETF
- **Layout full width**: rimosso `max-width: 1280px` dal `<main>` del layout; tutte le pagine occupano l'intera larghezza.
- **Transazioni**: import CSV in append (parser `txcsv.ts` + action `import`, tutto-o-niente con errori per riga), modifica inline di ogni riga (form esterno + attributo `form`), tasto duplica che apre subito la copia in modifica. Refactor validazione in `readTxForm()` condivisa tra create/update.
- **Strumenti**: TER e aliquota editabili solo sulle righe ETF; per le crypto la cella aliquota mostra "auto" (l'aliquota crypto è per anno di realizzo in `tax.ts` e ignora `tax_rate_pct`). Il campo resta per gli ETF perché serve al caso whitelist titoli di stato (12,5%) — non derivabile dal tipo.
- Verifiche: autofixer Svelte pulito, svelte-check 0 errori, 24 unit test verdi (6 nuovi per il CSV), e2e su server dev (import 200 con 2 righe inserite, update con decimali a virgola, duplicate identico, CSV con errore → 400 e zero righe importate).

### 2026-07-05 — v0.1, build iniziale
- App completa: strumenti, transazioni, dashboard, dettaglio posizione, fisco, refresh prezzi automatico/manuale, design dark custom, seed demo.
- Decisioni utente: auto-fetch prezzi; SvelteKit full-stack; regime amministrato ETF; tracking completo buy/sell anche per crypto.

### 2026-07-05 — CI/CD e Quadlet
- Rimosso `compose.yaml`: il riferimento Podman è **sempre Quadlet**.
- Aggiunto workflow GitHub Actions: test su main/PR, publish su ghcr.io solo su tag `v*`.
- Aggiunti unit test vitest (fisco + motore portfolio); **bugfix** scoperto dai test: baseline del periodo MAX escludeva il rendimento del primo giorno.
- `.gitignore` blindato per repo pubblico (dati, DB, log, screenshot, `.claude/` con path personali).
- README riscritto: podman run singolo, Quadlet per Rocky Linux/systemd, processo di publish.
- Creato questo documento.

### 2026-07-05 — Rinomina in "Cunti"
- Nome del tool: **Cunti** (dal siciliano "conti"), in vista del repository GitHub omonimo. Rinominati package, titoli pagine, logo, database (`cunti.db`), volume (`cunti-data`), unit Quadlet (`cunti.container`) e ogni riferimento in README/docs.
- Aggiunta cartella `claude-home/` (fuori da git): staging delle regole globali Claude Code da copiare in `~/.claude/` — CLAUDE.md, skill `ghcr-ci`, skill `implementation-doc` (regola: questo file va tenuto aggiornato in ogni progetto).

### 2026-07-05 — Seed demo automatico nel container
- Nuovo `entrypoint.sh` (sostituisce il `CMD` diretto nel Containerfile): al primo avvio senza DB genera i dati demo con `scripts/seed-demo.js`, ora copiato anche nell'immagine runtime; DB esistente mai toccato; opt-out con `SEED_DEMO=0`.
- Verifiche locali: seed in DB pulito (3 strumenti, 41 transazioni, ~2200 prezzi), server 200 dopo seed, riavvio con DB esistente senza seed, avvio con `SEED_DEMO=0` senza dati demo.
- README aggiornato (comportamento primo avvio e opt-out per il deploy reale).
- Rinominato `docker-entrypoint.sh` → `entrypoint.sh` (nessun legame con Docker; `.dockerignore` resta: è il nome letto sia da Podman/Buildah sia da BuildKit in CI).

### 2026-07-05 — Ristrutturazione README
- Sezione "Esecuzione con Podman" → **"Installazione"**, subito dopo Funzionalità, con sottoparagrafi Podman Quadlet (consigliato, ora con `SEED_DEMO=0` nell'esempio), Podman run, Locale con npm (senza container).
- Sezione Sviluppo riscritta: nuovo paragrafo **"Dati demo"** che descrive cosa genera `scripts/seed-demo.js` e come viene usato (entrypoint container vs sviluppo con `DATA_DIR` separato); publish/release e build locale immagine spostati in "Immagine container e release" sotto Sviluppo.

### 2026-07-05 — Porta 3030
- Porta default cambiata da 3000 a 3030 (`ENV PORT` nel Containerfile, `EXPOSE`, README: esempi Quadlet/podman run/locale, firewall-cmd).

### 2026-07-05 — Amministrazione, backup, broker, USD, marker, healthcheck
- **Backup/restore**: motore `backup.ts` (online backup API, rotazione 10gg, scheduler ≥1/giorno con controllo orario), pannello `/admin` (manuale, download, upload, ripristino con backup di sicurezza preventivo), endpoint download; unit test dedicati.
- **Broker**: tabella `brokers` con logo BLOB, `transactions.broker_id` (migrazione additiva su DB esistenti), CRUD in `/admin`, select nel form transazioni, logo in tabella via `/api/brokers/[id]/logo`.
- **Valute**: `currency` per strumento (EUR/USD), serie `fx_rates` EURUSD da Yahoo, conversione in EUR nel motore (PMC doppio: valuta display + EUR fiscale); `fmtCurrency` it-IT. Locale numeri invariato (it-IT ovunque).
- **Grafico**: marker acquisti/vendite sul grafico del portafoglio, filtro Nessuna/ETF/Crypto/Tutte, tooltip nativo con elenco operazioni del giorno, legenda.
- **Healthcheck**: `/api/health` + `HEALTHCHECK` nel Containerfile; `Notify=healthy` nel Quadlet (README).
- **Demo**: rimossi seed automatico ed entrypoint; nuovo `scripts/make-demo-db.js` (npm `demo:db`) che genera `demo-cunti.db` con conferma di sovrascrittura, uso manuale.
- Verifiche: svelte-check 0 errori, 18 unit test verdi, e2e locale (route 200, backup automatico allo start, backup/restore/download via form actions, broker con logo via upload, transazione con broker, guard traversal 404, doppia esecuzione demo script rifiutata senza TTY).

### 2026-07-05 — Repo definitivo
- Placeholder `OWNER/REPO` sostituiti con `purpleturtle73/cunti` in README (immagine ghcr, Quadlet, podman run). Il workflow CI usa già `${{ github.repository }}`, nessuna modifica necessaria lì.

### 2026-07-05 — Fix CI: svelte-check falliva su GitHub Actions
- Causa: `.svelte-kit/` è generato (gitignored) e in locale esisteva già da build precedenti; in CI, checkout pulito → `tsconfig.json` estende `./.svelte-kit/tsconfig.json` inesistente → `svelte-check` falliva subito (`Cannot read file`).
- Fix: aggiunto script `prepare: svelte-kit sync` in `package.json` — `npm ci` lo esegue in automatico (hook npm standard) e rigenera `.svelte-kit/` prima di `npm run check`. Verificato in locale: `rm -rf .svelte-kit && npm ci` rigenera il file, `npm run check` → 0 errori.
