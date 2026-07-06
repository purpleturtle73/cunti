<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import CategoryIcon from '$lib/components/CategoryIcon.svelte';
	import Donut from '$lib/components/Donut.svelte';
	import InOutBars from '$lib/components/InOutBars.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import { categoryColor } from '$lib/expense-icons';
	import { fmtDate, fmtEur } from '$lib/format';

	let { data, form } = $props();

	const MONTH_NAMES = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

	function metaOf(cat: string) {
		return data.meta[cat] ?? {};
	}
	function colorOf(cat: string) {
		return metaOf(cat).color || categoryColor(cat);
	}

	let cardByName = $derived(new Map(data.cardLogos.map((c) => [c.name, c])));

	function setFilters(patch: Record<string, string>) {
		const f = { ...data.filters, ...patch };
		const p = new URLSearchParams();
		p.set('anno', f.year); // sempre esplicito: '' = tutti gli anni
		if (f.month) p.set('mese', f.month);
		if (f.category) p.set('categoria', f.category);
		if (f.card) p.set('card', f.card);
		if (f.q) p.set('q', f.q);
		goto(`/spese?${p}`, { keepFocus: true, noScroll: true });
	}

	let activeChips = $derived.by(() => {
		const chips: { label: string; clear: Record<string, string> }[] = [];
		if (data.filters.year) chips.push({ label: `anno: ${data.filters.year}`, clear: { year: '', month: '' } });
		if (data.filters.month) chips.push({ label: `mese: ${MONTH_NAMES[Number(data.filters.month) - 1]}`, clear: { month: '' } });
		if (data.filters.category) chips.push({ label: `categoria: ${data.filters.category}`, clear: { category: '' } });
		if (data.filters.card) chips.push({ label: `card: ${data.filters.card}`, clear: { card: '' } });
		if (data.filters.q) chips.push({ label: `cerca: “${data.filters.q}”`, clear: { q: '' } });
		return chips;
	});

	let prevOutByCat = $derived(new Map(data.catTotalsPrev.map((c) => [c.category, c.moneyOut])));
	let topCats = $derived(data.catTotals.filter((c) => !metaOf(c.category).transfer && c.moneyOut > 0).slice(0, 12));
	let donutSlices = $derived.by(() => {
		const top = topCats.slice(0, 8);
		const rest = topCats.slice(8).reduce((s, c) => s + c.moneyOut, 0);
		const slices = top.map((c) => ({ label: c.category, value: c.moneyOut, color: colorOf(c.category) }));
		if (rest > 0) slices.push({ label: 'altre', value: rest, color: 'var(--border-strong)' });
		return slices;
	});

	let allCategories = $derived(data.summaries.map((s) => s.category).sort());

	let periodLabel = $derived(
		data.filters.year
			? data.filters.month
				? `${MONTH_NAMES[Number(data.filters.month) - 1]} ${data.filters.year}`
				: data.filters.year
			: 'tutto lo storico'
	);

	let saldoYtd = $derived(data.tiles.ytdIn - data.tiles.ytdOut);
</script>

