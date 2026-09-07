<script lang="ts">
	import AreaChart from '$lib/components/AreaChart.svelte';
	import Bars from '$lib/components/Bars.svelte';
	import Donut from '$lib/components/Donut.svelte';
	import LotsTable from '$lib/components/LotsTable.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import { fmtCurrency, fmtDate, fmtEur, fmtPct, signClass } from '$lib/format';

	let { data } = $props();
	let snap = $derived(data.snapshot);
	let tax = $derived(data.tax);

	let selected = $state('1y');

	// Marker operazioni sul grafico: nessuno / solo ETF (PAC) / solo crypto / tutte
	type MarkerFilter = 'none' | 'etf' | 'crypto' | 'all';
	let markerFilter = $state<MarkerFilter>('all');
	const MARKER_OPTIONS: { key: MarkerFilter; label: string }[] = [
		{ key: 'none', label: 'Nessuna' },
		{ key: 'etf', label: 'ETF' },
		{ key: 'crypto', label: 'Crypto' },
		{ key: 'all', label: 'Tutte' }
	];
	let chartMarkers = $derived(
		markerFilter === 'none'
			? []
			: data.txMarkers.filter((m) => markerFilter === 'all' || m.assetType === markerFilter)
	);

	const PERIOD_DAYS: Record<string, number | 'ytd' | 'max'> = {
		'1w': 7,
		'1m': 30,
		'3m': 91,
		'6m': 182,
		ytd: 'ytd',
		'1y': 365,
		max: 'max'
	};

	let chartPoints = $derived.by(() => {
		const s = snap.series;
		if (s.length === 0) return [];
		const d = PERIOD_DAYS[selected];
		let startDate: string;
		if (d === 'max') startDate = s[0].date;
		else if (d === 'ytd') startDate = s[s.length - 1].date.slice(0, 4) + '-01-01';
		else {
			const dt = new Date(s[s.length - 1].date + 'T00:00:00Z');
			dt.setUTCDate(dt.getUTCDate() - d);
			startDate = dt.toISOString().slice(0, 10);
		}
		return s.filter((p) => p.date >= startDate).map((p) => ({ date: p.date, value: p.value, invested: p.invested }));
	});

	let selectedStat = $derived(snap.periods.find((p) => p.key === selected));

	const SLOT_COLORS = [
		'var(--series-1)',
		'var(--series-2)',
		'var(--series-3)',
		'var(--series-4)',
		'var(--series-5)',
		'var(--series-6)',
		'var(--series-7)'
	];

	let donutSlices = $derived.by(() => {
		const top = snap.allocation.slice(0, 7).map((a, i) => ({
			label: a.name,
			ticker: a.symbol,
			value: a.value,
			color: SLOT_COLORS[i]
		}));
		const rest = snap.allocation.slice(7);
		if (rest.length > 0)
			top.push({
				label: 'Altro',
				ticker: '',
				value: rest.reduce((s, a) => s + a.value, 0),
				color: 'var(--ink-3)'
			});
		return top;
	});

	let etfValue = $derived(snap.allocation.filter((a) => a.type === 'etf').reduce((s, a) => s + a.value, 0));
	let cryptoValue = $derived(snap.allocation.filter((a) => a.type === 'crypto').reduce((s, a) => s + a.value, 0));

	let latentTax = $derived(tax.latentEtfTax + tax.latentCryptoTax);
</script>

<svelte:head><title>Cunti — Dashboard</title></svelte:head>

