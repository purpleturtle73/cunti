<script lang="ts">
	import AreaChart from '$lib/components/AreaChart.svelte';
	import LotsTable from '$lib/components/LotsTable.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import { fmtCurrency, fmtDate, fmtEur, fmtPct, fmtQty, signClass } from '$lib/format';

	let { data } = $props();
	let p = $derived(data.position);
	let inst = $derived(data.instrument);
	let ccy = $derived(inst.currency);
</script>

<svelte:head><title>Cunti — {inst.name} ({inst.symbol})</title></svelte:head>

<header class="head">
	<div>
		<a class="back" href="/">← Dashboard</a>
		<h1>
			{inst.name}
			<span class="ticker">{inst.symbol}</span>
			<span class="badge {inst.type}">{inst.type}</span>
		</h1>
		<p class="sub">
			<code>{inst.symbol}</code>
			{#if inst.isin}
				· {inst.isin}{/if}
			{#if inst.type === 'etf'}
				· TER {inst.ter_pct.toLocaleString('it-IT')}% · aliquota {inst.tax_rate_pct.toLocaleString('it-IT')}%{/if}
		</p>
	</div>
</header>

<section class="tiles">
	<StatTile label="Valore attuale" value={fmtEur(p.value, true)} sub="{fmtQty(p.quantity)} quote" />
	<StatTile label="PMC (commissioni incl.)" value={fmtCurrency(p.avgCost, ccy)} sub="prezzo attuale {fmtCurrency(p.lastPrice, ccy)}{p.lastPriceDate ? ' · ' + fmtDate(p.lastPriceDate) : ''}" />
	<StatTile
		label="P&L non realizzato"
		value={fmtEur(p.unrealized, true)}
		tone={p.unrealized > 0 ? 'pos' : p.unrealized < 0 ? 'neg' : 'neutral'}
		sub={fmtPct(p.unrealizedPct)}
	/>
	<StatTile
		label="P&L realizzato"
		value={fmtEur(p.realizedTotal, true)}
		tone={p.realizedTotal > 0 ? 'pos' : p.realizedTotal < 0 ? 'neg' : 'neutral'}
		sub="commissioni pagate {fmtEur(p.feesPaid)}"
	/>
</section>

<section class="card">
	<h2>Andamento posizione</h2>
	<AreaChart points={data.series} height={300} />
</section>

<section class="card">
	<h2>Operazioni di acquisto</h2>
	<LotsTable lots={data.lots} currency={ccy} showInstrument={false} />
</section>

<section class="card">
	<h2>Operazioni ({data.txs.length})</h2>
	{#if data.txs.length === 0}
		<p class="muted">Nessuna operazione su questo strumento.</p>
	{:else}
		<div class="scroll-x">
			<table class="data">
				<thead>
					<tr>
						<th>Data</th>
						<th>Tipo</th>
						<th class="num">Quantità</th>
						<th class="num">Prezzo</th>
						<th class="num">Commissioni</th>
						<th class="num">Controvalore</th>
						<th>Note</th>
					</tr>
				</thead>
				<tbody>
					{#each data.txs as tx (tx.id)}
						<tr>
							<td>{fmtDate(tx.date)}</td>
							<td><span class={['side', tx.type]}>{tx.type === 'buy' ? 'Acquisto' : 'Vendita'}</span></td>
							<td class="num">{fmtQty(tx.quantity)}</td>
							<td class="num">{fmtCurrency(tx.price, ccy)}</td>
							<td class="num">{fmtCurrency(tx.fee, ccy)}</td>
							<td class="num">{fmtCurrency(tx.quantity * tx.price + (tx.type === 'buy' ? tx.fee : -tx.fee), ccy)}</td>
							<td class="notes-cell">{tx.notes ?? ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

{#if p.realizedEvents.length > 0}
	<section class="card">
		<h2>Plusvalenze realizzate</h2>
		<div class="scroll-x">
			<table class="data">
				<thead>
					<tr>
						<th>Data</th>
						<th class="num">Ricavato netto</th>
						<th class="num">Plus/minusvalenza</th>
					</tr>
				</thead>
				<tbody>
					{#each p.realizedEvents as ev (ev.date + ev.proceeds)}
						<tr>
							<td>{fmtDate(ev.date)}</td>
							<td class="num">{fmtEur(ev.proceeds)}</td>
							<td class={['num', signClass(ev.gain)]}>{fmtEur(ev.gain)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

<style>
	.head {
		margin-bottom: 1.2rem;
	}
	.back {
		font-size: 0.8rem;
		color: var(--ink-3);
	}
	.back:hover {
		color: var(--ink);
	}
	h1 {
		font-size: 1.7rem;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin-top: 0.3rem;
	}
	h1 .ticker {
		margin-left: 0;
		font-size: 0.8rem;
	}
	.sub {
		color: var(--ink-3);
		font-size: 0.85rem;
		margin: 0.25rem 0 0;
	}
	.sub code {
		background: var(--surface-2);
		border-radius: 4px;
		padding: 0.05rem 0.3rem;
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
	section.card {
		margin-bottom: 1rem;
	}
	.muted {
		color: var(--ink-3);
	}
	.side {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.14rem 0.5rem;
		border-radius: 999px;
	}
	.side.buy {
		color: #7fd67f;
		background: rgba(12, 163, 12, 0.13);
	}
	.side.sell {
		color: #f0a3a3;
		background: rgba(230, 103, 103, 0.13);
	}
	.notes-cell {
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ink-2);
	}
	.scroll-x {
		overflow-x: auto;
	}
</style>