{#snippet cardBadge(name: string)}
	{@const c = cardByName.get(name)}
	<span class="card-badge" title={name}>
		{#if c?.has_logo}
			<img src="/api/cards/{c.id}/logo" alt="" width="18" height="18" />
		{/if}
		{name}
	</span>
{/snippet}

<svelte:head><title>Cunti — Spese</title></svelte:head>

<h1 class="page-title">Spese</h1>

{#if !data.hasExpenses}
	<section class="card">
		<h2>Nessuna spesa registrata</h2>
		<p class="muted">
			Importa il tuo storico CSV da <a class="link" href="/admin">Amministrazione</a> (sezione "Spese: importa CSV").
		</p>
	</section>
{:else}
	<div class="tiles">
		<StatTile label="Uscite {MONTH_NAMES[Number(data.tiles.curMonth.slice(5)) - 1]}" value={fmtEur(data.tiles.monthOut)} tone={data.tiles.monthOut > 0 ? 'neg' : 'neutral'} />
		<StatTile label="Entrate {MONTH_NAMES[Number(data.tiles.curMonth.slice(5)) - 1]}" value={fmtEur(data.tiles.monthIn)} tone={data.tiles.monthIn > 0 ? 'pos' : 'neutral'} />
		<StatTile label="Saldo {data.tiles.curYear}" value={fmtEur(saldoYtd)} tone={saldoYtd >= 0 ? 'pos' : 'neg'} sub="entrate − uscite, esclusi giroconti/doppi conteggi" />
		{#if data.tiles.topCatMonth}
			<StatTile label="Top categoria del mese" value={data.tiles.topCatMonth.name} sub={fmtEur(data.tiles.topCatMonth.out)} />
		{/if}
	</div>

	{#if activeChips.length > 0}
		<div class="chips">
			<span class="chips-label">Filtri:</span>
			{#each activeChips as chip (chip.label)}
				<button class="chip" type="button" onclick={() => setFilters(chip.clear)} title="Rimuovi filtro">
					{chip.label} <span class="x">✕</span>
				</button>
			{/each}
			<button class="chip clear-all" type="button" onclick={() => setFilters({ year: '', month: '', category: '', card: '', q: '' })}>
				Mostra tutto
			</button>
		</div>
	{/if}

	<section class="card">
		<h2>Per anno <span class="muted sub-h">(clic su un anno per il dettaglio — esclusi giroconti/doppi conteggi)</span></h2>
		<InOutBars bars={data.yearly.map((y) => ({ label: y.label, moneyIn: y.moneyIn, moneyOut: y.moneyOut }))} onselect={(l) => setFilters({ year: l, month: '' })} />
	</section>

	{#if data.filters.year}
		<section class="card">
			<h2>
				Dettaglio {data.filters.year}
				<span class="muted sub-h">(clic su un mese per filtrare i movimenti)</span>
			</h2>
			<InOutBars bars={data.monthly.map((m) => ({ label: m.label, moneyIn: m.moneyIn, moneyOut: m.moneyOut }))} height={200} onselect={(l) => setFilters({ month: l.slice(5) })} />
		</section>
	{/if}

	<div class="two-col">
		<section class="card">
			<h2>Uscite per categoria — {periodLabel}</h2>
			{#if donutSlices.length === 0}
				<p class="muted">Nessuna uscita nel periodo.</p>
			{:else}
				<Donut slices={donutSlices} title="Uscite" />
			{/if}
		</section>

		<section class="card">
			<h2>Categorie più impattanti <span class="muted sub-h">vs stesso periodo anno prec.</span></h2>
			<table class="data compact">
				<thead>
					<tr><th>Categoria</th><th class="num">Uscite</th><th class="num">Δ</th></tr>
				</thead>
				<tbody>
					{#each topCats as c (c.category)}
						{@const prev = prevOutByCat.get(c.category) ?? 0}
						<tr>
							<td class="cat-cell">
								<CategoryIcon category={c.category} icon={metaOf(c.category).icon} color={metaOf(c.category).color} size={15} />
								<button class="linklike" type="button" onclick={() => setFilters({ category: c.category })}>{c.category}</button>
							</td>
							<td class="num">{fmtEur(c.moneyOut)}</td>
							<td class="num">
								{#if prev > 0 && data.filters.year}
									<span class={c.moneyOut > prev ? 'delta-up' : 'delta-down'}>
										{c.moneyOut > prev ? '+' : ''}{(((c.moneyOut - prev) / prev) * 100).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%
									</span>
								{:else}
									<span class="muted">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	</div>
{/if}

<section class="card">
	<div class="sec-head">
		<h2>Movimenti <span class="muted sub-h">({data.movements.length}{data.movementsTotal > data.movements.length ? ` di ${data.movementsTotal}` : ''})</span></h2>
		<div class="head-actions">
			<a class="btn ghost" href="/api/expenses/export" download>Esporta CSV</a>
			<a class="btn ghost" href="/admin">Gestione →</a>
		</div>
	</div>

	<div class="filters">
		<label class="field">
			Anno
			<select value={data.filters.year} onchange={(e) => setFilters({ year: e.currentTarget.value, month: '' })}>
				<option value="">tutti</option>
				{#each data.years as y (y)}<option value={y}>{y}</option>{/each}
			</select>
		</label>
		<label class="field">
			Mese
			<select value={data.filters.month} onchange={(e) => setFilters({ month: e.currentTarget.value })}>
				<option value="">tutti</option>
				{#each MONTH_NAMES as m, i (m)}<option value={String(i + 1).padStart(2, '0')}>{m}</option>{/each}
			</select>
		</label>
		<label class="field">
			Categoria
			<select value={data.filters.category} onchange={(e) => setFilters({ category: e.currentTarget.value })}>
				<option value="">tutte</option>
				{#each allCategories as c (c)}<option value={c}>{c}</option>{/each}
			</select>
		</label>
		<label class="field">
			Card
			<select value={data.filters.card} onchange={(e) => setFilters({ card: e.currentTarget.value })}>
				<option value="">tutte</option>
				{#each data.cards as c (c)}<option value={c}>{c}</option>{/each}
			</select>
		</label>
		<label class="field grow">
			Cerca
			<input type="search" value={data.filters.q} placeholder="descrizione…" onchange={(e) => setFilters({ q: e.currentTarget.value })} />
		</label>
		<button class="btn ghost" type="button" onclick={() => setFilters({ year: '', month: '', category: '', card: '', q: '' })}>Azzera</button>
	</div>

	{#if form?.section === 'movimenti' && form.error}<p class="error">{form.error}</p>{/if}

	{#if data.movements.length === 0}
		<p class="muted">Nessun movimento con questi filtri.</p>
	{:else}
		<datalist id="cats">
			{#each allCategories as c (c)}<option value={c}></option>{/each}
		</datalist>
		<div class="scroll-x">
			<table class="data">
				<thead>
					<tr>
						<th>Data</th>
						<th>Categoria</th>
						<th>Descrizione</th>
						<th>Card</th>
						<th class="num">Importo</th>
					</tr>
				</thead>
				<tbody>
					{#each data.movements as m (m.id)}
						<tr>
							<td class="nowrap">{fmtDate(m.date)}</td>
							<td class="cat-cell">
								<CategoryIcon category={m.category} icon={metaOf(m.category).icon} color={metaOf(m.category).color} size={15} />
								<form method="POST" action="?/updateCategory" use:enhance class="inline-edit">
									<input type="hidden" name="id" value={m.id} />
									<input class="cat-input" type="text" name="category" list="cats" value={m.category} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
								</form>
							</td>
							<td class="desc-cell" title={m.description}>{m.description}</td>
							<td class="nowrap">{@render cardBadge(m.card)}</td>
							<td class={['num', 'nowrap', m.amount < 0 ? 'neg' : 'pos']}>{fmtEur(m.amount)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if data.movementsTotal > data.movements.length}
			<p class="muted hint">Mostrati i primi {data.limit}: restringi i filtri per vedere il resto.</p>
		{/if}
	{/if}
</section>

<style>
	.page-title {
		font-size: 1.7rem;
		margin-bottom: 1.2rem;
	}
	section.card {
		margin-bottom: 1rem;
	}
	.sub-h {
		font-size: 0.75rem;
		font-weight: 400;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.8rem;
		margin-bottom: 1rem;
	}
	.chips {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.chips-label {
		font-size: 0.78rem;
		color: var(--ink-3);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.78rem;
		padding: 0.25rem 0.7rem;
		border-radius: 999px;
		border: 1px solid rgba(57, 135, 229, 0.45);
		background: rgba(57, 135, 229, 0.12);
		color: #86b6ef;
		cursor: pointer;
	}
	.chip:hover {
		background: rgba(57, 135, 229, 0.22);
	}
	.chip .x {
		font-size: 0.68rem;
		opacity: 0.8;
	}
	.chip.clear-all {
		border-color: var(--border-strong);
		background: transparent;
		color: var(--ink-2);
	}
	.chip.clear-all:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.two-col {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	@media (max-width: 1100px) {
		.two-col {
			grid-template-columns: 1fr;
		}
	}
	.sec-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.head-actions {
		display: flex;
		gap: 0.6rem;
	}
	.filters {
		display: flex;
		gap: 0.8rem;
		align-items: end;
		flex-wrap: wrap;
		margin: 0.6rem 0 1rem;
	}
	.filters .grow {
		flex: 1;
		min-width: 160px;
	}
	.muted {
		color: var(--ink-3);
	}
	.nowrap {
		white-space: nowrap;
	}
	.cat-cell {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		white-space: nowrap;
	}
	.cat-input {
		width: 140px;
		padding: 0.2rem 0.4rem;
		font-size: 0.8rem;
		background: transparent;
		border-color: transparent;
	}
	.cat-input:hover,
	.cat-input:focus {
		border-color: var(--border-strong);
		background: var(--surface-2);
	}
	.inline-edit {
		display: inline;
	}
	.desc-cell {
		max-width: 420px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-2);
	}
	.card-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		white-space: nowrap;
	}
	.card-badge img {
		border-radius: 4px;
		object-fit: contain;
		background: var(--surface-2);
	}
	td.pos {
		color: var(--good);
	}
	td.neg {
		color: #f0a3a3;
	}
	.linklike {
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		padding: 0;
	}
	.linklike:hover {
		color: var(--accent);
	}
	.delta-up {
		color: var(--bad);
	}
	.delta-down {
		color: var(--good);
	}
	table.compact th,
	table.compact :global(td) {
		padding-top: 0.35rem;
		padding-bottom: 0.35rem;
	}
	.error {
		color: var(--bad);
		margin: 0.8rem 0 0;
		font-size: 0.85rem;
	}
	.hint {
		margin: 0.9rem 0 0;
		font-size: 0.78rem;
		color: var(--ink-3);
	}
	.link {
		color: var(--accent);
		font-weight: 600;
	}
	.scroll-x {
		overflow-x: auto;
	}
</style>
