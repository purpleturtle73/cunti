# PLAN — Sezione Spese

Questo documento resta come riferimento delle decisioni di design. Stato sintetico qui sotto; dettagli implementativi nella sezione "Spese" di IMPLEMENTATION.md.

## Stato (aggiornato 2026-07-07)

### Fatto

- [x] **M1 — Dati**: tabella `expenses`, parser `expensecsv.ts` (colonne derivate opzionali, extra ignorate), motore regole su `categories.json` (semantica script Python: substring case-insensitive, longest-match), dedup a conteggio, import a due fasi con staging+anteprima+conferma, card di default per upload, 20 unit test.
- [x] **M2 — Gestione**: movimenti con filtri/ricerca e categoria inline, pannello categorie (icone, **"Escludi dai totali"** per giroconti/doppi conteggi tipo `investimenti`/`ignore`/`carte_credito`, rinomina con propagazione DB+json+meta), regole (test descrizione, retro-applicazione unknown con anteprima, report utilizzo keyword), export CSV round-trip, svuota con backup automatico.
- [x] **M3 — Dashboard**: tiles, barre per anno/mese cliccabili, donut + classifica categorie con Δ anno precedente, riga tile spese in home, chips filtri attivi con ✕ e "Mostra tutto".
- [x] **Extra oltre il piano**: gestione **card/conti con logo** (tabella `cards` stile broker, logo in movimenti); sezioni di gestione spostate in /admin (import, categorie, regole, card, svuota — /spese è solo consultazione); export CSV round-trip anche per le transazioni investimenti; copia dei json **versionata per backup** (stesso stem del `.db`: ruotata e ripristinata insieme — vedi "Backup dei json", 2026-10-03); sanificazione dati personali nel repo.

### Da fare

- [ ] **Panoramica unificata** (sotto, decisa 2026-07-07): home mista portafoglio+spese, dashboard investimenti in `/investimenti`.
- [ ] **M4 — Rifiniture**: editor in-app di `categories.json`, budget mensile per categoria, note su movimento, azioni bulk sulla lista movimenti.
- [ ] Collaudo con lo storico reale (10 anni, 4 banche) + pulizia `categories.json` guidata dal report keyword.
- [ ] **Pulizia keyword morte in `categories.json`**: 4 keyword in sintassi regex mai matchate dallo script originale (substring letterale, non regex) — `PV[0-9][0-9][0-9][0-9]`, `sushi(mi)?`, `supermercat[io]`, `DECO['']?` (vedi "Categorizzazione" sotto). Da riscrivere come substring semplici o rimuovere; il report utilizzo keyword (già in M2) le segnala a zero match.

## Panoramica unificata (da fare)

Decisione 2026-07-07: home = **panoramica mista** portafoglio+spese, con due sezioni dedicate.

- **Panoramica** (`/`): hero doppio (valore portafoglio + P&L | saldo entrate−uscite anno), riga tile investimenti compatta (investito, rendimento, drawdown), riga tile spese attuale, due grafici affiancati — area portafoglio ridotta (senza marker/periodi) e barre entrate/uscite anno corrente. Ogni blocco cliccabile verso la sezione.
- **Investimenti** (`/investimenti`): l'attuale dashboard di home spostata intera (hero, grafico con marker, pill periodi, tiles, fisco, posizioni); redirect da `/` ai bookmark non serve (la home resta), niente route legacy.
- **Spese** (`/spese`): invariata.
- Nav: Panoramica / Investimenti / Transazioni / Spese / Amministrazione.
- Onboarding: se manca uno dei due mondi la panoramica mostra l'altro + invito a configurare il mancante.
- **Limite noto**: niente net worth vero — le spese tracciano flussi, non saldi di conto; la panoramica mostra valore portafoglio + flussi. Il net worth richiederebbe il tracking dei saldi (fuori scope).
- Timing consigliato: dopo il collaudo con lo storico reale, per tarare la panoramica su dati veri.

## Decisione: Cunti vs Grafana/Metabase

**Raccomandazione: implementare in Cunti.** Motivi:

- Il lavoro vero non è la visualizzazione ma la **pipeline**: import CSV ripetibile, deduplica, correzione/normalizzazione categorie. Grafana e Metabase non la fanno — servirebbe comunque ETL custom + un DB da qualche parte. A quel punto la parte restante (grafici) è quella che Cunti fa già bene.
- **Infrastruttura zero**: SQLite già presente, backup/restore già copre le nuove tabelle gratis, stesso container, stesso design.
- Pattern già rodati e riusabili quasi 1:1: parser CSV (`txcsv.ts`), dedup (`insertTransactionsDedup`), form actions, componenti grafici (`Bars`, `Donut`, `AreaChart`, `StatTile`).
- Dashboard **curata** per l'uso quotidiano batte l'esplorazione ad-hoc; per query estemporanee il DB resta un file SQLite apribile con qualunque tool (incluso Metabase in sola lettura, se un giorno serve).

Contro (accettati): meno flessibilità di slicing ad-hoc rispetto a Metabase; ogni nuova vista è codice.

## Pipeline attuale (da sostituire)

Oggi: export banca → CSV sistemato a mano → **script Python** che (a) aggiunge `categoria` con keyword matching sulla descrizione, dizionario in `categories.json`; (b) ricava `moneyin`/`moneyout` dal segno di `importo`. Il CSV finale viene poi guardato altrove.

Osservazione chiave: `moneyin`/`moneyout` e `categoria` sono **colonne derivate** — le calcola lo script, non la banca. Quindi Cunti può ingerire il CSV *prima* dello script e fare da sé entrambe le cose: lo step Python sparisce.

## Formato CSV sorgente

```
data_ops;descrizione;card;importo;moneyin;moneyout;categoria
31/01/2026;Stazione di Servizio  Pagamento Con Carta Di Debito;conto;-37.94;0;37.94;spese_auto
30/01/2026;"Stipendi E Pensioni Da: Azienda S.r.l""";conto;1234.56;1234.56;0;stipendio
```

- Separatore `;`, quoting con `""`, date `DD/MM/YYYY`, decimali col punto.
- Colonne **obbligatorie**: `data_ops`, `descrizione`, `importo`. `importo` firmato (negativo = uscita).
- `card` **opzionale**: se manca la colonna (o il valore), vale la "card di default" scelta nel form di upload — utile caricando l'export grezzo di ciascuna delle 4 banche separatamente. Fallback finale: `conto`.
- `moneyin`/`moneyout` **opzionali** (derivati dal segno di `importo`): se presenti vengono solo validati (importo = moneyin − moneyout, tolleranza centesimi) con segnalazione righe incoerenti; mai richiesti.
- `categoria` **opzionale**: se presente e ≠ `unknown` vince sempre (retro-compatibilità con lo storico già categorizzato); se assente o `unknown` → regole (sotto).
- Colonne extra (es. `data_valuta`) ignorate senza errore.
- ~10 anni di storico: import iniziale da uno o più file già categorizzati, poi export banca quasi grezzi in append.

## Schema DB (nuove tabelle)

```sql
expenses (
  id INTEGER PK,
  date TEXT NOT NULL,        -- YYYY-MM-DD
  description TEXT NOT NULL,
  card TEXT NOT NULL,        -- conto/carta di provenienza (dimensione filtrabile)
  amount REAL NOT NULL,      -- firmato: <0 uscita, >0 entrata
  category TEXT NOT NULL     -- stringa libera (es. spese_auto, unknown)
)
-- indici: (date), (category, date), (card, date)

```

- **Una sola tabella**: le spese. Tutto il resto è su file di testo in `DATA_DIR` (decisione: mantenere la libertà di editing manuale):
  - `categories.json` — regole keyword, formato attuale invariato (vedi Categorizzazione);
  - `categories-meta.json` — proprietà per categoria: `{ "spese_auto": { "icon": "car", "color": "#…", "transfer": false } }`. Gestito **dalla UI** (icona, colore, flag giroconto) ma resta json editabile a mano. Categorie senza meta → icona fallback (iniziale), colore deterministico dal nome.
- **Categorie libere**: nessuna tabella anagrafica — la categoria è una stringa sulle voci; `categories-meta.json` decora, non vincola.
- **Icone categoria**: set curato di icone SVG inline predefinite (auto, casa, cibo, salute, viaggi, stipendio, banca, shopping, …) assegnabili da UI; mostrate in lista movimenti e nei grafici/legende.
- **Trasferimenti**: le categorie con `transfer: true` nel meta file vengono escluse da entrate/uscite dei totali — un giroconto tra conti propri non è né spesa né guadagno. Entrate = amount > 0 non-transfer (es. stipendio); uscite = amount < 0 non-transfer. Nota: nel `cat.json` attuale i giroconti stanno dentro `investimenti` (keyword GIROCONTO, ETORO, BBVA…) — probabilmente da marcare interamente come transfer, o da spezzare.

