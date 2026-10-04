<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import CategoryIcon from '$lib/components/CategoryIcon.svelte';
	import Donut from '$lib/components/Donut.svelte';
	import InOutBars from '$lib/components/InOutBars.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import { cardGroupLabel, matchCard } from '$lib/cards';
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

	// abbinamento per prefisso: la card configurata "Mastercard" copre
	// "MASTERCARD - 1234" e ogni altro numero dello stesso brand
	let logoOf = $derived((name: string) => matchCard(name, data.cardLogos));

	const RESET = {
		year: '',
		month: '',
		category: '',
		card: '',
		q: '',
		esclcat: '',
		esclcard: ''
	};

	function setFilters(patch: Record<string, string>) {
		const f = {
			...data.filters,
			esclcat: data.filters.exCategories.join(','),
			esclcard: data.filters.exCards.join(','),
			...patch
		};
		const p = new URLSearchParams();
		p.set('anno', f.year); // sempre esplicito: '' = tutti gli anni
		if (f.month) p.set('mese', f.month);
		if (f.category) p.set('categoria', f.category);
		if (f.card) p.set('card', f.card);
		if (f.esclcat) p.set('esclcat', f.esclcat);
		if (f.esclcard) p.set('esclcard', f.esclcard);
		if (f.q) p.set('q', f.q);
		if (data.sort.key !== 'date') p.set('ord', data.sort.key);
		if (data.sort.dir !== 'desc') p.set('dir', data.sort.dir);
		goto(`/spese?${p}`, { keepFocus: true, noScroll: true });
	}

	/** Aggiunge/toglie un valore da una lista di esclusione. */
	function toggleExclude(kind: 'esclcat' | 'esclcard', value: string) {
		const cur = kind === 'esclcat' ? data.filters.exCategories : data.filters.exCards;
		const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
		setFilters({ [kind]: next.join(',') });
	}

	/** Clic su un'intestazione: stessa colonna → inverte, altra colonna → riparte. */
	function sortBy(key: 'date' | 'amount' | 'category' | 'card' | 'description') {
		const dir = data.sort.key === key && data.sort.dir === 'desc' ? 'asc' : 'desc';
		const p = new URLSearchParams();
		p.set('anno', data.filters.year);
		if (data.filters.month) p.set('mese', data.filters.month);
		if (data.filters.category) p.set('categoria', data.filters.category);
		if (data.filters.card) p.set('card', data.filters.card);
		if (data.filters.exCategories.length) p.set('esclcat', data.filters.exCategories.join(','));
		if (data.filters.exCards.length) p.set('esclcard', data.filters.exCards.join(','));
		if (data.filters.q) p.set('q', data.filters.q);
		if (key !== 'date') p.set('ord', key);
		if (dir !== 'desc') p.set('dir', dir);
		goto(`/spese?${p}`, { keepFocus: true, noScroll: true });
	}

	let activeChips = $derived.by(() => {
		const chips: { label: string; clear: Record<string, string> }[] = [];
		if (data.filters.year) chips.push({ label: `anno: ${data.filters.year}`, clear: { year: '', month: '' } });
		if (data.filters.month) chips.push({ label: `mese: ${MONTH_NAMES[Number(data.filters.month) - 1]}`, clear: { month: '' } });
		if (data.filters.category) chips.push({ label: `categoria: ${data.filters.category}`, clear: { category: '' } });
		if (data.filters.card) chips.push({ label: `card: ${data.filters.card}`, clear: { card: '' } });
		for (const c of data.filters.exCategories)
			chips.push({
				label: `esclusa categoria: ${c}`,
				clear: { esclcat: data.filters.exCategories.filter((x) => x !== c).join(',') }
			});
		for (const c of data.filters.exCards)
			chips.push({
				label: `esclusa card: ${c}`,
				clear: { esclcard: data.filters.exCards.filter((x) => x !== c).join(',') }
			});
		if (data.filters.q) chips.push({ label: `cerca: “${data.filters.q}”`, clear: { q: '' } });
		return chips;
	});

	// card raggruppate sul nome configurato (il brand), non sul numero di carta
	let cardRollup = $derived.by(() => {
		const byLabel = new Map<string, { label: string; moneyOut: number; moneyIn: number; count: number }>();
		for (const t of data.cardTotals) {
			const label = cardGroupLabel(t.card, data.cardLogos);
			const e = byLabel.get(label) ?? { label, moneyOut: 0, moneyIn: 0, count: 0 };
			e.moneyOut += t.moneyOut;
			e.moneyIn += t.moneyIn;
			e.count += t.count;
			byLabel.set(label, e);
		}
		return [...byLabel.values()].sort((a, b) => b.moneyOut - a.moneyOut);
	});
	let cardOutMax = $derived(Math.max(1, ...cardRollup.map((c) => c.moneyOut)));

	let coveragePct = $derived(
		data.coverage.total > 0
			? (data.coverage.total - data.coverage.unknown) / data.coverage.total
			: 1
	);

	let recurringMonthly = $derived(
		data.recurring.filter((r) => r.active).reduce((s, r) => s + r.amount, 0)
	);

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
	{@const c = logoOf(name)}
	<span class="card-badge" title={c && c.name !== name ? `${name} — card “${c.name}”` : name}>
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
			Importa il tuo storico CSV da <a class="link" href="/admin/spese">Amministrazione</a> (sezione "Spese: importa CSV").
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
		<StatTile
			label="Categorizzate — {periodLabel}"
			value={(coveragePct * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%'}
			tone={coveragePct >= 0.95 ? 'pos' : coveragePct >= 0.8 ? 'neutral' : 'neg'}
			sub="{data.coverage.unknown.toLocaleString('it-IT')} voci ancora unknown: i totali per categoria sono incompleti di questa quota"
		/>
		{#if recurringMonthly > 0}
			<StatTile
				label="Ricorrenti attive"
				value="{fmtEur(recurringMonthly)}/mese"
				sub="{data.recurring.filter((r) => r.active).length} voci stimate — {fmtEur(recurringMonthly * 12)}/anno"
			/>
		{/if}
	</div>

	{#if data.coverage.unknown > 0}
		<p class="coverage-hint muted">
			<button class="linklike" type="button" onclick={() => setFilters({ category: 'unknown', esclcat: '' })}>
				Vedi le {data.coverage.unknown.toLocaleString('it-IT')} voci unknown
			</button>
			·
			<button class="linklike" type="button" onclick={() => toggleExclude('esclcat', 'unknown')}>
				{data.filters.exCategories.includes('unknown') ? 'Reincludi' : 'Escludi'} unknown dalle statistiche
			</button>
			· le regole si gestiscono in <a class="link" href="/admin/spese/categorie">Categorie</a>
		</p>
	{/if}

	{#if activeChips.length > 0}
		<div class="chips">
			<span class="chips-label">Filtri:</span>
			{#each activeChips as chip (chip.label)}
				<button class="chip" type="button" onclick={() => setFilters(chip.clear)} title="Rimuovi filtro">
					{chip.label} <span class="x">✕</span>
				</button>
			{/each}
			<button class="chip clear-all" type="button" onclick={() => setFilters(RESET)}>
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
			<h2>
				Categorie più impattanti
				<span class="muted sub-h">media su {data.monthsInPeriod} {data.monthsInPeriod === 1 ? 'mese' : 'mesi'} con dati · Δ vs stesso periodo anno prec.</span>
			</h2>
			<table class="data compact">
				<thead>
					<tr>
						<th>Categoria</th>
						<th class="num">Uscite</th>
						<th class="num">Media/mese</th>
						<th class="num">Δ</th>
						<th></th>
					</tr>
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
							<td class="num muted">{fmtEur(c.moneyOut / data.monthsInPeriod)}</td>
							<td class="num">
								{#if prev > 0 && data.filters.year}
									<span class={c.moneyOut > prev ? 'delta-up' : 'delta-down'}>
										{c.moneyOut > prev ? '+' : ''}{(((c.moneyOut - prev) / prev) * 100).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%
									</span>
								{:else}
									<span class="muted">—</span>
								{/if}
							</td>
							<td class="num">
								<button
									class="excl"
									type="button"
									title="Escludi “{c.category}” dai filtri"
									aria-label="Escludi {c.category}"
									onclick={() => toggleExclude('esclcat', c.category)}
								>⊘</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	</div>

	{#if data.filters.category && data.categoryTrend.length > 0}
		<section class="card">
			<h2>
				Andamento “{data.filters.category}”
				<span class="muted sub-h">{data.filters.year ? `per mese nel ${data.filters.year}` : 'per anno, tutto lo storico'}</span>
			</h2>
			<InOutBars
				bars={data.categoryTrend.map((t) => ({ label: t.label, moneyIn: t.moneyIn, moneyOut: t.moneyOut }))}
				height={200}
				onselect={(l) => setFilters(data.filters.year ? { month: l.slice(5) } : { year: l, month: '' })}
			/>
		</section>
	{/if}

	<div class="two-col">
		<section class="card">
			<h2>Spesa per card — {periodLabel}</h2>
			{#if cardRollup.length === 0}
				<p class="muted">Nessun movimento nel periodo.</p>
			{:else}
				<table class="data compact">
					<thead>
						<tr><th>Card</th><th class="num">Uscite</th><th class="num">Movimenti</th><th></th></tr>
					</thead>
					<tbody>
						{#each cardRollup as c (c.label)}
							<tr>
								<td class="nowrap">{@render cardBadge(c.label)}</td>
								<td class="num">
									<span class="bar-cell">
										<i class="bar" style:width="{(c.moneyOut / cardOutMax) * 100}%"></i>
										<span>{fmtEur(c.moneyOut)}</span>
									</span>
								</td>
								<td class="num muted">{c.count.toLocaleString('it-IT')}</td>
								<td class="num">
									<button
										class="excl"
										type="button"
										title="Escludi “{c.label}” dai filtri"
										aria-label="Escludi {c.label}"
										onclick={() => toggleExclude('esclcard', c.label)}
									>⊘</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if data.cardLogos.length === 0}
					<p class="muted hint">
						Nessuna card configurata: aggiungile in <a class="link" href="/admin/spese">Amministrazione</a> per
						loghi e raggruppamento per brand.
					</p>
				{/if}
			{/if}
		</section>

		<section class="card">
			<h2>Ricorrenti <span class="muted sub-h">stima euristica, da rileggere</span></h2>
			{#if data.recurring.length === 0}
				<p class="muted">Nessuna uscita ricorrente riconosciuta.</p>
			{:else}
				<div class="scroll-y">
					<table class="data compact">
						<thead>
							<tr><th>Voce</th><th class="num">Importo</th><th class="num">Mesi</th><th>Ultima</th></tr>
						</thead>
						<tbody>
							{#each data.recurring.slice(0, 25) as r (r.label)}
								<tr class={{ dim: !r.active }}>
									<td class="desc-cell" title={r.label}>{r.label}</td>
									<td class="num nowrap">{fmtEur(r.amount)}</td>
									<td class="num muted">{r.months}</td>
									<td class="nowrap muted">{fmtDate(r.last)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="muted hint">
					Uscite con descrizione ricorrente e importo stabile (±15%) in almeno 4 mesi distinti.
					Le righe in grigio non compaiono da oltre 90 giorni. Gli importi mostrati sono la mediana.
				</p>
			{/if}
		</section>
	</div>
{/if}

<section class="card">
	<div class="sec-head">
		<h2>Movimenti <span class="muted sub-h">({data.movements.length}{data.movementsTotal > data.movements.length ? ` di ${data.movementsTotal}` : ''})</span></h2>
		<div class="head-actions">
			<a class="btn ghost" href="/api/expenses/export" download>Esporta CSV</a>
			<a class="btn ghost" href="/admin/spese">Gestione →</a>
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
		<label class="field">
			Escludi categoria
			<select
				value=""
				onchange={(e) => {
					const v = e.currentTarget.value;
					e.currentTarget.value = '';
					if (v) toggleExclude('esclcat', v);
				}}
			>
				<option value="">—</option>
				{#each allCategories.filter((c) => !data.filters.exCategories.includes(c)) as c (c)}
					<option value={c}>{c}</option>
				{/each}
			</select>
		</label>
		<label class="field grow">
			Cerca
			<input type="search" value={data.filters.q} placeholder="descrizione…" onchange={(e) => setFilters({ q: e.currentTarget.value })} />
		</label>
		<button class="btn ghost" type="button" onclick={() => setFilters(RESET)}>Azzera</button>
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
						{#each [
							{ key: 'date', label: 'Data', num: false },
							{ key: 'category', label: 'Categoria', num: false },
							{ key: 'description', label: 'Descrizione', num: false },
							{ key: 'card', label: 'Card', num: false },
							{ key: 'amount', label: 'Importo', num: true }
						] as const as col (col.key)}
							<th class={[{ num: col.num }, 'sortable']} aria-sort={data.sort.key === col.key ? (data.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
								<button type="button" onclick={() => sortBy(col.key)} title="Ordina per {col.label.toLowerCase()}">
									{col.label}<span class="arrow">{data.sort.key === col.key ? (data.sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
								</button>
							</th>
						{/each}
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
								{#if m.category_manual}
									<form method="POST" action="?/unlockCategory" use:enhance class="inline-edit">
										<input type="hidden" name="id" value={m.id} />
										<button
											class="lock"
											type="submit"
											title="Categoria scelta a mano: le regole non la toccano. Clic per sbloccare."
											aria-label="Sblocca la categoria"
										>🔒</button>
									</form>
								{/if}
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
	.scroll-y {
		max-height: 340px;
		overflow-y: auto;
	}

	/* intestazioni ordinabili */
	th.sortable {
		padding: 0;
	}
	th.sortable button {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		cursor: pointer;
		padding: 0.5rem 0.75rem;
	}
	th.num.sortable button {
		justify-content: flex-end;
	}
	th.sortable button:hover {
		color: var(--ink);
	}
	th.sortable .arrow {
		font-size: 0.7em;
		opacity: 0.5;
	}
	th.sortable[aria-sort='ascending'] .arrow,
	th.sortable[aria-sort='descending'] .arrow {
		opacity: 1;
		color: var(--accent);
	}

	/* pulsante "escludi dai filtri" */
	.excl {
		background: none;
		border: none;
		color: var(--ink-3);
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
		padding: 0.1rem 0.3rem;
		border-radius: 6px;
	}
	.excl:hover {
		color: var(--bad);
		background: rgba(230, 103, 103, 0.12);
	}

	.coverage-hint {
		margin: 0 0 1rem;
		font-size: 0.8rem;
	}

	/* barra in cella per la spesa per card */
	.bar-cell {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: flex-end;
		width: 100%;
	}
	.bar-cell .bar {
		display: block;
		height: 7px;
		min-width: 2px;
		border-radius: 999px;
		background: var(--grad);
		opacity: 0.75;
		flex: none;
		max-width: 110px;
	}
	tr.dim td {
		color: var(--ink-3);
	}
	.lock {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.72rem;
		padding: 0 0.2rem;
		opacity: 0.55;
	}
	.lock:hover {
		opacity: 1;
	}
</style>
