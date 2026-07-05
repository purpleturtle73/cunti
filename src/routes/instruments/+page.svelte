<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtDate } from '$lib/format';

	let { data, form } = $props();

	let type = $state('etf');
</script>

<svelte:head><title>Cunti — Strumenti</title></svelte:head>

<h1 class="page-title">Strumenti</h1>

<section class="card">
	<h2>Nuovo strumento</h2>
	<form method="POST" action="?/create" use:enhance class="inst-form">
		<label class="field">
			Tipo
			<select name="type" bind:value={type}>
				<option value="etf">ETF (Borsa Italiana)</option>
				<option value="crypto">Crypto</option>
			</select>
		</label>
		<label class="field">
			{type === 'etf' ? 'Ticker Yahoo (es. SWDA.MI)' : 'ID CoinGecko (es. bitcoin)'}
			<input type="text" name="symbol" placeholder={type === 'etf' ? 'SWDA.MI' : 'bitcoin'} required />
		</label>
		<label class="field">
			Nome
			<input type="text" name="name" placeholder={type === 'etf' ? 'iShares Core MSCI World' : 'Bitcoin'} required />
		</label>
		{#if type === 'etf'}
			<label class="field">
				ISIN
				<input type="text" name="isin" placeholder="IE00B4L5Y983" />
			</label>
			<label class="field">
				TER % annuo
				<input type="text" inputmode="decimal" name="ter_pct" placeholder="0,20" value="0,20" />
			</label>
			<label class="field">
				Aliquota plusvalenze %
				<input type="text" inputmode="decimal" name="tax_rate_pct" value="26" />
			</label>
		{/if}
		<button class="btn" type="submit">Aggiungi e scarica storico</button>
	</form>
	{#if form?.error}
		<p class="error">{form.error}</p>
	{/if}
	{#if form?.warning}
		<p class="warning">{form.warning}</p>
	{/if}
	<p class="hint">
		ETF: usa il ticker Yahoo Finance con suffisso <code>.MI</code> (quotazione EUR su Borsa Italiana).
		Crypto: usa l'<em>ID</em> CoinGecko (minuscolo, es. <code>bitcoin</code>, <code>ethereum</code>) —
		prezzi in EUR, storico max 365 giorni con l'API gratuita. Aliquota 26% standard; abbassala per ETF
		con quota di titoli di stato whitelist (tassati al 12,5%).
	</p>
</section>

<section class="card">
	<h2>I tuoi strumenti ({data.instruments.length})</h2>
	{#if data.instruments.length === 0}
		<p class="muted">Nessuno strumento. Aggiungine uno qui sopra.</p>
	{:else}
		<div class="scroll-x">
			<table class="data">
				<thead>
					<tr>
						<th>Nome</th>
						<th>Simbolo</th>
						<th></th>
						<th>ISIN</th>
						<th class="num">TER %</th>
						<th class="num">Aliquota %</th>
						<th class="num">Operazioni</th>
						<th class="num">Ultimo prezzo</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.instruments as inst (inst.id)}
						<tr>
							<td><a class="pos-link" href="/positions/{inst.id}">{inst.name}</a></td>
							<td><code>{inst.symbol}</code></td>
							<td><span class="badge {inst.type}">{inst.type}</span></td>
							<td>{inst.isin ?? '—'}</td>
							<td class="num">
								<form method="POST" action="?/update" use:enhance class="inline-edit">
									<input type="hidden" name="id" value={inst.id} />
									<input type="hidden" name="tax_rate_pct" value={inst.tax_rate_pct} />
									<input class="mini" type="text" inputmode="decimal" name="ter_pct" value={inst.ter_pct} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
								</form>
							</td>
							<td class="num">
								<form method="POST" action="?/update" use:enhance class="inline-edit">
									<input type="hidden" name="id" value={inst.id} />
									<input type="hidden" name="ter_pct" value={inst.ter_pct} />
									<input class="mini" type="text" inputmode="decimal" name="tax_rate_pct" value={inst.tax_rate_pct} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
								</form>
							</td>
							<td class="num">{inst.tx_count}</td>
							<td class="num">{inst.last_price_date ? fmtDate(inst.last_price_date) : '—'}</td>
							<td>
								<form
									method="POST"
									action="?/delete"
									use:enhance
									onsubmit={(e) => {
										if (!confirm(`Eliminare ${inst.name}? Verranno rimosse anche le sue ${inst.tx_count} transazioni e lo storico prezzi.`)) e.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={inst.id} />
									<button class="del" type="submit" title="Elimina" aria-label="Elimina strumento">✕</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
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
	.inst-form {
		display: grid;
		grid-template-columns: 1fr 1.2fr 1.6fr 1fr 0.7fr 0.7fr;
		gap: 0.8rem;
		align-items: end;
	}
	@media (max-width: 1000px) {
		.inst-form {
			grid-template-columns: 1fr 1fr;
		}
	}
	.hint {
		margin: 0.9rem 0 0;
		font-size: 0.78rem;
		color: var(--ink-3);
		max-width: 70rem;
	}
	.hint code {
		background: var(--surface-2);
		border-radius: 4px;
		padding: 0.05rem 0.3rem;
	}
	.error {
		color: var(--bad);
		margin: 0.8rem 0 0;
		font-size: 0.85rem;
	}
	.warning {
		color: var(--series-3);
		margin: 0.8rem 0 0;
		font-size: 0.85rem;
	}
	.muted {
		color: var(--ink-3);
	}
	.mini {
		width: 60px;
		text-align: right;
		padding: 0.25rem 0.4rem;
	}
	.inline-edit {
		display: inline;
	}
	.del {
		background: none;
		border: none;
		color: var(--ink-3);
		cursor: pointer;
		font-size: 0.85rem;
		padding: 0.2rem 0.4rem;
		border-radius: 6px;
	}
	.del:hover {
		color: var(--bad);
		background: rgba(230, 103, 103, 0.12);
	}
	.pos-link {
		font-weight: 600;
	}
	.pos-link:hover {
		color: var(--accent);
	}
	.scroll-x {
		overflow-x: auto;
	}
</style>
