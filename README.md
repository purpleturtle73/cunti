# Cunti

Tracker di portafoglio per investitore italiano: ETF di Borsa Italiana (PAC mensile) + crypto su exchange estero. Self-hosted con Podman, pensato per rete locale/VPN (nessuna autenticazione: **non esporre su internet**).

## Funzionalità

- **Transazioni manuali** di acquisto/vendita con commissioni; PMC (prezzo medio di carico) commissioni incluse.
- **Prezzi automatici**: Yahoo Finance per gli ETF (ticker `.MI`, EUR) e CoinGecko per le crypto (EUR). Aggiornamento all'avvio e ogni 6 ore, più pulsante manuale.
- **Dashboard**: valore del portafoglio, andamento con selettore periodo (1S / 1M / 3M / 6M / YTD / 1A / MAX, rendimento TWR al netto dei flussi), P&L lordo e **netto stimato dopo le imposte**, rendimento annualizzato, max drawdown, miglior/peggior giorno, commissioni totali, costo TER annuo, allocazione, flussi mensili del PAC.
- **Fisco (stime)**: 26% su plusvalenze ETF in regime amministrato (aliquota configurabile per strumento), crypto in regime dichiarativo (26% fino al 2025, 33% dal 2026 — L. 207/2024), imposta di bollo 0,2%, IVAFE 0,2%, riepilogo del realizzato per anno.
- **Dettaglio posizione** con storico, operazioni e plusvalenze realizzate.
- **Broker**: ogni operazione può essere associata a un broker (configurabili, con logo, dal pannello di amministrazione).
- **Valute**: locale italiano ovunque; strumenti quotati in EUR o USD (tipicamente le crypto) — i valori USD sono convertiti in EUR al cambio EURUSD del giorno per totali e stime fiscali.
- **Marker operazioni sul grafico**: i momenti di acquisto/vendita (PAC, crypto) sono visualizzabili come punti sul grafico del portafoglio, filtrabili (nessuna / ETF / crypto / tutte).
- **Backup automatici** almeno una volta al giorno con rotazione a 10 giorni; pannello di **amministrazione** per backup manuali, download, ripristino (anche da file caricato) e gestione broker.
- **Spese**: tracker delle finanze personali da CSV bancari, con categorie e keyword gestite dalla UI, ricategorizzazione delle voci senza categoria, pagina dei conflitti tra le tue scelte e le regole, statistiche per categoria, card e ricorrenti.

> Le stime fiscali sono indicative e non costituiscono consulenza. Le minusvalenze da ETF non compensano le plusvalenze da ETF (redditi di capitale vs redditi diversi).

## Installazione

L'immagine è pubblicata su GitHub Container Registry: `ghcr.io/purpleturtle73/cunti:latest` (release specifica: `:1.2.3`).