{#snippet speseRow()}
	{#if data.spese}
		<section class="spese-row">
			<h2 class="row-title"><a href="/spese">Spese →</a></h2>
			<div class="tiles-inner">
				<StatTile label="Uscite del mese" value={fmtEur(data.spese.monthOut)} tone={data.spese.monthOut > 0 ? 'neg' : 'neutral'} />
				<StatTile label="Entrate del mese" value={fmtEur(data.spese.monthIn)} tone={data.spese.monthIn > 0 ? 'pos' : 'neutral'} />
				<StatTile label="Saldo {data.spese.curYear}" value={fmtEur(data.spese.ytdNet)} tone={data.spese.ytdNet >= 0 ? 'pos' : 'neg'} sub="entrate − uscite, giroconti esclusi" />
				{#if data.spese.topCat}
					<StatTile label="Top categoria del mese" value={data.spese.topCat} />
				{/if}
			</div>
		</section>
	{/if}
{/snippet}

{#if snap.positions.length === 0}
	<section class="onboarding card">
		<h1>Benvenuto in Cunti</h1>
		<p>
			Per iniziare: <a href="/admin">aggiungi gli strumenti</a> (ETF di Borsa Italiana o crypto),
			poi <a href="/transactions">registra i tuoi acquisti</a>. I prezzi si aggiornano da soli ogni 6 ore.
		</p>
	</section>
	{@render speseRow()}
{:else}
	<header class="hero">
		<div>
			<span class="hero-label">Valore del portafoglio</span>
			<h1 class="hero-value tabular">{fmtEur(snap.totalValue)}</h1>
			<div class="hero-delta">
				<span class={['tabular', signClass(snap.grossProfit)]}>
					{fmtEur(snap.grossProfit)} ({fmtPct(snap.totalInvested > 0 ? snap.grossProfit / snap.totalInvested : null)})
				</span>
				<span class="muted">dal primo investimento</span>
			</div>
		</div>

		<div class="pills" role="tablist" aria-label="Periodo">
			{#each snap.periods as p (p.key)}
				<button
					role="tab"
					aria-selected={selected === p.key}
					class={['pill', { active: selected === p.key }]}
					onclick={() => (selected = p.key)}
				>
					<span class="pill-label">{p.label}</span>
					<span class={['pill-pct', 'tabular', signClass(p.pct)]}>{fmtPct(p.pct)}</span>
				</button>
			{/each}
		</div>
	</header>

	<section class="card chart-card">
		<div class="chart-head">
			<h2>Andamento</h2>
			<div class="chart-tools">
				<span class="tools-label">Operazioni:</span>
				<div class="seg" role="group" aria-label="Mostra operazioni sul grafico">
					{#each MARKER_OPTIONS as opt (opt.key)}
						<button
							type="button"
							class={['seg-btn', { active: markerFilter === opt.key }]}
							aria-pressed={markerFilter === opt.key}
							onclick={() => (markerFilter = opt.key)}
						>
							{opt.label}
						</button>
					{/each}
				</div>
				{#if selectedStat && selectedStat.abs != null}
					<span class={['tabular', 'chart-abs', signClass(selectedStat.abs)]}>
						{fmtEur(selectedStat.abs)} nel periodo
					</span>
				{/if}
			</div>
		</div>
		<AreaChart points={chartPoints} height={320} markers={chartMarkers} />
		{#if chartMarkers.length > 0}
			<div class="marker-legend">
				<span><i class="dot buy"></i>Acquisto</span>
				<span><i class="dot sell"></i>Vendita</span>
			</div>
		{/if}
	</section>

	<section class="tiles">
		<StatTile label="Capitale investito" value={fmtEur(snap.totalInvested, true)} sub="al netto dei disinvestimenti" />
		<StatTile
			label="P&L lordo"
			value={fmtEur(snap.grossProfit, true)}
			tone={snap.grossProfit > 0 ? 'pos' : snap.grossProfit < 0 ? 'neg' : 'neutral'}
			sub="non realizzato {fmtEur(snap.unrealizedTotal, true)} · realizzato {fmtEur(snap.realizedTotal, true)}"
		/>
		<StatTile
			label="P&L netto stimato"
			value={fmtEur(tax.netProfit, true)}
			tone={tax.netProfit > 0 ? 'pos' : tax.netProfit < 0 ? 'neg' : 'neutral'}
			sub="dopo imposte su plusvalenze"
			hint="Lordo meno imposte stimate: 26% su ETF (regime amministrato), aliquota crypto per anno"
		/>
		<StatTile
			label="Rendimento annualizzato"
			value={fmtPct(snap.annualizedPct)}
			tone={snap.annualizedPct != null ? (snap.annualizedPct > 0 ? 'pos' : 'neg') : 'neutral'}
			sub="TWR — al netto dei flussi"
		/>
		<StatTile label="Commissioni pagate" value={fmtEur(snap.feesTotal, true)} sub="totale dall'inizio" />
		<StatTile label="Costo TER stimato" value="{fmtEur(tax.terYearly, true)}/anno" sub="in base al TER degli ETF" />
		<StatTile label="Max drawdown" value={fmtPct(snap.maxDrawdownPct, false)} tone={snap.maxDrawdownPct != null && snap.maxDrawdownPct < -0.001 ? 'neg' : 'neutral'} sub="dal massimo storico" />
		<StatTile
			label="Miglior / peggior giorno"
			value="{fmtPct(snap.bestDay?.pct)} · {fmtPct(snap.worstDay?.pct)}"
			sub="{snap.bestDay ? fmtDate(snap.bestDay.date) : '—'} · {snap.worstDay ? fmtDate(snap.worstDay.date) : '—'}"
		/>
	</section>

	{@render speseRow()}

	<section class="grid-2">
		<div class="card">
			<h2>Allocazione</h2>
			<Donut slices={donutSlices} />
			{#if etfValue > 0 && cryptoValue > 0}
				<div class="split">
					<div class="split-bar" aria-hidden="true">
						<i style:flex={etfValue} style:background="var(--series-1)"></i>
						<i style:flex={cryptoValue} style:background="var(--series-5)"></i>
					</div>
					<div class="split-legend">
						<span><i style:background="var(--series-1)"></i>ETF {fmtPct(etfValue / (etfValue + cryptoValue), false)}</span>
						<span><i style:background="var(--series-5)"></i>Crypto {fmtPct(cryptoValue / (etfValue + cryptoValue), false)}</span>
					</div>
				</div>
			{/if}
		</div>

		<div class="card">
			<h2>Piano di accumulo — flussi mensili</h2>
			<Bars bars={snap.monthlyFlows} height={252} />
		</div>
	</section>

	<section class="card">
		<h2>Fisco &amp; costi (stime)</h2>
		<div class="fisco">
			<div class="fisco-block">
				<h3>Imposte latenti</h3>
				<dl>
					<div><dt>Su plusvalenze ETF non realizzate</dt><dd class="tabular">{fmtEur(tax.latentEtfTax)}</dd></div>
					<div><dt>Su plusvalenze crypto non realizzate</dt><dd class="tabular">{fmtEur(tax.latentCryptoTax)}</dd></div>
					<div class="tot"><dt>Se vendessi tutto oggi</dt><dd class="tabular">{fmtEur(latentTax)}</dd></div>
				</dl>
			</div>
			<div class="fisco-block">
				<h3>Costi ricorrenti annui</h3>
				<dl>
					<div><dt>Imposta di bollo (0,2% deposito titoli)</dt><dd class="tabular">{fmtEur(tax.bolloYearly)}</dd></div>
					<div><dt>IVAFE crypto (0,2%)</dt><dd class="tabular">{fmtEur(tax.ivafeYearly)}</dd></div>
					<div><dt>TER degli ETF</dt><dd class="tabular">{fmtEur(tax.terYearly)}</dd></div>
				</dl>
			</div>
			<div class="fisco-block wide">
				<h3>Realizzato per anno</h3>
				{#if tax.realizedByYear.length === 0}
					<p class="muted">Nessuna vendita registrata: niente plusvalenze realizzate.</p>
				{:else}
					<div class="scroll-x">
						<table class="data">
							<thead>
								<tr>
									<th>Anno</th>
									<th class="num">Plusv. ETF</th>
									<th class="num">Minusv. ETF</th>
									<th class="num">Imposta trattenuta (banca)</th>
									<th class="num">Plusv. crypto</th>
									<th class="num">Imposta crypto da dichiarare</th>
								</tr>
							</thead>
							<tbody>
								{#each tax.realizedByYear as y (y.year)}
									<tr>
										<td>{y.year}</td>
										<td class="num">{fmtEur(y.etfGains)}</td>
										<td class="num">{y.etfLosses > 0 ? fmtEur(-y.etfLosses) : '—'}</td>
										<td class="num">{fmtEur(y.etfTaxWithheld)}</td>
										<td class="num">{fmtEur(y.cryptoGains)}</td>
										<td class="num">{fmtEur(y.cryptoTaxDue)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
				<p class="note">
					Stime indicative, non consulenza fiscale. ETF in regime amministrato: la banca trattiene il 26%
					alla vendita (le minusvalenze ETF non compensano plusvalenze ETF). Crypto su exchange estero:
					regime dichiarativo, 26% fino al 2025 e 33% dal 2026, quadri RT/RW.
				</p>
			</div>
		</div>
	</section>

	<section class="card">
		<h2>Posizioni</h2>
		<div class="scroll-x">
			<table class="data">
				<thead>
					<tr>
						<th>Strumento</th>
						<th></th>
						<th class="num">Quantità</th>
						<th class="num">PMC</th>
						<th class="num">Prezzo</th>
						<th class="num">Valore</th>
						<th class="num">Peso</th>
						<th class="num">P&amp;L</th>
						<th class="num">P&amp;L %</th>
					</tr>
				</thead>
				<tbody>
					{#each snap.positions.filter((p) => p.quantity > 0) as p (p.instrument.id)}
						<tr>
							<td>
								<a class="pos-link" href="/positions/{p.instrument.id}">{p.instrument.name}</a>
								<span class="ticker">{p.instrument.symbol}</span>
							</td>
							<td><span class="badge {p.instrument.type}">{p.instrument.type}</span></td>
							<td class="num">{p.quantity.toLocaleString('it-IT', { maximumFractionDigits: 6 })}</td>
							<td class="num">{fmtCurrency(p.avgCost, p.instrument.currency)}</td>
							<td class="num">{fmtCurrency(p.lastPrice, p.instrument.currency)}</td>
							<td class="num">{fmtEur(p.value)}</td>
							<td class="num">{fmtPct(snap.totalValue > 0 ? p.value / snap.totalValue : null, false)}</td>
							<td class={['num', signClass(p.unrealized)]}>{fmtEur(p.unrealized)}</td>
							<td class={['num', signClass(p.unrealized)]}>{fmtPct(p.unrealizedPct)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="card">
		<h2>Operazioni di acquisto</h2>
		<LotsTable lots={snap.lots} />
	</section>
{/if}

<style>
	.onboarding {
		margin-top: 3rem;
		text-align: center;
		padding: 3rem;
	}
	.onboarding p {
		color: var(--ink-2);
		max-width: 46rem;
		margin: 1rem auto 0;
	}
	.onboarding a {
		color: var(--accent);
		font-weight: 600;
	}

	.hero {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.5rem;
		flex-wrap: wrap;
		margin-bottom: 1.4rem;
	}
	.hero-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.11em;
		color: var(--ink-3);
	}
	.hero-value {
		font-size: clamp(2.4rem, 5vw, 3.6rem);
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1.05;
		background: linear-gradient(120deg, #fff 30%, #b9c8ff);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.hero-delta {
		display: flex;
		gap: 0.6rem;
		font-size: 0.95rem;
		margin-top: 0.3rem;
	}
	.muted {
		color: var(--ink-3);
	}

	.pills {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.pill {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.05rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 0.4rem 0.7rem;
		cursor: pointer;
		color: var(--ink-2);
		font: inherit;
		min-width: 58px;
	}
	.pill:hover {
		border-color: var(--border-strong);
	}
	.pill.active {
		border-color: var(--accent);
		background: linear-gradient(120deg, rgba(57, 135, 229, 0.16), rgba(144, 133, 233, 0.12));
		color: var(--ink);
	}
	.pill-label {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	.pill-pct {
		font-size: 0.72rem;
	}

	.chart-card {
		margin-bottom: 1rem;
	}
	.chart-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.chart-tools {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		flex-wrap: wrap;
	}
	.tools-label {
		font-size: 0.75rem;
		color: var(--ink-3);
	}
	.seg {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow: hidden;
	}
	.seg-btn {
		background: var(--surface);
		border: none;
		color: var(--ink-2);
		font: inherit;
		font-size: 0.72rem;
		font-weight: 600;
		padding: 0.32rem 0.65rem;
		cursor: pointer;
	}
	.seg-btn + .seg-btn {
		border-left: 1px solid var(--border);
	}
	.seg-btn:hover {
		color: var(--ink);
	}
	.seg-btn.active {
		background: linear-gradient(120deg, rgba(57, 135, 229, 0.18), rgba(144, 133, 233, 0.14));
		color: var(--ink);
	}
	.chart-abs {
		font-size: 0.85rem;
	}
	.marker-legend {
		display: flex;
		gap: 1.4rem;
		margin-top: 0.5rem;
		font-size: 0.78rem;
		color: var(--ink-2);
	}
	.marker-legend span {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.marker-legend .dot {
		width: 0;
		height: 0;
		border-left: 5px solid transparent;
		border-right: 5px solid transparent;
	}
	.marker-legend .dot.buy {
		border-bottom: 8px solid var(--good);
	}
	.marker-legend .dot.sell {
		border-top: 8px solid var(--bad);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.8rem;
		margin-bottom: 1rem;
	}
	@media (max-width: 1100px) {
		.tiles {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.spese-row {
		margin-bottom: 1rem;
	}
	.row-title {
		font-size: 0.95rem;
		margin: 0 0 0.6rem;
	}
	.row-title a:hover {
		color: var(--accent);
	}
	.tiles-inner {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.8rem;
	}
	@media (max-width: 1100px) {
		.tiles-inner {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	@media (max-width: 1000px) {
		.grid-2 {
			grid-template-columns: 1fr;
		}
	}

	.split {
		margin-top: 1.2rem;
	}
	.split-bar {
		display: flex;
		gap: 2px;
		height: 10px;
		border-radius: 999px;
		overflow: hidden;
	}
	.split-bar i {
		display: block;
	}
	.split-legend {
		display: flex;
		gap: 1.4rem;
		margin-top: 0.5rem;
		font-size: 0.78rem;
		color: var(--ink-2);
	}
	.split-legend span {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.split-legend i {
		width: 10px;
		height: 10px;
		border-radius: 3px;
	}

	section.card {
		margin-bottom: 1rem;
	}

	.fisco {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
	}
	.fisco-block.wide {
		grid-column: 1 / -1;
	}
	.fisco h3 {
		font-size: 0.85rem;
		color: var(--ink-2);
		margin-bottom: 0.6rem;
	}
	.fisco dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.fisco dl div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.88rem;
	}
	.fisco dt {
		color: var(--ink-2);
	}
	.fisco dd {
		margin: 0;
		font-weight: 600;
	}
	.fisco div.tot {
		border-top: 1px solid var(--border);
		padding-top: 0.45rem;
		margin-top: 0.2rem;
	}
	.fisco div.tot dt {
		color: var(--ink);
		font-weight: 600;
	}
	.note {
		margin: 0.9rem 0 0;
		font-size: 0.75rem;
		color: var(--ink-3);
		max-width: 70rem;
	}
	@media (max-width: 900px) {
		.fisco {
			grid-template-columns: 1fr;
		}
	}

	.scroll-x {
		overflow-x: auto;
	}
	.pos-link {
		font-weight: 600;
	}
	.pos-link:hover {
		color: var(--accent);
	}
</style>
