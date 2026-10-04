<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { suggestKeyword } from '$lib/keywords';
	import AreaChart from '$lib/components/AreaChart.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import CategoryIcon from '$lib/components/CategoryIcon.svelte';
	import Donut from '$lib/components/Donut.svelte';
	import InOutBars from '$lib/components/InOutBars.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import { cardGroupLabel, matchCard } from '$lib/cards';
	import { categoryColor } from '$lib/expense-icons';
	import { fmtDate, fmtEur, signClass } from '$lib/format';

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
		goto(`/finanze?${p}`, { keepFocus: true, noScroll: true });
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
		goto(`/finanze?${p}`, { keepFocus: true, noScroll: true });
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

	// Paginazione dei movimenti: cambiare filtri o ordinamento riparte da pagina 1
	// (setFilters/sortBy ricostruiscono i parametri senza `pag`).
	function goPage(n: number) {
		const p = new URLSearchParams(page.url.searchParams);
		if (n <= 1) p.delete('pag');
		else p.set('pag', String(n));
		goto(`/finanze?${p}`, { keepFocus: true, noScroll: true }).then(() =>
			document.getElementById('movimenti')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
		);
	}
	let pageFrom = $derived((data.pagination.page - 1) * data.limit + 1);
	let pageTo = $derived(pageFrom + data.movements.length - 1);

	/** Voce per cui è aperto il modulo "Crea regola". */
	let ruleFor = $state<number | null>(null);

	let editingBudgets = $state(false);
	let budgetLabel = $derived(
		data.budget.kind === 'month'
			? `${MONTH_NAMES[Number(data.budget.key.slice(5)) - 1]} ${data.budget.key.slice(0, 4)}`
			: `${data.budget.key} (12 mesi)`
	);
	const pctLabel = (v: number) => (v * 100).toLocaleString('it-IT', { maximumFractionDigits: 0 }) + '%';

	// Grafico del saldo cumulato: periodo scelto con le pill, come in Investimenti.
	// La variazione di una pill è saldo finale − saldo del giorno prima dell'inizio.
	const BAL_PERIODS: { key: string; label: string; days: number | 'ytd' | 'max' }[] = [
		{ key: '1w', label: '1S', days: 7 },
		{ key: '1m', label: '1M', days: 30 },
		{ key: '3m', label: '3M', days: 91 },
		{ key: '6m', label: '6M', days: 182 },
		{ key: 'ytd', label: 'YTD', days: 'ytd' },
		{ key: '1y', label: '1A', days: 365 },
		{ key: 'max', label: 'MAX', days: 'max' }
	];
	let balPeriod = $state('1y');
	let balStats = $derived.by(() => {
		const s = data.balance;
		if (s.length === 0) return [];
		const lastDate = s[s.length - 1].date;
		const lastValue = s[s.length - 1].value;
		return BAL_PERIODS.map((p) => {
			let start: string;
			if (p.days === 'max') start = s[0].date;
			else if (p.days === 'ytd') start = lastDate.slice(0, 4) + '-01-01';
			else {
				const dt = new Date(lastDate + 'T00:00:00Z');
				dt.setUTCDate(dt.getUTCDate() - p.days);
				start = dt.toISOString().slice(0, 10);
			}
			const i = s.findIndex((pt) => pt.date >= start);
			const base = i > 0 ? s[i - 1].value : 0;
			return { ...p, start, delta: lastValue - base };
		});
	});
	let balSelected = $derived(balStats.find((p) => p.key === balPeriod));
	let balPoints = $derived(balSelected ? data.balance.filter((p) => p.date >= balSelected.start) : []);

	const RECURRING_SHOWN = 25;
	let recurringPeriodTotal = $derived(data.recurring.reduce((s, r) => s + r.periodTotal, 0));

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
	// versione corta per le etichette delle tile (strette): "ott 2026", "2026", "storico"
	let periodShort = $derived(
		data.filters.year
			? data.filters.month
				? `${MONTH_NAMES[Number(data.filters.month) - 1].slice(0, 3)} ${data.filters.year}`
				: data.filters.year
			: 'storico'
	);

	let saldoYtd = $derived(data.tiles.ytdIn - data.tiles.ytdOut);

	// filtri oltre al periodo: le tile entrate/uscite li seguono, va detto
	let hasExtraFilters = $derived(
		!!(data.filters.category || data.filters.card || data.filters.q || data.filters.exCategories.length || data.filters.exCards.length)
	);
	/** Sottotitolo delle tile entrate/uscite: media mensile (se il periodo copre più mesi). */
	function periodSub(total: number): string {
		// con una categoria scelta i giroconti non vengono esclusi (vedi filteredInOut)
		const parts = [
			data.filters.category
				? 'con i filtri attivi'
				: hasExtraFilters
					? 'con i filtri attivi, esclusi giroconti'
					: 'esclusi giroconti/doppi conteggi'
		];
		if (data.monthsInPeriod > 1 && total > 0) parts.push(`media ${fmtEur(total / data.monthsInPeriod)}/mese`);
		return parts.join(' · ');
	}
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