Il database SQLite vive in `/data/cunti.db` (volume `cunti-data`); i backup automatici in `/data/backups`. Al primo avvio il DB parte vuoto (per dati di prova vedi [Dati demo](#dati-demo)).

L'immagine include un **healthcheck** (`/api/health`, ogni 30 s): `podman ps` mostra lo stato `healthy`/`unhealthy` del container.

La **release in esecuzione** si legge in Amministrazione (sotto il titolo) e in `/api/health` (campo `version`): `1.2.3` per le immagini pubblicate da un tag `v1.2.3`, `main-<sha>` per le build di verifica, `dev` fuori da un'immagine.

### Podman Quadlet (consigliato — Rocky Linux o qualsiasi distro con systemd)

Rootless, con avvio automatico al boot. Crea `~/.config/containers/systemd/cunti.container`:

```ini
[Unit]
Description=Cunti - portfolio tracker

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

### Podman run

Per una prova veloce senza systemd:

```sh
podman run -d --name cunti \
  -p 3030:3030 \
  -v cunti-data:/data \
  ghcr.io/purpleturtle73/cunti:latest
```

### Locale con npm (senza container)

Richiede Node.js 22+:

```sh
npm ci
npm run build
DATA_DIR=./data PORT=3030 node build/index.js
```

Il DB viene creato in `$DATA_DIR/cunti.db` (default `./data`).

## Uso

1. **Amministrazione → Transazioni** → aggiungi ogni ETF con il ticker Yahoo (es. `SWDA.MI`), ISIN, TER, aliquota e valuta (EUR o USD); le crypto con l'ID CoinGecko (es. `bitcoin`). Alla creazione viene scaricato lo storico prezzi completo (per le crypto max 365 giorni: limite dell'API gratuita CoinGecko).
2. Nella stessa pagina configura i broker (nome + logo), importa le transazioni da CSV (con anteprima: niente viene scritto prima della conferma) o svuotale tutte per il ciclo esporta→modifica→reimporta. In **Amministrazione → Generale** gestisci i backup: esecuzione manuale, download, ripristino da lista o da file caricato. I backup girano comunque da soli almeno una volta al giorno, con rotazione a 10 giorni.
3. **Transazioni** → registra acquisti e vendite scegliendo lo strumento per ticker, con quantità, prezzo, commissioni e broker (prezzi nella valuta dello strumento); da qui esporti anche lo storico in CSV.
4. **Dashboard** → tutto il resto è calcolato; col filtro "Operazioni" vedi i punti di acquisto/vendita sul grafico.
5. **Spese** → importa il CSV della banca in **Amministrazione → Spese**, poi in **Categorie** definisci categorie e keyword (puoi partire dal set suggerito o da un JSON) e rilancia la categorizzazione sulle voci ancora senza categoria. In **Conflitti** trovi le voci in cui la tua categoria non coincide con le regole: applichi la regola o tieni la tua, e la scelta viene ricordata.

## Sviluppo

```sh
npm install
npm run dev              # http://localhost:5173
npm run check            # type-check
npm test                 # unit test (vitest)
```

Stack: SvelteKit (Svelte 5) + adapter-node, SQLite (better-sqlite3), grafici SVG custom. Variabili: `DATA_DIR` (default `./data`), `PORT` (default `3030` in produzione), `BODY_SIZE_LIMIT` (dimensione massima di un upload; impostata a `200M` nell'immagine, il default di adapter-node è 512 KB e farebbe fallire con 413 import CSV e upload di backup — se lanci `node build/index.js` a mano impostala anche tu).

### Dati demo

[`scripts/make-demo-db.js`](scripts/make-demo-db.js) genera un database demo **separato** con dati generici: 2 ETF (EUR) + una crypto (USD), ~2 anni di prezzi sintetici e cambio EURUSD (random walk deterministico, riproducibile), 2 broker con logo, un PAC mensile di 18 rate, acquisti crypto sparsi e una vendita. Le date sono relative a oggi.

```sh
npm run demo:db                      # crea ./data/demo-cunti.db
DATA_DIR=./tmp/demo npm run demo:db  # oppure in un'altra DATA_DIR
```

Il file prodotto è `DATA_DIR/demo-cunti.db`; se esiste già, lo script **chiede conferma** prima di sovrascrivere. È pensato per l'uso manuale: per provarlo nell'app copialo come `cunti.db` nella `DATA_DIR` scelta, es.

```sh
DATA_DIR=./tmp/demo npm run demo:db
cp tmp/demo/demo-cunti.db tmp/demo/cunti.db
DATA_DIR=./tmp/demo npm run dev
```

### Anonimizzare una copia locale

I dati veri vivono nel container. Per lavorare in locale su una copia realistica ma senza dati personali:

```sh
npm run anonymize                       # anonimizza ./data/cunti.db in place, chiede conferma
DATA_DIR=./tmp/copia npm run anonymize  # oppure un'altra DATA_DIR
```

Lo script fa prima una copia di sicurezza in `./tmp/anonimizzazione/` (contiene i dati veri: eliminala a verifica fatta), poi sostituisce descrizioni, importi, nomi di card, broker e categorie personali, e alla fine compatta il file perché le stringhe originali non restino nelle pagine libere. Non tocca i backup: li elenca se possono ancora contenere dati veri.

### Immagine container e release

Il workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) fa due cose:

- **push su `main` o pull request** → `svelte-check` + test unitari (vitest) + build di produzione + build di verifica dell'immagine, **senza pubblicare nulla**;
- **push di un tag `v*`** → stessi test, poi build e **push su ghcr.io** con i tag `<versione>`, `<major>.<minor>` e `latest`.

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
