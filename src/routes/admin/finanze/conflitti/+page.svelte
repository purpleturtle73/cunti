<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtDate, fmtEur } from '$lib/format';

	let { data, form } = $props();
</script>

<svelte:head><title>Cunti — Admin · Conflitti</title></svelte:head>

<section class="card">
	<div class="sec-head">
		<h2>
			{data.locked ? 'Decisioni bloccate' : 'Conflitti da rivedere'}
			<span class="muted sub-h">({data.total.toLocaleString('it-IT')} voci)</span>
		</h2>
		<nav class="views" aria-label="Vista">
			<a href="/admin/finanze/conflitti" class={{ active: !data.locked }} aria-current={!data.locked ? 'page' : undefined}>
				Da rivedere{!data.locked ? '' : ` (${data.otherCount.toLocaleString('it-IT')})`}
			</a>
			<a
				href="/admin/finanze/conflitti?vista=bloccate"
				class={{ active: data.locked }}
				aria-current={data.locked ? 'page' : undefined}
			>
				Bloccate da te{data.locked ? '' : ` (${data.otherCount.toLocaleString('it-IT')})`}
			</a>
		</nav>
	</div>

	<p class="muted intro">
		{#if data.locked}
			Voci in cui hai scelto di tenere la tua categoria anche se le regole direbbero altro. Le regole non
			le toccano. «Sblocca» le rimette tra quelle da rivedere; «Applica regola» le cambia subito.
		{:else}
			Voci con una categoria diversa da quella che assegnerebbero le regole attuali, raggruppate per
			coppia «attuale → regole». <strong>Applica regola</strong> cambia la categoria;
			<strong>Tieni la mia</strong> la blocca, e da quel momento le regole non la toccano più. Se un
			gruppo intero è sbagliato, spesso conviene correggere la keyword in
			<a class="link" href="/admin/finanze/categorie">Categorie</a>.
		{/if}
	</p>

	{#if form?.error}<p class="error">{form.error}</p>{/if}
	{#if form?.message}<p class="ok">{form.message}</p>{/if}

	{#if data.groups.length === 0}
		<p class="muted empty">
			{data.locked ? 'Nessuna decisione bloccata in conflitto con le regole.' : 'Nessun conflitto: le categorie coincidono con le regole.'}
		</p>
	{/if}
</section>

{#each data.groups as g (g.category + '→' + g.ruleCategory)}
	<section class="card group">
		<div class="group-head">
			<div class="pair">
				<code>{g.category}</code>
				<span class="arrow">→</span>
				<code class="rule">{g.ruleCategory}</code>
				<span class="muted count">{g.count.toLocaleString('it-IT')} voci</span>
			</div>
			<div class="group-actions">
				<form method="POST" action="?/group" use:enhance>
					<input type="hidden" name="category" value={g.category} />
					<input type="hidden" name="ruleCategory" value={g.ruleCategory} />
					<input type="hidden" name="locked" value={data.locked ? '1' : '0'} />
					<button class="btn sm" type="submit" name="act" value="accept">Applica regola a tutte</button>
					{#if data.locked}
						<button class="btn ghost sm" type="submit" name="act" value="unlock">Sblocca tutte</button>
					{:else}
						<button class="btn ghost sm" type="submit" name="act" value="keep">Tieni la mia per tutte</button>
					{/if}
				</form>
			</div>
		</div>
		<p class="muted kws">
			keyword: {#each g.keywords.slice(0, 8) as k, i (k)}{i > 0 ? ', ' : ''}<code>{k}</code>{/each}{g.keywords.length > 8
				? ` e altre ${g.keywords.length - 8}`
				: ''}
		</p>

		<details open={g.count <= 10}>
			<summary class="muted">Mostra le voci</summary>
			<div class="scroll-x">
				<table class="data compact">
					<thead>
						<tr><th>Data</th><th>Descrizione</th><th>Card</th><th class="num">Importo</th><th>Keyword</th><th></th></tr>
					</thead>
					<tbody>
						{#each g.items as it (it.id)}
							<tr>
								<td class="nowrap">{fmtDate(it.date)}</td>
								<td class="desc-cell" title={it.description}>{it.description}</td>
								<td class="nowrap muted">{it.card}</td>
								<td class={['num', 'nowrap', it.amount < 0 ? 'neg' : 'pos']}>{fmtEur(it.amount)}</td>
								<td><code>{it.keyword}</code></td>
								<td class="nowrap">
									<form method="POST" action="?/item" use:enhance class="item-actions">
										<input type="hidden" name="id" value={it.id} />
										<button class="act" type="submit" name="act" value="accept" title="Applica la categoria «{g.ruleCategory}»">→ {g.ruleCategory}</button>
										{#if data.locked}
											<button class="act" type="submit" name="act" value="unlock" title="Togli il blocco">sblocca</button>
										{:else}
											<button class="act" type="submit" name="act" value="keep" title="Tieni «{g.category}» e bloccala">tieni</button>
										{/if}
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if g.hidden > 0}
				<p class="muted hint">
					Mostrate le {g.items.length} più recenti; altre {g.hidden.toLocaleString('it-IT')} sono incluse
					nelle azioni di gruppo.
				</p>
			{/if}
		</details>
	</section>
{/each}

<style>
	.sub-h {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
	}
	.views {
		display: flex;
		gap: 0.3rem;
	}
	.views a {
		padding: 0.3rem 0.7rem;
		border-radius: var(--radius-sm);
		font-size: 0.82rem;
		color: var(--ink-2);
		border: 1px solid var(--border);
	}
	.views a.active {
		color: var(--ink);
		border-color: rgba(57, 135, 229, 0.5);
		background: rgba(57, 135, 229, 0.12);
	}
	.intro {
		font-size: 0.85rem;
		max-width: 70rem;
	}
	.empty {
		margin: 0.4rem 0 0;
	}
	.group {
		padding-top: 0.9rem;
	}
	.group-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.pair {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.pair code {
		font-size: 0.88rem;
		padding: 0.12rem 0.45rem;
		border-radius: 6px;
		background: var(--surface-2);
	}
	.pair code.rule {
		color: var(--accent-ink);
	}
	.arrow {
		color: var(--ink-3);
	}
	.count {
		font-size: 0.8rem;
	}
	.group-actions form {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.kws {
		margin: 0.5rem 0 0.3rem;
		font-size: 0.78rem;
	}
	details summary {
		cursor: pointer;
		font-size: 0.8rem;
		margin: 0.2rem 0 0.4rem;
	}
	.desc-cell {
		max-width: 420px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	td.neg {
		color: var(--bad-ink);
	}
	td.pos {
		color: var(--good-ink);
	}
	.item-actions {
		display: inline-flex;
		gap: 0.2rem;
	}
	.act {
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--ink-2);
		cursor: pointer;
		font-size: 0.74rem;
		padding: 0.12rem 0.45rem;
	}
	.act:hover {
		color: var(--ink);
		border-color: var(--border-strong);
	}
</style>
