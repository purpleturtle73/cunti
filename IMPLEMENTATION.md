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
  lib/format.ts                formattazione it-IT (EUR, %, date, quantità)
  lib/server/
    db.ts                      schema + helper SQLite (instruments, transactions, prices, settings)
    prices.ts                  fetcher Yahoo/CoinGecko, refreshAll, scheduler 6h
    portfolio.ts               motore: posizioni (PMC), serie giornaliera, TWR, periodi, drawdown
    tax.ts                     stime fiscali italiane
    *.test.ts                  unit test vitest
  lib/components/
    AreaChart.svelte           area+linea con crosshair/tooltip, linea "investito" tratteggiata
    Donut.svelte               allocazione con gap 2°, hover, centro dinamico
    Bars.svelte                flussi mensili PAC (investito/disinvestito)
    StatTile.svelte            tile statistica
  routes/
    +page.svelte               dashboard (hero, pill periodi, tiles, fisco, posizioni)
    transactions/              CRUD transazioni (form actions)
    instruments/               CRUD strumenti + download storico alla creazione
    positions/[id]/            dettaglio posizione
    api/refresh/+server.ts     POST refresh prezzi manuale
scripts/seed-demo.js           dati demo con prezzi sintetici (DB separato via DATA_DIR)
entrypoint.sh                  avvio container: seed demo se DB assente (vedi sotto)
```

### Avvio container e dati demo

L'immagine include `scripts/seed-demo.js` e parte da `entrypoint.sh`:

- nessun `cunti.db` in `DATA_DIR` → genera i dati demo, poi avvia l'app (primo avvio sempre "popolato" per il test);
- DB già presente → nessun seed, il DB non viene mai toccato;
- `SEED_DEMO=0` → salta il seed e parte con DB vuoto (deploy reale).

Il seed è idempotente: schema con `CREATE TABLE IF NOT EXISTS`, strumenti `INSERT OR IGNORE`, transazioni inserite solo se la tabella è vuota, prezzi in upsert.

## Calcoli finanziari

- **PMC (prezzo medio di carico)**: media ponderata degli acquisti **commissioni incluse**; le vendite riducono la quantità senza toccare il PMC (metodo del costo medio, coerente col regime amministrato). Posizione azzerata → PMC azzerato.
- **Plusvalenza realizzata** = ricavato netto commissioni − quantità × PMC.
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
- **CoinGecko** (crypto, `vs_currency=eur`): `market_chart`, max **365 giorni** con l'API gratuita.
- Scheduler: refresh all'avvio se più vecchio di 6h, poi ogni 6h; 1,5s di pausa tra strumenti (rate limit); lock anti-sovrapposizione; report in `settings.last_refresh_report`.

## Sicurezza / rete

- Nessuna autenticazione **by design**: solo LAN/VPN.
- `csrf.checkOrigin: false` (svelte.config.js): l'app è raggiunta con hostname/IP diversi e adapter-node richiederebbe un `ORIGIN` fisso. Accettabile solo perché non esposta su internet.

## Test

### Unit test (vitest — `npm test`, eseguiti in CI)

- `src/lib/server/tax.test.ts` (pure, senza DB): aliquota crypto per anno (26/33), imposte latenti al 26% e con aliquota custom 12,5%, nessuna imposta su posizioni in perdita, compensazione gains/losses crypto nello stesso anno, **non**-compensazione minusvalenze ETF, bollo/IVAFE/TER, netProfit = lordo − imposte.
- `src/lib/server/portfolio.test.ts` (DB SQLite isolato in `tmp/test-data`): PMC con commissioni incluse, vendita (plusvalenza vs PMC, PMC invariato), azzeramento posizione, `buildSnapshot` (totali, serie giornaliera, flussi, TWR di periodo, P&L assoluto).

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

- **Sezione Spese** (tracker finanze personali): caricamento spese mensili con categorie. La nav ha già la voce disabilitata; il layout globale è pensato per ospitarla.

## Changelog

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

### 2026-07-05 — Repo definitivo
- Placeholder `OWNER/REPO` sostituiti con `purpleturtle73/cunti` in README (immagine ghcr, Quadlet, podman run). Il workflow CI usa già `${{ github.repository }}`, nessuna modifica necessaria lì.
