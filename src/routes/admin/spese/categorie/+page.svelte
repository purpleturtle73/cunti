<script lang="ts">
	import { enhance } from '$app/forms';
	import CategoryIcon from '$lib/components/CategoryIcon.svelte';
	import { ICON_NAMES } from '$lib/expense-icons';
	import { fmtDate, fmtEur } from '$lib/format';

	let { data, form } = $props();

	let filter = $state('');
	let shown = $derived(
		filter.trim()
			? data.categories.filter(
					(c) =>
						c.name.toLowerCase().includes(filter.trim().toLowerCase()) ||
						c.keywords.some((k) => k.keyword.toLowerCase().includes(filter.trim().toLowerCase()))
				)
			: data.categories
	);

	let msgFor = $derived((target: string) =>
		form?.section === 'cat' && form.target === target ? form : null
	);

	let totalKeywords = $derived(data.categories.reduce((s, c) => s + c.keywords.length, 0));
</script>

<svelte:head><title>Cunti — Amministrazione · Categorie</title></svelte:head>

{#snippet feedback(target: string)}
	{@const f = msgFor(target)}
	{#if f}
		{#if 'error' in f && f.error}<p class="error">{f.error}</p>{/if}
		{#if 'message' in f && f.message}<p class="ok">{f.message}</p>{/if}
		{#if 'skipped' in f && f.skipped && f.skipped.length > 0}
			<details class="skipped">
				<summary class="muted">{f.skipped.length} keyword scartate</summary>
				<ul>
					{#each f.skipped as s (s.keyword + s.category)}
						<li><code>{s.keyword}</code> per «{s.category}»: {s.reason}</li>
					{/each}
				</ul>
			</details>
		{/if}
	{/if}
{/snippet}

{@render feedback('')}

<section class="card">
	<h2>Ricategorizza le voci senza categoria</h2>
	{#if data.unknownRun.unknown === 0}
		<p class="muted">Nessuna voce senza categoria.</p>
	{:else}
		<p>
			{data.unknownRun.unknown.toLocaleString('it-IT')} voci senza categoria;
			<strong class="ok-text">{data.unknownRun.matched.toLocaleString('it-IT')}</strong>
			corrispondono alle regole attuali.
			<span class="muted">Le voci con categoria bloccata a mano non vengono toccate.</span>
		</p>
		{#if data.unknownRun.byCategory.length > 0}
			<div class="chips-row">
				{#each data.unknownRun.byCategory as b (b.category)}
					<span class="kw-chip static">{b.category} <b>{b.count}</b></span>
				{/each}
			</div>
			<form method="POST" action="?/runRules" use:enhance>
				<button class="btn" type="submit">Applica alle {data.unknownRun.matched} voci</button>
			</form>
		{:else}
			<p class="muted hint">Aggiungi keyword alle categorie qui sotto: questo riquadro si aggiorna a ogni modifica.</p>
		{/if}
	{/if}
	{#if data.conflicts > 0}
		<p class="hint">
			<a class="link" href="/admin/spese/conflitti">{data.conflicts.toLocaleString('it-IT')} voci in conflitto con le regole →</a>
		</p>
	{/if}
</section>

<section class="card">
	<h2>Nuova categoria, import ed export</h2>
	<div class="tools-grid">
		<form method="POST" action="?/createCategory" use:enhance class="new-cat">
			<label class="field">
				Nome
				<input type="text" name="name" placeholder="es. animali" required maxlength="60" />
			</label>
			<label class="field">
				Icona
				<select name="icon">
					<option value="">—</option>
					{#each ICON_NAMES as i (i)}<option value={i}>{i}</option>{/each}
				</select>
			</label>
			<label class="check">
				<input type="checkbox" name="transfer" value="1" /> giroconto
			</label>
			<button class="btn" type="submit">Crea</button>
		</form>

		<div class="io">
			<form
				method="POST"
				action="?/importJson"
				enctype="multipart/form-data"
				use:enhance
				class="import-json"
				onsubmit={(e) => {
					const mode = new FormData(e.currentTarget).get('mode');
					if (
						mode === 'replace' &&
						!confirm('Sostituire TUTTE le categorie e keyword con quelle del file? Le spese non vengono toccate. Viene creato un backup prima.')
					)
						e.preventDefault();
				}}
			>
				<input type="file" name="file" accept=".json,application/json" required />
				<select name="mode" aria-label="Modalità di import">
					<option value="merge">aggiungi a quelle esistenti</option>
					<option value="replace">sostituisci tutte</option>
				</select>
				<button class="btn ghost" type="submit">Importa JSON</button>
			</form>
			<div class="io-links">
				<a class="btn ghost sm" href="/api/expenses/categories/export" download>Esporta JSON</a>
				<form method="POST" action="?/loadStarter" use:enhance class="inline">
					<button class="btn ghost sm" type="submit" title="Aggiunge le categorie suggerite che non hai già; non tocca le esistenti">
						Aggiungi set suggerito
					</button>
				</form>
				<a class="link small" href="/api/expenses/categories/starter" download>scarica il set suggerito</a>
			</div>
		</div>
	</div>
	<p class="muted hint">
		Il JSON accetta il formato storico <code>{'{'} "categoria": ["keyword", …] {'}'}</code> oppure quello
		esteso dell'export, con icona e flag giroconto. Una keyword appartiene a una sola categoria: quelle
		già presenti altrove vengono scartate e segnalate. Il match è sulla descrizione, senza maiuscole, e
		vince la keyword più lunga: evita keyword corte e comuni («bar» trova anche «barbiere»).
	</p>
</section>

{#if data.warnings.length > 0}
	<section class="card">
		<h2>Keyword sospette</h2>
		<ul class="warnings">
			{#each data.warnings as w (w)}<li>{w}</li>{/each}
		</ul>
	</section>
{/if}

<section class="card">
	<div class="sec-head">
		<h2>Categorie <span class="muted sub-h">({data.categories.length} · {totalKeywords} keyword)</span></h2>
		<input class="filter" type="search" placeholder="filtra per nome o keyword…" bind:value={filter} />
	</div>

	{#if data.categories.length === 0}
		<p class="muted">
			Nessuna categoria definita. Creane una qui sopra, importa un JSON o aggiungi il set suggerito.
		</p>
	{/if}

	<div class="cat-grid">
		{#each shown as c (c.name)}
			<article class="cat-card" id="cat-{c.name}">
				<header>
					<CategoryIcon category={c.name} icon={c.icon ?? undefined} color={c.color ?? undefined} size={18} />
					<strong class="cat-name">{c.name}</strong>
					{#if c.transfer}<span class="tag">giroconto</span>{/if}
					<span class="muted usage" title="voci con questa categoria · uscite totali · ultima voce">
						{c.usage.count.toLocaleString('it-IT')} voci{c.usage.out > 0 ? ` · ${fmtEur(c.usage.out)}` : ''}{c.usage.last
							? ` · ${fmtDate(c.usage.last)}`
							: ''}
					</span>
				</header>

				<div class="kw-list">
					{#each c.keywords as k (k.id)}
						<form method="POST" action="?/removeKeyword" use:enhance class="kw-chip">
							<input type="hidden" name="id" value={k.id} />
							<input type="hidden" name="category" value={c.name} />
							<span>{k.keyword}</span>
							<button type="submit" title="Rimuovi keyword" aria-label="Rimuovi {k.keyword}">✕</button>
						</form>
					{:else}
						<span class="muted small">nessuna keyword: la categoria si assegna solo a mano</span>
					{/each}
				</div>

				<form method="POST" action="?/addKeyword" use:enhance class="kw-add">
					<input type="hidden" name="category" value={c.name} />
					<input type="text" name="keyword" placeholder="aggiungi keyword…" required maxlength="120" />
					<button class="btn ghost sm" type="submit">+</button>
				</form>

				{@render feedback(c.name)}

				<details class="cat-more">
					<summary>Modifica</summary>
					<form method="POST" action="?/updateMeta" use:enhance class="row-form">
						<input type="hidden" name="name" value={c.name} />
						<select name="icon" aria-label="Icona">
							<option value="">— icona automatica</option>
							{#each ICON_NAMES as i (i)}<option value={i} selected={c.icon === i}>{i}</option>{/each}
						</select>
						<label class="check">
							<input type="checkbox" name="transfer" value="1" checked={c.transfer} /> giroconto (escluso dai totali)
						</label>
						<button class="btn ghost sm" type="submit">Salva</button>
					</form>
					<form method="POST" action="?/renameCategory" use:enhance class="row-form">
						<input type="hidden" name="old" value={c.name} />
						<input type="text" name="new" list="cat-names" placeholder="nuovo nome o categoria in cui unirla" required />
						<button class="btn ghost sm" type="submit">Rinomina / unisci</button>
					</form>
					<form
						method="POST"
						action="?/deleteCategory"
						use:enhance
						class="row-form"
						onsubmit={(e) => {
							if (
								!confirm(
									`Eliminare la categoria "${c.name}" e le sue ${c.keywords.length} keyword? Le ${c.usage.count} voci che la usano torneranno senza categoria.`
								)
							)
								e.preventDefault();
						}}
					>
						<input type="hidden" name="name" value={c.name} />
						<button class="btn danger sm" type="submit">Elimina categoria</button>
					</form>
				</details>
			</article>
		{/each}
	</div>
	<datalist id="cat-names">
		{#each data.categories as c (c.name)}<option value={c.name}></option>{/each}
	</datalist>
</section>

{#if data.undefinedUsed.length > 0}
	<section class="card">
		<h2>Usate dalle spese ma non definite <span class="muted sub-h">({data.undefinedUsed.length})</span></h2>
		<p class="muted">
			Categorie arrivate dagli import CSV o assegnate a mano. Puoi definirle (per dar loro keyword e
			icona) oppure unirle in una categoria esistente.
		</p>
		<div class="scroll-x">
			<table class="data compact">
				<thead>
					<tr><th>Categoria</th><th class="num">Voci</th><th class="num">Uscite</th><th>Ultima</th><th></th><th>Unisci in</th></tr>
				</thead>
				<tbody>
					{#each data.undefinedUsed as u (u.name)}
						<tr>
							<td><code>{u.name}</code></td>
							<td class="num">{u.count.toLocaleString('it-IT')}</td>
							<td class="num">{fmtEur(u.out)}</td>
							<td class="nowrap">{u.last ? fmtDate(u.last) : '—'}</td>
							<td>
								<form method="POST" action="?/createCategory" use:enhance class="inline">
									<input type="hidden" name="name" value={u.name} />
									<button class="btn ghost sm" type="submit">Definisci</button>
								</form>
							</td>
							<td>
								<form method="POST" action="?/renameCategory" use:enhance class="row-form">
									<input type="hidden" name="old" value={u.name} />
									<select name="new" required aria-label="Categoria di destinazione">
										<option value="">—</option>
										{#each data.categories as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
									</select>
									<button class="btn ghost sm" type="submit">Unisci</button>
								</form>
								{@render feedback(u.name)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

<section class="card">
	<h2>Strumenti</h2>
	<form method="POST" action="?/testDescription" use:enhance class="row-form">
		<input class="grow" type="text" name="description" placeholder="incolla una descrizione per vedere quale categoria vincerebbe…" required />
		<button class="btn ghost" type="submit">Prova</button>
	</form>
	{#if form?.section === 'cat-test' && 'test' in form && form.test}
		<p class="test-result">
			«{form.test.description}» →
			<strong>{form.test.category}</strong>
			{#if form.test.keyword}<span class="muted">(keyword «{form.test.keyword}»)</span>{:else}<span class="muted">(nessuna keyword corrisponde)</span>{/if}
		</p>
	{/if}

	<form method="POST" action="?/keywordReport" use:enhance class="report-form">
		<button class="btn ghost" type="submit">Report utilizzo keyword</button>
		<span class="muted small">quante voci trova ogni keyword: quelle a zero si possono togliere</span>
	</form>
	{#if form?.section === 'cat-report' && 'report' in form && form.report}
		<div class="scroll-x report">
			<table class="data compact">
				<thead><tr><th>Keyword</th><th>Categoria</th><th class="num">Voci</th><th>Ultima</th></tr></thead>
				<tbody>
					{#each form.report as r (r.keyword)}
						<tr class={{ dead: r.matches === 0 }}>
							<td><code>{r.keyword}</code></td>
							<td>{r.category}</td>
							<td class="num">{r.matches}</td>
							<td class="nowrap">{r.last ? fmtDate(r.last) : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.sub-h {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
	}
	.chips-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.6rem 0 0.9rem;
	}
	.tools-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.2rem;
		align-items: start;
	}
	@media (max-width: 1000px) {
		.tools-grid {
			grid-template-columns: 1fr;
		}
	}
	.new-cat {
		display: flex;
		gap: 0.6rem;
		align-items: end;
		flex-wrap: wrap;
	}
	.io {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.import-json,
	.io-links,
	.row-form,
	.report-form {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.row-form {
		margin-top: 0.5rem;
	}
	.row-form .grow,
	.row-form input[type='text'] {
		flex: 1;
		min-width: 12rem;
	}
	.report-form {
		margin-top: 1rem;
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.82rem;
		color: var(--ink-2);
	}
	.small {
		font-size: 0.78rem;
	}
	.filter {
		min-width: 16rem;
		padding: 0.35rem 0.6rem;
		font-size: 0.85rem;
	}
	.cat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
		gap: 0.8rem;
		margin-top: 0.8rem;
	}
	.cat-card {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.8rem 0.9rem;
		background: var(--surface-2);
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.cat-card header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.cat-name {
		font-size: 0.95rem;
	}
	.usage {
		margin-left: auto;
		font-size: 0.75rem;
	}
	.tag {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		color: var(--ink-3);
	}
	.kw-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.kw-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.12rem 0.2rem 0.12rem 0.55rem;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--border);
		font-size: 0.78rem;
	}
	.kw-chip.static {
		padding-right: 0.55rem;
	}
	.kw-chip button {
		background: none;
		border: none;
		color: var(--ink-3);
		cursor: pointer;
		font-size: 0.7rem;
		padding: 0.05rem 0.3rem;
		border-radius: 999px;
	}
	.kw-chip button:hover {
		color: var(--bad);
		background: rgba(230, 103, 103, 0.12);
	}
	.kw-add {
		display: flex;
		gap: 0.4rem;
	}
	.kw-add input {
		flex: 1;
		padding: 0.3rem 0.55rem;
		font-size: 0.82rem;
	}
	.cat-more summary {
		cursor: pointer;
		font-size: 0.78rem;
		color: var(--ink-3);
	}
	.cat-more summary:hover {
		color: var(--ink);
	}
	.warnings {
		margin: 0;
		padding-left: 1.2rem;
		font-size: 0.85rem;
		color: var(--ink-2);
	}
	.skipped {
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
	}
	.skipped ul {
		margin: 0.3rem 0 0;
		padding-left: 1.2rem;
	}
	.test-result {
		margin: 0.6rem 0 0;
		font-size: 0.9rem;
	}
	.report {
		margin-top: 0.6rem;
		max-height: 420px;
		overflow-y: auto;
	}
	.inline {
		display: inline;
	}
</style>
