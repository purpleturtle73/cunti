<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtDate, fmtEur } from '$lib/format';

	let { data, form } = $props();

	let today = new Date().toISOString().slice(0, 10);
</script>

<svelte:head><title>Cunti — Transazioni</title></svelte:head>

<h1 class="page-title">Transazioni</h1>

<section class="card">
	<h2>Nuova operazione</h2>
	{#if data.instruments.length === 0}
		<p class="muted">Prima <a class="link" href="/instruments">aggiungi uno strumento</a>.</p>
	{:else}
		<form method="POST" action="?/create" use:enhance class="tx-form">
			<label class="field">
				Strumento
				<select name="instrument_id" required>
					{#each data.instruments as inst (inst.id)}
						<option value={inst.id}>{inst.name} ({inst.symbol})</option>
					{/each}
				</select>
			</label>
			<label class="field">
				Tipo
				<select name="type">
					<option value="buy">Acquisto</option>
					<option value="sell">Vendita</option>
				</select>
			</label>
			<label class="field">
				Data
				<input type="date" name="date" value={today} max={today} required />
			</label>
			<label class="field">
				Quantità
				<input type="text" inputmode="decimal" name="quantity" placeholder="es. 12" required />
			</label>
			<label class="field">
				Prezzo unitario €
				<input type="text" inputmode="decimal" name="price" placeholder="es. 98,54" required />
			</label>
			<label class="field">
				Commissioni €
				<input type="text" inputmode="decimal" name="fee" placeholder="es. 5,00" value="0" />
			</label>
			<label class="field notes">
				Note
				<input type="text" name="notes" placeholder="opzionale" />
			</label>
			<button class="btn" type="submit">Aggiungi</button>
		</form>
		{#if form?.error}
			<p class="error">{form.error}</p>
		{/if}
	{/if}
</section>

<section class="card">
	<h2>Storico ({data.transactions.length})</h2>
	{#if data.transactions.length === 0}
		<p class="muted">Nessuna operazione registrata.</p>
	{:else}
		<div class="scroll-x">
			<table class="data">
				<thead>
					<tr>
						<th>Data</th>
						<th>Strumento</th>
						<th>Tipo</th>
						<th class="num">Quantità</th>
						<th class="num">Prezzo</th>
						<th class="num">Commissioni</th>
						<th class="num">Controvalore</th>
						<th>Note</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.transactions as tx (tx.id)}
						<tr>
							<td>{fmtDate(tx.date)}</td>
							<td>{tx.instrument_name}</td>
							<td>
								<span class={['side', tx.type]}>{tx.type === 'buy' ? 'Acquisto' : 'Vendita'}</span>
							</td>
							<td class="num">{tx.quantity.toLocaleString('it-IT', { maximumFractionDigits: 8 })}</td>
							<td class="num">{fmtEur(tx.price)}</td>
							<td class="num">{fmtEur(tx.fee)}</td>
							<td class="num">{fmtEur(tx.quantity * tx.price + (tx.type === 'buy' ? tx.fee : -tx.fee))}</td>
							<td class="notes-cell">{tx.notes ?? ''}</td>
							<td>
								<form
									method="POST"
									action="?/delete"
									use:enhance
									onsubmit={(e) => {
										if (!confirm('Eliminare questa transazione?')) e.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={tx.id} />
									<button class="del" type="submit" title="Elimina" aria-label="Elimina transazione">✕</button>
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
	.tx-form {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr 1fr 1fr 1fr;
		gap: 0.8rem;
		align-items: end;
	}
	.tx-form :global(input),
	.tx-form :global(select) {
		width: 100%;
		min-width: 0;
	}
	.tx-form .field {
		min-width: 0;
	}
	.tx-form .notes {
		grid-column: span 5;
	}
	@media (max-width: 1000px) {
		.tx-form {
			grid-template-columns: 1fr 1fr;
		}
		.tx-form .notes {
			grid-column: span 2;
		}
	}
	.muted {
		color: var(--ink-3);
	}
	.link {
		color: var(--accent);
		font-weight: 600;
	}
	.error {
		color: var(--bad);
		margin: 0.8rem 0 0;
		font-size: 0.85rem;
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
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ink-2);
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
	.scroll-x {
		overflow-x: auto;
	}
</style>