## Import CSV con deduplica

- Parser dedicato `expensecsv.ts` (puro, testabile) riusando le tecniche di `txcsv.ts`: autodetect separatore, quoting, BOM, date it/ISO, numeri con punto o virgola.
- **Dedup a conteggio** (diverso dalle transazioni investimenti): la chiave `data + descrizione + card + importo` può ripetersi legittimamente (due caffè identici nello stesso giorno). Regola: per ogni chiave si contano le occorrenze nel file e nel DB e si inseriscono solo le mancanti (`file_count − db_count` se positivo). Risultato: reimport dello stesso file **idempotente**, doppioni reali preservati, sovrapposizioni tra export consecutivi assorbite.
- **Import in due fasi con anteprima (diff)**: l'upload non scrive subito. Il file parsato finisce in staging (file temporaneo in `DATA_DIR` con token) e la UI mostra: *nuove* (n), *duplicati esatti saltati* (n), e i **conflitti di categoria** — stessa chiave dedup ma categoria diversa da quella nel DB — in una tabella di diff `voce | categoria nel DB → categoria nel CSV` con scelta per riga (mantieni DB / usa CSV) e azioni rapide "tutte DB"/"tutte CSV". Conferma → applica: inserisce le nuove e aggiorna le categorie scelte; annulla → staging eliminato. Nessun cambio al DB prima della conferma.
- Righe con errori di formato → report riga per riga, import bloccato (come investimenti).
- Categorie nuove incontrate nel file: entrano così come sono, segnalate nell'anteprima.

## Categorizzazione (regole su file di testo)

**Decisione: il file di testo resta la fonte di verità.** `DATA_DIR/categories.json`, **stesso formato attuale** `{ "categoria": ["keyword", …] }` — il file di oggi si copia lì così com'è (dopo pulizia), niente seed né migrazione. Editabile a mano come sempre; Cunti lo **rilegge a ogni import** (nessun riavvio).

Semantica di match — replica esatta dello script `categ.py`:

- substring **case-insensitive** sulla descrizione;
- se più keyword matchano, vince la **più lunga** (a parità: prima nell'ordine del file);
- applicata solo a righe con categoria assente o `unknown`; la categoria esplicita del CSV vince sempre;
- nessun match → `unknown`.

Attorno al file, la UI aggiunge (senza sostituirlo):

- **Validazione al caricamento**: JSON malformato → errore chiaro; keyword con metacaratteri regex segnalate come sospette — nel file attuale `PV[0-9][0-9][0-9][0-9]`, `sushi(mi)?`, `supermercat[io]`, `DECO[']?` **non hanno mai matchato** (lo script fa substring letterale, non regex): da pulire o riscrivere come substring semplici.
- **Report utilizzo keyword** (per la pulizia che vuoi fare): per ogni keyword, quante voci del DB matcherebbe e data dell'ultimo match — le keyword a zero match o ferme a 5+ anni fa sono candidate alla rimozione.
- **Test**: incolli una descrizione e vedi quale keyword/categoria vincerebbe.
- **Editor in-app opzionale** (M4): textarea che legge/scrive lo stesso file — comodo dal container, ma resta testo: puoi continuare con il tuo editor.
- Correzione puntuale della categoria di una voce → inline dalla lista movimenti; il suggerimento "aggiungi keyword al file" mostra la riga JSON da incollare (il file resta tuo).
- Regole applicabili **retroattivamente** alle voci `unknown` esistenti, con anteprima (utile dopo aver aggiunto keyword).

L'esito dell'import riporta: righe categorizzate dal CSV, dalle regole, rimaste `unknown`.

**Card inference dello script** (codici carta nella descrizione → nome card): non replicata in Cunti — con l'upload per banca + card di default nel form non serve più; se servisse, si aggiunge una sezione `card_rules` opzionale nello stesso json.

## Pagine e dashboard

Nuova route `/spese` (nav: si attiva la voce esistente). Viste:

1. **Pluriennale** (default all'apertura): barre per anno entrate vs uscite (~10 anni), saldo netto per anno, tabella riassuntiva. Risponde a "cosa ho guadagnato e speso in tutti gli anni".
2. **Anno**: selettore anno (default corrente), barre mensili in/out, top categorie per impatto con Δ rispetto all'anno precedente, media mensile per categoria.
3. **Mese**: selettore mese, breakdown categorie, lista movimenti (ricerca testuale, filtro categoria/card), confronto stesso mese anno precedente.
4. **Categorie**: trend nel tempo di una categoria, classifica delle più impattanti su periodo scelto.

Filtri trasversali: card/conto (**decisione: più conti, filtro necessario**), inclusione/esclusione giroconti, ricerca descrizione.

**Home combinata** (decisione): la home resta la dashboard investimenti e guadagna una riga di tile spese — uscite del mese corrente, saldo entrate−uscite YTD, categoria più impattante del mese — con link a `/spese`.

Import: sezione dedicata dentro `/spese` (stesso pattern dell'import transazioni: upload + campo "card di default", esito con inserite/saltate/categorizzate per fonte, errori riga per riga).

## Flusso operativo

1. **Primo caricamento**: prepari il CSV unificato delle 4 banche (già categorizzato dallo storico) → upload → anteprima → conferma → le categorie del CSV entrano così come sono → eventuali correzioni dalla UI (inline sulla singola voce, o retro-applicazione regole alle `unknown`).
2. **Caricamenti successivi**: export banca quasi grezzo — bastano `data_ops`, `descrizione`, `importo` (+ card di default nel form se il file non ha la colonna) → Cunti deriva moneyin/moneyout e categorizza con `categories.json` → anteprima → conferma.
3. **Manutenzione regole**: editi `DATA_DIR/categories.json` come oggi (o dall'editor in-app); il report utilizzo keyword ti dice cosa è morto e si può togliere.

### Modifica di massa: export → edit → wipe → reimport

Ciclo completo supportato, per chi preferisce l'editor di testo alla UI:

1. **Export CSV completo**: bottone in `/spese`, formato **identico all'import** (`data_ops;descrizione;card;importo;moneyin;moneyout;categoria`, date DD/MM/YYYY) — round-trip senza perdite, riutilizzabile anche con lo script Python di oggi.
2. Modifichi il file a mano (categorie, descrizioni, quello che vuoi).
3. **Svuota spese**: azione dedicata con doppia conferma; prima del wipe viene creato **automaticamente un backup** del DB. Cancella solo `expenses` (investimenti intoccati).
4. Reimport del file modificato: DB vuoto → nessun dedup/conflitto, entra tutto com'è nel file.

Nota: reimportare un file modificato **senza** wipe funziona ma non è un "update": le righe con chiave cambiata (es. importo corretto) risultano nuove e le vecchie restano — per le correzioni di categoria della stessa voce ci pensa il diff dell'anteprima; per modifiche più profonde usare il ciclo con wipe.

### Modifiche: UI e file sempre equivalenti

| Cosa | Da UI | Da file di testo |
|---|---|---|
| Categoria di una voce | modifica inline in lista | export → edit → wipe → reimport |
| Voci in blocco | filtri + azioni bulk (categoria) | export → edit → wipe → reimport |
| Regole keyword | (M4) editor in-app + snippet "keyword da incollare" | `categories.json` a mano |
| Icona/colore/giroconto categoria | pannello categorie | `categories-meta.json` a mano |
| Rinomina categoria | pannello categorie (propaga a voci DB + `categories.json` + meta) | edit dei due json + reimport voci |

## Riuso

| Esigenza | Già in Cunti |
|---|---|
| Parser CSV robusto | `txcsv.ts` (tecniche) |
| Dedup idempotente | `insertTransactionsDedup` (da estendere a conteggio) |
| Barre mensili/annuali | `Bars.svelte` |
| Breakdown categorie | `Donut.svelte` |
| Tile numeriche | `StatTile.svelte` |
| Formattazione it-IT | `lib/format.ts` |
| Backup | `backup.ts` copia l'intero DB, incluse le nuove tabelle (restore già copia solo colonne comuni) |

### Backup dei json (fatto, 2026-10-03)

`categories.json`/`categories-meta.json` stanno in `DATA_DIR` ma **fuori dal DB** → i backup `.db` non li includono di per sé. Risolto in `backup.ts`: ogni `createBackup()` salva una copia dei json con **lo stesso stem** del `.db` (`cunti-<stamp>.categories.json`), così sono versionati 1:1 col backup — non un'unica copia "ultima nota" sovrascritta a ogni giro (che sarebbe stata inutile: la copia sarebbe sempre quella di *adesso*, non quella di quando il backup è stato preso). `rotate()` e `deleteBackup()` eliminano anche i json abbinati; `restoreBackup()` li ripristina insieme al `.db`. I backup precedenti a questa funzionalità (e i file `.db` caricati a mano) non hanno json abbinato: il restore procede comunque, i json restano quelli attuali. Resta la mitigazione alternativa per chi preferisce: tenere `categories.json` versionato a parte (git), dato che è già testo.

## Milestone

- **M1 — Dati**: tabella + migrazione, parser `expensecsv.ts` (colonne derivate opzionali, extra ignorate), motore matching su `categories.json` (rilettura a ogni import, validazione, longest-match), dedup a conteggio, **import a due fasi** (staging + anteprima con diff conflitti categoria + conferma), card di default, unit test (parser, dedup a conteggio, coerenza importo/moneyin-out, longest-match, categoria CSV che vince, conflitti rilevati, json malformato). Import reale dei 10 anni di storico come collaudo.
- **M2 — Gestione**: lista movimenti con filtri (card, categoria, giroconti), ricerca e icone categoria; modifica inline categoria + snippet "keyword da incollare nel json"; **export CSV completo** (round-trip) e **svuota spese** (backup automatico + doppia conferma); pannello categorie (icona, colore, flag giroconto, **rinomina con propagazione** a voci + json); report utilizzo keyword; test descrizione→categoria; retro-applicazione regole alle unknown con anteprima.
- **M3 — Dashboard**: viste pluriennale/anno/mese/categorie (icone in legende e classifiche), tile riassuntive, riga tile spese in home.
- **M4 — Rifiniture**: editor in-app di `categories.json`, budget mensile per categoria (opzionale), note su movimento, azioni bulk sulla lista.

## Decisioni prese (2026-07-06)

1. **Home**: combinata — investimenti + riga tile spese con link a `/spese`.
2. **Dedup**: a conteggio (chiave `data+descrizione+card+importo`, si inseriscono solo le occorrenze mancanti).
3. **Categorie**: stringhe libere (niente anagrafica); keyword matching interno a Cunti con la stessa semantica dello script Python.
4. **Conti**: `card` ha più valori → dimensione filtrabile; esistono giroconti tra conti propri da neutralizzare (flag per categoria).
5. **Pipeline**: Cunti ingerisce il CSV pre-script (senza moneyin/moneyout/categoria); lo script Python non va ricreato.
6. **Regole su file di testo** (richiesta esplicita): `DATA_DIR/categories.json` nello **stesso formato del file attuale** resta la fonte di verità, editabile a mano; la UI lo legge, lo valida e ci costruisce sopra report/test, non lo sostituisce.
7. **Import con anteprima e diff** (richiesta esplicita): nessuna scrittura prima della conferma; conflitti "stessa voce, categoria diversa" mostrati in diff con scelta per riga.
8. **Round-trip testuale**: export CSV completo nel formato dell'import + azione "svuota spese" (con backup automatico) per il ciclo export → edit a mano → wipe → reimport.
9. **Icone e proprietà categoria da UI**: set di icone SVG predefinite + colore + flag giroconto in `categories-meta.json` (gestito da UI, editabile a mano); rinomina categoria da UI con propagazione.

## Materiale acquisito (2026-07-06)

- [x] `cat.json` — formato `{ categoria: [keyword…] }`, ~24 categorie. Trovate keyword in sintassi regex mai matchate dallo script (substring letterale): da pulire. L'utente vuole comunque snellirlo tenendo solo le spese attuali → il report utilizzo keyword (M2) aiuta.
- [x] `categ.py` — semantica confermata: substring case-insensitive, longest-match, categoria esplicita vince, fallback unknown; moneyin/moneyout dal segno; card inference da codici bancomat (non replicata: sostituita dalla card di default per upload); supporto colonna extra `data_valuta` (da ignorare in import).

## Non-obiettivi

- Multi-valuta (solo EUR).
- Multi-utente / permessi.
- Collegamento automatico alla banca (PSD2): l'ingresso dati resta il CSV.
