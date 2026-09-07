<script lang="ts">
	import { fmtCurrency, fmtDate, fmtEur, fmtPct, fmtQty, signClass } from '$lib/format';

	interface LotRow {
		txId: number;
		date: string;
		quantity: number;
		remaining: number;
		unitCost: number;
		unitCostEur: number;
		fee: number;
		costBasis: number;
		value: number;
		unrealized: number;
		unrealizedPct: number;
		realized: number;
		instrument?: { id: number; name: string; symbol: string; type: string; currency: string };
	}

	let {
		lots,
		currency = 'EUR',
		showInstrument = true
	}: { lots: LotRow[]; currency?: string; showInstrument?: boolean } = $props();

	type Filter = 'open' | 'closed' | 'all';
	const FILTERS: { key: Filter; label: string }[] = [
		{ key: 'open', label: 'Aperte' },
		{ key: 'closed', label: 'Chiuse' },
		{ key: 'all', label: 'Tutte' }
	];
	let filter = $state<Filter>('open');

	type Sort = 'date' | 'pl';
	let sort = $state<Sort>('date');

	// Una quota residua < 1e-9 è chiusa: evita che gli arrotondamenti FIFO
	// lascino lotti "aperti" con quantità nulla.
	const EPS = 1e-9;
	let isOpen = (l: LotRow) => l.remaining > EPS;

	let rows = $derived.by(() => {
		const list = lots.filter((l) =>
			filter === 'all' ? true : filter === 'open' ? isOpen(l) : !isOpen(l)
		);
		return sort === 'date'
			? list
			: [...list].sort((a, b) => {
					const av = isOpen(a) ? a.unrealizedPct : a.costBasis;
					const bv = isOpen(b) ? b.unrealizedPct : b.costBasis;
					return bv - av;
				});
	});

	let totals = $derived(
		rows.reduce(
			(t, l) => ({
				costBasis: t.costBasis + l.costBasis,
				value: t.value + l.value,
				unrealized: t.unrealized + l.unrealized,
				realized: t.realized + l.realized
			}),
			{ costBasis: 0, value: 0, unrealized: 0, realized: 0 }
		)
	);

	let counts = $derived({
		open: lots.filter(isOpen).length,
		closed: lots.filter((l) => !isOpen(l)).length
	});
</script>

<div class="head">
	<div class="seg" role="group" aria-label="Filtra i lotti di acquisto">
		{#each FILTERS as f (f.key)}
			<button
				type="button"
				class={['seg-btn', { active: filter === f.key }]}
				aria-pressed={filter === f.key}
				onclick={() => (filter = f.key)}
			>
				{f.label}
				<span class="count">
					{f.key === 'open' ? counts.open : f.key === 'closed' ? counts.closed : lots.length}
				</span>
			</button>
		{/each}
	</div>
	<label class="sort">
		Ordina
		<select bind:value={sort}>
			<option value="date">Data (recenti prima)</option>
			<option value="pl">Risultato</option>
		</select>
	</label>
</div>

{#if rows.length === 0}
	<p class="muted">
		{filter === 'open'
			? 'Nessun acquisto ancora aperto.'
			: filter === 'closed'
				? 'Nessun acquisto già venduto per intero.'
				: 'Nessun acquisto registrato.'}
	</p>
{:else}
	<div class="scroll-x">
		<table class="data">
			<thead>
				<tr>
					<th>Data</th>
					{#if showInstrument}<th>Strumento</th>{/if}
					<th class="num">Quantità</th>
					<th class="num">Prezzo di carico</th>
					<th class="num">Costo residuo</th>
					<th class="num">Valore</th>
					<th class="num">P&amp;L latente</th>
					<th class="num">P&amp;L %</th>
					<th class="num">Realizzato</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as l (l.txId)}
					{@const ccy = l.instrument?.currency ?? currency}
					<tr class={{ closed: !isOpen(l) }}>
						<td>{fmtDate(l.date)}</td>
						{#if showInstrument}
							<td class="inst">
								{#if l.instrument}
									<a href="/positions/{l.instrument.id}">{l.instrument.name}</a>
									<span class="ticker">{l.instrument.symbol}</span>
								{:else}
									—
								{/if}
							</td>
						{/if}
						<td class="num">
							{fmtQty(l.remaining)}
							{#if l.remaining < l.quantity - EPS}
								<span class="orig" title="quantità acquistata">/ {fmtQty(l.quantity)}</span>
							{/if}
						</td>
						<td class="num">{fmtCurrency(l.unitCost, ccy)}</td>
						<td class="num">{isOpen(l) ? fmtEur(l.costBasis) : '—'}</td>
						<td class="num">{isOpen(l) ? fmtEur(l.value) : '—'}</td>
						<td class={['num', signClass(isOpen(l) ? l.unrealized : null)]}>
							{isOpen(l) ? fmtEur(l.unrealized) : '—'}
						</td>
						<td class={['num', signClass(isOpen(l) ? l.unrealized : null)]}>
							{isOpen(l) ? fmtPct(l.unrealizedPct) : '—'}
						</td>
						<td class={['num', signClass(l.realized === 0 ? null : l.realized)]}>
							{l.realized === 0 ? '—' : fmtEur(l.realized)}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<td colspan={showInstrument ? 4 : 3}>Totale ({rows.length})</td>
					<td class="num">{fmtEur(totals.costBasis)}</td>
					<td class="num">{fmtEur(totals.value)}</td>
					<td class={['num', signClass(totals.unrealized)]}>{fmtEur(totals.unrealized)}</td>
					<td class={['num', signClass(totals.unrealized)]}>
						{fmtPct(totals.costBasis > 0 ? totals.unrealized / totals.costBasis : null)}
					</td>
					<td class={['num', signClass(totals.realized === 0 ? null : totals.realized)]}>
						{totals.realized === 0 ? '—' : fmtEur(totals.realized)}
					</td>
				</tr>
			</tfoot>
		</table>
	</div>
	<p class="note">
		Ogni riga è un singolo acquisto. Le vendite consumano gli acquisti dal più vecchio (FIFO),
		quindi «quantità» è la parte ancora in portafoglio e «realizzato» il risultato già incassato
		su quel lotto.
	</p>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.8rem;
	}
	.seg {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow: hidden;
	}
	.seg-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
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
	.count {
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
	.sort {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--ink-3);
	}
	.sort select {
		font-size: 0.8rem;
		padding: 0.3rem 0.5rem;
		text-transform: none;
		letter-spacing: 0;
		color: var(--ink);
	}
	.scroll-x {
		overflow-x: auto;
	}
	.inst a {
		font-weight: 600;
	}
	.inst a:hover {
		color: var(--accent);
	}
	tr.closed td {
		color: var(--ink-3);
	}
	.orig {
		color: var(--ink-3);
		font-size: 0.8em;
		margin-left: 0.2rem;
	}
	tfoot td {
		border-bottom: none;
		border-top: 1px solid var(--border);
		font-weight: 600;
	}
	.muted {
		color: var(--ink-3);
	}
	.note {
		margin: 0.8rem 0 0;
		font-size: 0.75rem;
		color: var(--ink-3);
		max-width: 70rem;
	}
</style>