<svelte:head><title>Cunti — Finanze</title></svelte:head>

<h1 class="page-title">Finanze Personali</h1>

{#if !data.hasExpenses}
	<section class="card">
		<h2>Nessun movimento registrato</h2>
		<p class="muted">
			Importa il tuo storico CSV da <a class="link" href="/admin/finanze">Admin</a> (sezione "Finanze: importa CSV"),
			oppure prova l'app con i <a class="link" href="/admin/finanze#demo">dati demo</a>.
		</p>
	</section>
{:else}
	<div class="tiles">
		<StatTile label="Entrate · {periodShort}" value={fmtEur(data.tiles.periodIn)} tone={data.tiles.periodIn > 0 ? 'pos' : 'neutral'} sub={periodSub(data.tiles.periodIn)} />
		<StatTile label="Uscite · {periodShort}" value={fmtEur(data.tiles.periodOut)} tone={data.tiles.periodOut > 0 ? 'neg' : 'neutral'} sub={periodSub(data.tiles.periodOut)} />
		<StatTile label="Saldo {data.tiles.curYear}" value={fmtEur(saldoYtd)} tone={saldoYtd >= 0 ? 'pos' : 'neg'} sub="entrate − uscite, esclusi giroconti/doppi conteggi" />
		{#if data.tiles.topCatMonth}
			<StatTile label="Top del mese" value={data.tiles.topCatMonth.name} sub="categoria con più uscite · {fmtEur(data.tiles.topCatMonth.out)}" />
		{/if}
		<StatTile
			label="Categorizzate"
			value={(coveragePct * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%'}
			tone={coveragePct >= 0.95 ? 'pos' : coveragePct >= 0.8 ? 'neutral' : 'neg'}
			sub="{periodShort} · {data.coverage.unknown.toLocaleString('it-IT')} voci ancora unknown: i totali per categoria sono incompleti di questa quota"
		/>
		{#if data.recurringActive.monthly > 0}
			<StatTile
				label="Ricorrenti"
				value="{fmtEur(data.recurringActive.monthly)}/mese"
				sub="{data.recurringActive.count} attive, stimate — {fmtEur(data.recurringActive.monthly * 12)}/anno"
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
			· le regole si gestiscono in <a class="link" href="/admin/finanze/categorie">Categorie</a>
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

	<section class="card chart-card">
		<div class="chart-head">
			<h2>
				Andamento — saldo cumulato
				{#if balSelected}
					<span class={['chart-delta', 'tabular', signClass(balSelected.delta)]}>
						{balSelected.delta > 0 ? '+' : ''}{fmtEur(balSelected.delta)} nel periodo
					</span>
				{/if}
			</h2>
			<div class="pills" role="tablist" aria-label="Periodo del grafico">
				{#each balStats as p (p.key)}
					<button
						type="button"
						role="tab"
						aria-selected={balPeriod === p.key}
						class={['pill', { active: balPeriod === p.key }]}
						onclick={() => (balPeriod = p.key)}
					>
						<span class="pill-label">{p.label}</span>
						<span class={['pill-delta', 'tabular', signClass(p.delta)]}>{p.delta > 0 ? '+' : ''}{fmtEur(p.delta, true)}</span>
					</button>
				{/each}
			</div>
		</div>
		<AreaChart
			points={balPoints}
			height={280}
			showInvested={false}
			valueLabel="Saldo"
			ariaLabel="Andamento del saldo cumulato"
			emptyText="Servono movimenti in almeno due giorni diversi."
		/>
		<p class="muted hint">
			Entrate − uscite accumulate dal primo movimento importato (che parte da 0): quanto hai messo da parte, non il
			saldo del conto. Giroconti esclusi salvo che tu filtri proprio quella categoria. Segue categoria, card, esclusioni
			e ricerca; il periodo si sceglie con i pulsanti qui sopra, non con anno e mese.
		</p>
	</section>

	<section class="card budget-card">
		<div class="sec-head">
			<h2>
				Budget — {budgetLabel}
				{#if data.budget.rows.length > 0}
					<span class="muted sub-h">
						{fmtEur(data.budget.totalSpent)} di {fmtEur(data.budget.totalBudget)}
						{#if data.budget.over > 0}· <span class="neg">{data.budget.over} oltre il budget</span>{/if}
					</span>
				{/if}
			</h2>
			{#if !editingBudgets}
				<button class="btn ghost sm-btn" type="button" onclick={() => (editingBudgets = true)}>
					{data.budget.rows.length > 0 ? 'Modifica budget' : 'Imposta i budget'}
				</button>
			{/if}
		</div>
		{#if form?.section === 'budget'}
			{#if form.error}<p class="error">{form.error}</p>{/if}
			{#if 'success' in form && form.success}<p class="ok-msg">{form.success}</p>{/if}
		{/if}

		{#if editingBudgets}
			<form
				method="POST"
				action="?/saveBudgets"
				use:enhance={() =>
					async ({ update, result }) => {
						await update({ reset: false });
						if (result.type === 'success') editingBudgets = false;
					}}
			>
				<p class="muted hint">Budget mensile di spesa in euro; vuoto = nessun budget. I giroconti non hanno budget.</p>
				<div class="budget-edit">
					{#each data.budgetCategories as c (c.name)}
						<label class="field">
							<span class="budget-edit-name">
								<CategoryIcon category={c.name} icon={metaOf(c.name).icon} color={metaOf(c.name).color} size={14} />
								{c.name}
							</span>
							<input type="text" inputmode="decimal" name="b:{c.name}" value={c.monthly ?? ''} placeholder="—" />
						</label>
					{/each}
				</div>
				<div class="budget-actions">
					<button class="btn" type="submit">Salva budget</button>
					<button class="btn ghost" type="button" onclick={() => (editingBudgets = false)}>Annulla</button>
				</div>
			</form>
		{:else if data.budget.rows.length === 0}
			<p class="muted">
				Nessun budget impostato. Dai un tetto mensile alle categorie che vuoi tenere d'occhio: qui vedrai quanto ne hai
				già usato e se stai spendendo più in fretta del previsto.
			</p>
		{:else}
			<ul class="budget-list">
				{#each data.budget.rows as r (r.category)}
					<li class={['budget-row', r.state]}>
						<span class="budget-cat">
							<CategoryIcon category={r.category} icon={metaOf(r.category).icon} color={metaOf(r.category).color} size={15} />
							<button class="linklike" type="button" onclick={() => setFilters({ category: r.category })}>{r.category}</button>
						</span>
						<span class="budget-bar" title={r.expected != null ? `In linea a oggi: ${fmtEur(r.expected)}` : undefined}>
							<i class="fill" style:width="{Math.min(100, r.pct * 100)}%"></i>
							{#if r.expected != null}<i class="pace" style:left="{Math.min(100, (r.expected / r.budget) * 100)}%"></i>{/if}
						</span>
						<span class="budget-num tabular">
							{fmtEur(r.spent)} <span class="muted">/ {fmtEur(r.budget)}</span>
						</span>
						<span class="budget-pct tabular">
							{#if r.state === 'over'}+{fmtEur(r.spent - r.budget)}{:else}{pctLabel(r.pct)}{/if}
						</span>
					</li>
				{/each}
			</ul>
			<p class="muted hint">
				{#if data.budget.pace != null}
					La tacca verticale indica la spesa in linea a oggi ({pctLabel(data.budget.pace)} del periodo trascorso).
				{/if}
				Arancione: oltre il 90% del budget, o più del 10% sopra il ritmo (dopo il primo quinto del periodo); rosso:
				sforato. Conta le uscite della categoria su tutte le
				card. Il periodo segue anno e mese dei filtri (solo anno = budget × 12; nessun anno = mese corrente).
			</p>
		{/if}
	</section>

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
										<span class="bar-track"><i class="bar" style:width="{(c.moneyOut / cardOutMax) * 100}%"></i></span>
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
						Nessuna card configurata: aggiungile in <a class="link" href="/admin/finanze">Admin</a> per
						loghi e raggruppamento per brand.
					</p>
				{/if}
			{/if}
		</section>

		<section class="card">
			<h2>Ricorrenti — {periodLabel} <span class="muted sub-h">stima euristica, da rileggere</span></h2>
			{#if data.recurring.length === 0}
				<p class="muted">Nessuna uscita ricorrente con questi filtri.</p>
			{:else}
				<p class="rec-summary">
					<strong>{fmtEur(recurringPeriodTotal)}</strong> in {data.recurring.length}
					{data.recurring.length === 1 ? 'voce' : 'voci'}
					{#if data.recurringOutflow > 0}
						<span class="muted">
							· {((recurringPeriodTotal / data.recurringOutflow) * 100).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%
							delle uscite filtrate ({fmtEur(data.recurringOutflow)})
						</span>
					{/if}
				</p>
				<div class="scroll-y">
					<table class="data compact">
						<thead>
							<tr><th>Voce</th><th class="num">Importo</th><th class="num">Nel periodo</th><th>Ultima</th></tr>
						</thead>
						<tbody>
							{#each data.recurring.slice(0, RECURRING_SHOWN) as r (r.label)}
								<tr class={{ dim: !r.active }}>
									<td class="desc-cell" title="{r.label} — ricorrente in {r.months} mesi dal {fmtDate(r.first)}">{r.label}</td>
									<td class="num nowrap">{fmtEur(r.amount)}</td>
									<td class="num nowrap">{fmtEur(r.periodTotal)} <span class="muted">×{r.periodCount}</span></td>
									<td class="nowrap muted">{fmtDate(r.last)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if data.recurring.length > RECURRING_SHOWN}
					<p class="muted hint">Mostrate le prime {RECURRING_SHOWN} di {data.recurring.length}; il totale sopra le comprende tutte.</p>
				{/if}
				<p class="muted hint">
					Ricorrente = descrizione simile e importo stabile (±15%) in almeno 4 mesi distinti, cercata su tutto lo
					storico che passa i filtri di categoria, card e ricerca; qui compaiono quelle con addebiti nel periodo.
					Importo = mediana. In grigio: non viste da oltre 90 giorni.
				</p>
			{/if}
		</section>
	</div>
{/if}

<section class="card" id="movimenti">
	<div class="sec-head">
		<h2>
			Movimenti
			<span class="muted sub-h">
				({data.pagination.pages > 1 ? `${pageFrom.toLocaleString('it-IT')}–${pageTo.toLocaleString('it-IT')} di ` : ''}{data.movementsTotal.toLocaleString('it-IT')})
			</span>
		</h2>
		<div class="head-actions">
			<a class="btn ghost" href="/api/expenses/export" download>Esporta CSV</a>
			<a class="btn ghost" href="/admin/finanze">Gestione →</a>
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
	{#if form?.section === 'regola'}
		{#if form.error}<p class="error">{form.error}</p>{/if}
		{#if 'success' in form && form.success}
			<p class="ok-msg">
				{form.success}
				{#if (form.newConflicts ?? 0) > 0}
					<a class="link" href="/admin/finanze/conflitti">{form.newConflicts} voci già categorizzate ora sono in conflitto con le regole →</a>
				{/if}
			</p>
		{/if}
	{/if}

	{#if data.movements.length === 0}
		<p class="muted">Nessun movimento con questi filtri.</p>
	{:else}
		<datalist id="cats">
			{#each allCategories as c (c)}<option value={c}></option>{/each}
		</datalist>
		<Pager page={data.pagination.page} pages={data.pagination.pages} onpage={goPage} label="Pagine dei movimenti" />
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
						<th class="actions-col"><span class="sr-only">Azioni</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.movements as m (m.id)}
						<tr class={{ 'rule-open': ruleFor === m.id }}>
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
							<td class="actions-col">
								<button
									class="rule-btn"
									type="button"
									title="Crea una regola da questa voce"
									aria-label="Crea una regola da questa voce"
									aria-expanded={ruleFor === m.id}
									onclick={() => (ruleFor = ruleFor === m.id ? null : m.id)}
								>⚑</button>
							</td>
						</tr>
						{#if ruleFor === m.id}
							<tr class="rule-row">
								<td colspan="6">
									<form
										method="POST"
										action="?/createRule"
										class="rule-form"
										use:enhance={() =>
											async ({ update, result }) => {
												await update();
												if (result.type === 'success') ruleFor = null;
											}}
									>
										<input type="hidden" name="id" value={m.id} />
										<label class="field grow">
											Keyword (deve comparire nella descrizione)
											<input type="text" name="keyword" value={suggestKeyword(m.description)} required minlength="3" />
										</label>
										<label class="field">
											Categoria
											<select name="category" required>
												<option value="" disabled selected={!data.definedCategories.includes(m.category)}>scegli…</option>
												{#each data.definedCategories as c (c)}
													<option value={c} selected={c === m.category}>{c}</option>
												{/each}
											</select>
										</label>
										<label class="check">
											<input type="checkbox" name="apply" checked />
											applica subito alle voci senza categoria
										</label>
										<button class="btn" type="submit">Crea regola</button>
										<button class="btn ghost" type="button" onclick={() => (ruleFor = null)}>Annulla</button>
									</form>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
		<Pager page={data.pagination.page} pages={data.pagination.pages} onpage={goPage} label="Pagine dei movimenti" />
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
		color: var(--accent-ink);
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
		background: var(--hover);
	}
	.two-col {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	/* senza min-width: 0 una tabella larga allarga la colonna oltre la griglia */
	.two-col > :global(*) {
		min-width: 0;
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
		color: var(--bad-ink);
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
		overflow: auto;
	}
	.scroll-y .desc-cell {
		max-width: 240px;
	}
	.rec-summary {
		margin: 0 0 0.6rem;
		font-size: 0.9rem;
	}

	/* budget per categoria */
	.budget-card .sec-head {
		margin-bottom: 0.6rem;
	}
	.budget-card .sec-head h2 {
		margin-bottom: 0;
	}
	.sm-btn {
		padding: 0.3rem 0.8rem;
		font-size: 0.82rem;
	}
	.budget-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.budget-row {
		display: grid;
		grid-template-columns: minmax(130px, 1.2fr) 3fr minmax(150px, auto) 70px;
		align-items: center;
		gap: 0.8rem;
		font-size: 0.88rem;
	}
	.budget-cat {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
	}
	.budget-bar {
		position: relative;
		height: 9px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		overflow: visible;
	}
	.budget-bar .fill {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: 999px;
		background: var(--accent);
	}
	.budget-row.warn .fill {
		background: var(--series-3);
	}
	.budget-row.over .fill {
		background: var(--bad);
	}
	.budget-bar .pace {
		position: absolute;
		top: -4px;
		bottom: -4px;
		width: 2px;
		margin-left: -1px;
		background: var(--ink-2);
		border-radius: 1px;
	}
	.budget-num {
		text-align: right;
		white-space: nowrap;
	}
	.budget-pct {
		text-align: right;
		font-weight: 600;
		white-space: nowrap;
	}
	.budget-row.over .budget-pct {
		color: var(--bad);
	}
	.budget-row.warn .budget-pct {
		color: var(--series-3);
	}
	@media (max-width: 700px) {
		.budget-row {
			grid-template-columns: 1fr auto;
		}
		.budget-bar {
			grid-column: 1 / -1;
			order: 3;
		}
	}
	.budget-edit {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 0.7rem;
		margin: 0.6rem 0 0.9rem;
	}
	.budget-edit .field {
		text-transform: none;
		letter-spacing: 0;
	}
	.budget-edit-name {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		color: var(--ink-2);
	}
	.budget-edit input {
		width: 100%;
		text-align: right;
	}
	.budget-actions {
		display: flex;
		gap: 0.6rem;
	}

	/* "Crea regola da questa voce" */
	.actions-col {
		width: 1%;
		text-align: right;
	}
	.rule-btn {
		background: none;
		border: none;
		color: var(--ink-3);
		cursor: pointer;
		font-size: 0.9rem;
		padding: 0.15rem 0.35rem;
		border-radius: 6px;
	}
	.rule-btn:hover,
	tr.rule-open .rule-btn {
		color: var(--accent);
		background: var(--hover);
	}
	tr.rule-row td {
		background: var(--surface-2);
		white-space: normal;
	}
	.rule-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.7rem;
	}
	.rule-form .grow {
		flex: 1 1 260px;
	}
	.rule-form input[type='text'] {
		width: 100%;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		color: var(--ink-2);
		padding-bottom: 0.55rem;
	}
	.ok-msg {
		color: var(--good-ink);
		font-size: 0.85rem;
		margin: 0.4rem 0 0.6rem;
	}
	.ok-msg .link {
		margin-left: 0.4rem;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	/* grafico saldo cumulato: pill di periodo come in Investimenti */
	.chart-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.4rem;
	}
	.chart-delta {
		margin-left: 0.6rem;
		font-size: 0.8rem;
		text-transform: none;
		letter-spacing: 0;
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
		padding: 0.35rem 0.6rem;
		cursor: pointer;
		color: var(--ink-2);
		font: inherit;
		min-width: 54px;
	}
	.pill:hover {
		border-color: var(--border-strong);
	}
	.pill.active {
		border-color: var(--accent);
		background: var(--selected);
		color: var(--ink);
	}
	.pill-label {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	.pill-delta {
		font-size: 0.7rem;
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
	/* binario a larghezza fissa: la barra è una % del binario, non della cella, così
	   non sborda sulla colonna accanto quando la tabella è stretta */
	.bar-track {
		display: flex;
		justify-content: flex-end;
		width: 72px;
		flex: none;
	}
	.bar-cell .bar {
		display: block;
		height: 7px;
		min-width: 2px;
		border-radius: 999px;
		background: var(--grad);
		opacity: 0.75;
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
