# Cunti

Tracker di portafoglio per investitore italiano: ETF di Borsa Italiana (PAC mensile) + crypto su exchange estero. Self-hosted con Podman, pensato per rete locale/VPN (nessuna autenticazione: **non esporre su internet**).

## Funzionalità

- **Transazioni manuali** di acquisto/vendita con commissioni; PMC (prezzo medio di carico) commissioni incluse.
- **Prezzi automatici**: Yahoo Finance per gli ETF (ticker `.MI`, EUR) e CoinGecko per le crypto (EUR). Aggiornamento all'avvio e ogni 6 ore, più pulsante manuale.
- **Dashboard**: valore del portafoglio, andamento con selettore periodo (1S / 1M / 3M / 6M / YTD / 1A / MAX, rendimento TWR al netto dei flussi), P&L lordo e **netto stimato dopo le imposte**, rendimento annualizzato, max drawdown, miglior/peggior giorno, commissioni totali, costo TER annuo, allocazione, flussi mensili del PAC.
- **Fisco (stime)**: 26% su plusvalenze ETF in regime amministrato (aliquota configurabile per strumento), crypto in regime dichiarativo (26% fino al 2025, 33% dal 2026 — L. 207/2024), imposta di bollo 0,2%, IVAFE 0,2%, riepilogo del realizzato per anno.
- **Dettaglio posizione** con storico, operazioni e plusvalenze realizzate.
- Sezione **Spese** predisposta nella navigazione (in arrivo: tracker di finanze personali).

> Le stime fiscali sono indicative e non costituiscono consulenza. Le minusvalenze da ETF non compensano le plusvalenze da ETF (redditi di capitale vs redditi diversi).

Dettagli di implementazione, calcoli e test: [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Installazione

L'immagine è pubblicata su GitHub Container Registry: `ghcr.io/purpleturtle73/cunti:latest` (release specifica: `:1.2.3`).

Il database SQLite vive in `/data/cunti.db` (volume `cunti-data`): per il backup basta copiare quel file.

**Primo avvio**: senza un database esistente, il container genera automaticamente **dati demo** per provare subito l'interfaccia (dettagli nella sezione [Dati demo](#dati-demo)). Per un'installazione reale parti con DB vuoto impostando `SEED_DEMO=0`, come negli esempi qui sotto. Un DB già presente non viene mai toccato.

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
Environment=SEED_DEMO=0

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
  -e SEED_DEMO=0 \
  ghcr.io/purpleturtle73/cunti:latest
```

Ometti `-e SEED_DEMO=0` per avere i dati demo al primo avvio.

### Locale con npm (senza container)

Richiede Node.js 22+:

```sh
npm ci
npm run build
DATA_DIR=./data PORT=3030 node build/index.js
```

Il DB viene creato in `$DATA_DIR/cunti.db` (default `./data`). Per popolare l'istanza con i dati demo, prima dell'avvio: `DATA_DIR=./data npm run seed:demo`.

## Uso

1. **Strumenti** → aggiungi ogni ETF con il ticker Yahoo (es. `SWDA.MI`), ISIN, TER e aliquota; le crypto con l'ID CoinGecko (es. `bitcoin`). Alla creazione viene scaricato lo storico prezzi completo (per le crypto max 365 giorni: limite dell'API gratuita CoinGecko).
2. **Transazioni** → registra acquisti e vendite con quantità, prezzo e commissioni.
3. **Dashboard** → tutto il resto è calcolato.

## Sviluppo

```sh
npm install
npm run dev              # http://localhost:5173
npm run check            # type-check
npm test                 # unit test (vitest)
```

Stack: SvelteKit (Svelte 5) + adapter-node, SQLite (better-sqlite3), grafici SVG custom. Variabili: `DATA_DIR` (default `./data`), `PORT` (default `3030` in produzione), `SEED_DEMO` (solo container, default `1`).

### Dati demo

[`scripts/seed-demo.js`](scripts/seed-demo.js) genera un portafoglio finto ma realistico: 2 ETF + Bitcoin, ~2 anni di prezzi sintetici (random walk deterministico, riproducibile), un PAC mensile di 18 rate, acquisti crypto sparsi e una vendita (per testare le plusvalenze realizzate). Le date sono relative a oggi, quindi il seed produce sempre un portafoglio "attuale".

Come viene usato:

- **Nel container**: l'entrypoint (`entrypoint.sh`) lo esegue automaticamente all'avvio **solo se** in `/data` non c'è già `cunti.db`; con `SEED_DEMO=0` viene saltato e l'app parte con DB vuoto. Un DB esistente non viene mai modificato.
- **In sviluppo**, su un DB separato per non sporcare quello reale:

```sh
DATA_DIR=./tmp/demo-data npm run seed:demo
DATA_DIR=./tmp/demo-data npm run dev
```

Il seed è idempotente: rieseguirlo su un DB già popolato non duplica le transazioni (aggiorna solo i prezzi sintetici).

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
