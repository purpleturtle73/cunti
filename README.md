# Cunti

Tracker di finanze personali per chi vive in Italia: entrate e uscite dai CSV della banca, più un portafoglio di investimenti (ETF di Borsa Italiana in PAC e crypto su exchange estero). Self-hosted: come container Podman su un server Linux, oppure come eseguibile unico su un PC Windows. I dati restano tuoi, in un file SQLite. Nessuna autenticazione: va usato in rete locale/VPN, **non esporlo su internet**.

## Funzionalità

### Finanze personali

- **Movimenti** importati dal CSV della banca (anteprima e conferma prima di scrivere, reimport senza doppioni), esportabili per la modifica di massa. Un export in un formato qualsiasi si importa **mappando le colonne** (data, descrizione, importo con segno o Dare/Avere, card, categoria; righe introduttive e totali gestiti), e la mappatura si salva come **profilo** riconosciuto da solo al file successivo.
- **Categorie e keyword** gestite dalla UI, con un set di partenza in stile app bancaria; **"crea regola da questa voce"** direttamente dalla lista movimenti (keyword proposta dalla descrizione); ricategorizzazione delle voci ancora senza categoria e pagina dei **conflitti** tra le tue scelte e le regole (la scelta viene ricordata).
- **Budget mensili per categoria**, con avanzamento del mese (o dell'anno), ritmo atteso a oggi e categorie sforate in evidenza.
- **Andamento del saldo cumulato** (entrate − uscite) con selettore periodo 1S / 1M / 3M / 6M / YTD / 1A / MAX.
- Entrate e uscite del periodo, barre per anno e per mese, torta e classifica delle categorie con confronto sull'anno precedente, spesa per card, **uscite ricorrenti** (abbonamenti, utenze, rate) con il loro peso sulle uscite.
- **Filtri** per anno, mese, categoria, card e testo, anche in esclusione, che valgono per movimenti, totali, grafico e ricorrenti. Lista movimenti ordinabile per colonna e paginata (100 per pagina), con categoria modificabile in linea.

### Investimenti

- **Operazioni** di acquisto/vendita con commissioni e broker; PMC (prezzo medio di carico) commissioni incluse; strumento scelto per ticker; storico modificabile in linea, duplicabile e paginato (100 per pagina).
- **Prezzi automatici**: Yahoo Finance per gli ETF (ticker `.MI`, EUR) e CoinGecko per le crypto. Aggiornamento all'avvio e ogni 6 ore, più pulsante manuale.
- **Valore del portafoglio** e andamento con selettore periodo (rendimento TWR al netto dei flussi) e i punti di acquisto/vendita sul grafico; P&L lordo e **netto stimato dopo le imposte**, rendimento annualizzato, max drawdown, miglior/peggior giorno, commissioni, costo TER annuo, allocazione, flussi mensili del PAC, dettaglio per posizione e per lotto.
- **Fisco (stime)**: 26% su plusvalenze ETF in regime amministrato (aliquota configurabile per strumento), crypto in regime dichiarativo (26% fino al 2025, 33% dal 2026 — L. 207/2024), imposta di bollo 0,2%, IVAFE 0,2%, riepilogo del realizzato per anno.
- **Zainetto fiscale**: minusvalenze riportabili per quattro anni (art. 68 TUIR), separate per regime: crypto (dichiarativo, compensano le plusvalenze crypto successive e abbassano le imposte stimate) ed ETF per broker (amministrato: non compensano le plusvalenze ETF, che sono redditi di capitale). Per ogni minus: uso negli anni, residuo e scadenza.
- **Valute**: strumenti quotati in EUR o USD (tipicamente le crypto), convertiti in EUR al cambio EURUSD del giorno per totali e stime fiscali.

### Generale

- **Admin**: backup manuali e automatici (almeno uno al giorno, rotazione a 10 giorni), download e ripristino anche da file; gestione di card, strumenti e broker con logo; import CSV e svuotamento per ciascuna area; **dati demo** per provare l'app.
- **Tema scuro** (predefinito) **e chiaro**, dal pulsante in fondo alla barra laterale; la scelta resta salvata nel browser.

> Le stime fiscali sono indicative e non costituiscono consulenza. Le minusvalenze da ETF non compensano le plusvalenze da ETF (redditi di capitale vs redditi diversi).

## Installazione

Tre modi, a seconda di dove vuoi tenerlo:

| Dove | Come | Raggiungibile da |
|---|---|---|
| Server Linux (consigliato) | [container Podman](#linux-container-podman) | tutti i dispositivi della rete locale/VPN |
| PC Windows | [eseguibile unico](#windows-eseguibile-unico) | solo quel PC |
| Qualsiasi sistema con Node.js | [senza container](#senza-container-nodejs) | come lo configuri |

In tutti i casi al primo avvio il database parte vuoto: per provare l'app usa i [dati demo](#dati-demo). La **versione in esecuzione** si legge in Admin (sotto il titolo) e in `/api/health` (campo `version`): `1.2.3` per le release del tag `v1.2.3`, `main-<sha>` per le build di verifica, `dev` per una build locale.

### Linux: container Podman

L'immagine è pubblicata su GitHub Container Registry: `ghcr.io/purpleturtle73/cunti:latest` (o una release specifica: `:1.2.3`). Il database vive in `/data/cunti.db` dentro il volume `cunti-data`, i backup automatici in `/data/backups`. L'immagine ha un **healthcheck** (`/api/health`, ogni 30 s): `podman ps` mostra `healthy`/`unhealthy`.

#### Podman Quadlet (consigliato — Rocky Linux o qualsiasi distro con systemd)

Rootless, con avvio automatico al boot. Crea `~/.config/containers/systemd/cunti.container`:

```ini
[Unit]
Description=Cunti - personal finance tracker

[Container]
Image=ghcr.io/purpleturtle73/cunti:latest
AutoUpdate=registry
PublishPort=3030:3030
Volume=cunti-data:/data
Environment=TZ=Europe/Rome
# healthcheck esplicito nell'unit (non basta quello nell'immagine: Quadlet
# valuta Notify=healthy alla creazione del container e con "sdnotify policy
# healthy requires a healthcheck to be set" fallisce se non è dichiarato qui)
HealthCmd=node -e "fetch('http://127.0.0.1:3030/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
HealthInterval=30s
HealthTimeout=5s
HealthStartPeriod=15s
HealthRetries=3
# systemd considera il servizio avviato solo quando l'healthcheck passa
Notify=healthy

[Service]
Restart=always

[Install]
WantedBy=default.target
```

poi:

```sh
systemctl --user daemon-reload
systemctl --user start cunti.service
loginctl enable-linger $USER      # il servizio parte al boot anche senza login
```

App su `http://<ip-del-server>:3030`.

Aggiornamento all'ultima release: `podman auto-update` (grazie a `AutoUpdate=registry`), oppure `systemctl --user restart cunti` dopo un `podman pull`.

Variante di sistema (rootful): stesso file in `/etc/containers/systemd/` e comandi `systemctl` senza `--user`.

Su Rocky Linux con SELinux e firewalld ricordati di aprire la porta:

```sh
sudo firewall-cmd --add-port=3030/tcp --permanent && sudo firewall-cmd --reload
```

#### Prova veloce con podman run

Senza systemd:

```sh
podman run -d --name cunti \
  -p 3030:3030 \
  -v cunti-data:/data \
  ghcr.io/purpleturtle73/cunti:latest
```

### Windows: eseguibile unico

Un solo file, `cunti-<versione>-windows-x64.exe`, niente da installare (Node.js è incluso). Si scarica dalla pagina **Releases** del repository, allegato a ogni release a partire dalla prossima. Prima di allora, o per provare l'ultima versione di `main`: *Actions* → l'ultimo run riuscito su `main` → artifact `cunti-windows-x64` (resta disponibile 14 giorni).

1. Mettilo in una cartella tua, per esempio `Documenti\Cunti`: **database e backup vengono creati lì**, accanto all'exe. Non in `Programmi`, che non è scrivibile: in quel caso l'exe te lo dice e si ferma.
2. Doppio clic: si apre una finestra di console e poi il browser su `http://127.0.0.1:3030`. Chiudendo la finestra l'app si ferma.
3. Per aggiornare sostituisci l'exe con quello nuovo: i dati restano nella cartella. Per spostare i dati su un altro PC copia la cartella intera.

Nella cartella dell'exe trovi `cunti.db` (il database), `backups\` (i backup automatici) e, durante un import, `import-staging\`.

Note:

- L'app ascolta solo su questo PC (`127.0.0.1`), perché non ha autenticazione.
- Porta già occupata, o vuoi un'altra cartella per i dati? Avvialo da un prompt con le variabili `PORT` e `DATA_DIR`. Da PowerShell: `$env:PORT = '3031'; .\cunti.exe`. Da cmd: `set PORT=3031` e poi `cunti.exe`.
- L'exe non è firmato: al primo avvio Windows SmartScreen può mostrare "PC protetto da Windows" → *Ulteriori informazioni* → *Esegui comunque*. Qualche antivirus può segnalarlo per lo stesso motivo.
- Al primo avvio di ogni versione i file dell'app vengono estratti in `%LOCALAPPDATA%\Cunti\app` (qualche MB; le versioni vecchie vengono tolte da sole).

L'exe viene costruito dalla CI su `windows-latest` ([`desktop/build-exe.mjs`](desktop/build-exe.mjs), una Node.js Single Executable Application) e provato avviandolo davvero prima di pubblicarlo.

### Senza container (Node.js)

Su Linux, macOS o Windows, con Node.js 22+:

```sh
npm ci
npm run build
DATA_DIR=./data PORT=3030 BODY_SIZE_LIMIT=200M node build/index.js
```

Il database viene creato in `$DATA_DIR/cunti.db` (default `./data`). `BODY_SIZE_LIMIT` serve per importare CSV grandi e caricare backup (il default di adapter-node è 512 KB). Ascolta su tutte le interfacce: per limitarlo al PC aggiungi `HOST=127.0.0.1`.

Puoi anche costruirti l'eseguibile unico per la piattaforma su cui sei, con un `node` ufficiale (quello di nodejs.org; i pacchetti delle distribuzioni Linux spesso non vanno bene): `npm run build && npm run build:exe` → `dist/cunti` (o `dist\cunti.exe` su Windows), che si comporta come quello di Windows descritto sopra.

## Uso

Il menu ha tre voci: **Finanze**, **Investimenti** e **Admin**.

1. **Finanze** → importa il CSV della banca in **Admin → Finanze** (con anteprima: niente viene scritto prima della conferma; se il formato non è quello di Cunti ti viene chiesto quali colonne usare, e puoi salvare la scelta come profilo della banca), poi in **Admin → Categorie** definisci categorie e keyword (puoi partire dal set suggerito o da un JSON) e rilancia la categorizzazione sulle voci ancora senza categoria. Più comodo ancora: nella lista movimenti il pulsante ⚑ crea una regola dalla voce stessa. In **Admin → Conflitti** trovi le voci in cui la tua categoria non coincide con le regole: applichi la regola o tieni la tua, e la scelta viene ricordata. Nella pagina Finanze trovi statistiche, grafico, budget (si impostano da lì, "Imposta i budget") e movimenti, tutti filtrabili.
2. **Investimenti** → in **Admin → Investimenti** aggiungi ogni ETF con il ticker Yahoo (es. `SWDA.MI`), ISIN, TER, aliquota e valuta (EUR o USD) e le crypto con l'ID CoinGecko (es. `bitcoin`); alla creazione viene scaricato lo storico prezzi completo (per le crypto max 365 giorni: limite dell'API gratuita CoinGecko). Lì configuri anche i broker (nome + logo) e importi le operazioni da CSV. Nella pagina Investimenti registri acquisti e vendite (strumento scelto per ticker, prezzi nella valuta dello strumento), esporti lo storico in CSV e trovi tutto il resto calcolato.
3. **Admin → Generale** → backup: esecuzione manuale, download, ripristino da lista o da file caricato. I backup girano comunque da soli almeno una volta al giorno, con rotazione a 10 giorni. Ogni area ha anche uno **svuotamento** con backup automatico, per il ciclo esporta → modifica → svuota → reimporta.

## Sviluppo

```sh
npm install
npm run dev              # http://localhost:5173
npm run check            # type-check
npm test                 # unit test (vitest)
npm run build            # build di produzione in build/
npm run build:exe        # eseguibile unico in dist/ (dopo build, con un node ufficiale)
```

Stack: SvelteKit (Svelte 5) + adapter-node, SQLite (better-sqlite3), grafici SVG custom. Variabili: `DATA_DIR` (default `./data`; nell'exe la cartella dell'exe), `PORT` (default `3030` in produzione), `HOST` (default tutte le interfacce; nell'exe `127.0.0.1`), `BODY_SIZE_LIMIT` (dimensione massima di un upload; `200M` nell'immagine e nell'exe, il default di adapter-node è 512 KB e farebbe fallire con 413 import CSV e upload di backup — se lanci `node build/index.js` a mano impostala anche tu).

### Dati demo

Per provare l'app senza i propri dati: **Admin → Finanze → Dati demo** e **Admin → Investimenti → Dati demo**. Funzionano solo su un'area vuota, così dati finti e veri non si mescolano; per toglierli si usa lo svuotamento dell'area. I dati sono deterministici e con date relative a oggi.

- **Finanze**: circa due anni di movimenti (stipendio, affitto, bollette, abbonamenti, spesa, ristoranti, viaggi…) su tre conti correnti, un conto trading e tre carte di credito. Categorie e keyword vengono **sostituite** dal solo set di default e le card configurate dalle sole card demo, dopo un backup automatico da cui recuperare le proprie. Alcune voci restano senza categoria e alcune sono in conflitto con le regole, così anche Categorie e Conflitti hanno qualcosa da mostrare.
- **Investimenti**: due ETF e una crypto finti (simboli `DEMO…`, esclusi dall'aggiornamento prezzi) con circa due anni di prezzi sintetici e cambio EURUSD, due broker con logo, un PAC mensile di 18 rate, acquisti crypto sparsi e una vendita.

Per uno sviluppo locale da zero:

```sh
DATA_DIR=./tmp/demo npm run dev   # DB vuoto in ./tmp/demo, poi i pulsanti "Crea dati demo" in Admin
```

### Immagine container e release

Il workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- **push su `main` o pull request** → `svelte-check` + test unitari (vitest) + build di produzione + build di verifica dell'immagine, **senza pubblicare nulla**;
- **push di un tag `v*`** → stessi test, poi build e **push su ghcr.io** con i tag `<versione>`, `<major>.<minor>` e `latest`;
- in entrambi i casi costruisce e prova l'**exe Windows**; sui tag lo allega alla release GitHub.

Per rilasciare una nuova versione:

```sh
git tag v0.1.0
git push origin v0.1.0
```

L'autenticazione usa il `GITHUB_TOKEN` integrato: nessun secret da configurare. Al primo publish, se il repo è pubblico, rendi pubblico anche il package ghcr (Settings del package → Change visibility).

Build locale dell'immagine (solo per test):

```sh
podman build -t cunti -f Containerfile .
podman run -d --name cunti-test -p 3030:3030 -v cunti-data:/data cunti
```
