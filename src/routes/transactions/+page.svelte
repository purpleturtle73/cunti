<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtCurrency, fmtDate } from '$lib/format';

	let { data, form } = $props();

	let today = new Date().toISOString().slice(0, 10);

	let selectedInstrumentId = $state<number | undefined>();

	// Nei menu lo strumento si sceglie per ticker, quindi l'ordine è per ticker:
	// allInstruments() ordina per nome (giusto altrove, arbitrario in una lista di simboli).
	let instrumentsByTicker = $derived(
		[...data.instruments].sort((a, b) => a.symbol.localeCompare(b.symbol))
	);

	let formCurrency = $derived(
		data.instruments.find((i) => i.id === Number(selectedInstrumentId))?.currency ??
			instrumentsByTicker[0]?.currency ??
			'EUR'
	);
	let ccySymbol = $derived(formCurrency === 'EUR' ? '€' : formCurrency);

	let editingId = $state<number | null>(null);
</script>

{#snippet typeIcon(type: string)}
	<span class={['type-ico', type]} title={type === 'crypto' ? 'Crypto' : 'ETF'}>
		{#if type === 'crypto'}
			<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<circle cx="12" cy="12" r="9" />
				<path d="M9.5 7.5h3.5a2 2 0 0 1 0 4H9.5zM9.5 11.5h4a2 2 0 0 1 0 4h-4zM10.5 6v1.5M10.5 15.5V17" />
			</svg>
		{:else}
			<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M4 19 10 12 14 15 20 6M20 6v5M20 6h-5" />
			</svg>
		{/if}
	</span>
{/snippet}

<svelte:head><title>Cunti — Transazioni</title></svelte:head>

<h1 class="page-title">Transazioni</h1>

<section class="card">
	<h2>Nuova operazione</h2>
	{#if data.instruments.length === 0}
		<p class="muted">Prima <a class="link" href="/admin">aggiungi uno strumento</a> in Amministrazione.</p>
	{:else}
		<form method="POST" action="?/create" use:enhance class="tx-form">
			<label class="field">
				Strumento
				<select name="instrument_id" bind:value={selectedInstrumentId} required>
					{#each instrumentsByTicker as inst (inst.id)}
						<option value={inst.id} title={inst.name}>{inst.symbol}</option>
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
				Broker
				<select name="broker_id">
					<option value="">—</option>
					{#each data.brokers as b (b.id)}
						<option value={b.id}>{b.name}</option>
					{/each}
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
				Prezzo unitario {ccySymbol}
				<input type="text" inputmode="decimal" name="price" placeholder="es. 98,54" required />
			</label>
			<label class="field">
				Commissioni {ccySymbol}
				<input type="text" inputmode="decimal" name="fee" placeholder="es. 5,00" value="0" />
			</label>
			<label class="field notes">
				Note
				<input type="text" name="notes" placeholder="opzionale" />
			</label>
			<button class="btn" type="submit">Aggiungi</button>
		</form>
		{#if data.brokers.length === 0}
			<p class="muted hint">
				Nessun broker configurato: puoi aggiungerli (con logo) in
				<a class="link" href="/admin">Amministrazione</a>.
			</p>
		{/if}
		{#if form?.error}
			<p class="error">{form.error}</p>
		{/if}
	{/if}
</section>

<section class="card">
	<div class="sec-head">
		<h2>Storico ({data.transactions.length})</h2>
		<div class="sec-actions">
			<span class="muted">Import CSV in <a class="link" href="/admin">Amministrazione</a></span>
			<a class="btn ghost" href="/api/transactions/export" download>Esporta CSV</a>
		</div>
	</div>
	{#if data.transactions.length === 0}
		<p class="muted">Nessuna operazione registrata.</p>
	{:else}
		<form
			id="edit-tx"
			method="POST"
			action="?/update"
			use:enhance={() =>
				async ({ update, result }) => {
					await update();
					if (result.type === 'success') editingId = null;
				}}
		></form>
		<div class="scroll-x">
			<table class="data">
				<thead>
					<tr>
						<th>Data</th>
						<th>Strumento</th>
						<th>Tipo</th>
						<th>Broker</th>
						<th class="num">Quantità</th>
						<th class="num">Prezzo</th>
						<th class="num">Commissioni</th>
						<th class="num">Controvalore</th>
						<th>Note</th>
						<th class="actions-col"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.transactions as tx (tx.id)}
						{#if editingId === tx.id}
							<tr class="editing">
								<td><input form="edit-tx" type="date" name="date" value={tx.date} max={today} required /></td>
								<td>
									<select form="edit-tx" name="instrument_id" required>
										{#each instrumentsByTicker as inst (inst.id)}
											<option value={inst.id} selected={inst.id === tx.instrument_id} title={inst.name}>{inst.symbol}</option>
										{/each}
									</select>
								</td>
								<td>
									<select form="edit-tx" name="type">
										<option value="buy" selected={tx.type === 'buy'}>Acquisto</option>
										<option value="sell" selected={tx.type === 'sell'}>Vendita</option>
									</select>
								</td>
								<td>
									<select form="edit-tx" name="broker_id">
										<option value="">—</option>
										{#each data.brokers as b (b.id)}
											<option value={b.id} selected={b.id === tx.broker_id}>{b.name}</option>
										{/each}
									</select>
								</td>
								<td class="num"><input form="edit-tx" class="mini" type="text" inputmode="decimal" name="quantity" value={tx.quantity} required /></td>
								<td class="num"><input form="edit-tx" class="mini" type="text" inputmode="decimal" name="price" value={tx.price} required /></td>
								<td class="num"><input form="edit-tx" class="mini" type="text" inputmode="decimal" name="fee" value={tx.fee} /></td>
								<td class="num muted">—</td>
								<td><input form="edit-tx" type="text" name="notes" value={tx.notes ?? ''} /></td>
								<td class="row-actions">
									<input form="edit-tx" type="hidden" name="id" value={tx.id} />
									<button form="edit-tx" class="act ok-act" type="submit" title="Salva" aria-label="Salva modifiche">✓</button>
									<button class="act" type="button" title="Annulla" aria-label="Annulla modifica" onclick={() => (editingId = null)}>✕</button>
								</td>
							</tr>
						{:else}
							<tr>
								<td>{fmtDate(tx.date)}</td>
								<td class="inst-cell">
								{@render typeIcon(tx.instrument_type)}{tx.instrument_name}
								<span class="ticker" title={tx.instrument_isin ?? undefined}>{tx.instrument_symbol}</span>
							</td>
								<td>
									<span class={['side', tx.type]}>{tx.type === 'buy' ? 'Acquisto' : 'Vendita'}</span>
								</td>
								<td>
									{#if tx.broker_name}
										<span class="broker">
											{#if tx.broker_has_logo}
												<img src="/api/brokers/{tx.broker_id}/logo" alt="" width="18" height="18" />
											{/if}
											{tx.broker_name}
										</span>
									{:else}
										<span class="muted">—</span>
									{/if}
								</td>
								<td class="num">{tx.quantity.toLocaleString('it-IT', { maximumFractionDigits: 8 })}</td>
								<td class="num">{fmtCurrency(tx.price, tx.currency)}</td>
								<td class="num">{fmtCurrency(tx.fee, tx.currency)}</td>
								<td class="num">{fmtCurrency(tx.quantity * tx.price + (tx.type === 'buy' ? tx.fee : -tx.fee), tx.currency)}</td>
								<td class="notes-cell">{tx.notes ?? ''}</td>
								<td class="row-actions">
									<button class="act" type="button" title="Modifica" aria-label="Modifica transazione" onclick={() => (editingId = tx.id)}>✎</button>
									<form
										method="POST"
										action="?/duplicate"
										class="inline"
										use:enhance={() =>
											async ({ update, result }) => {
												await update();
												if (result.type === 'success' && typeof result.data?.duplicatedId === 'number')
													editingId = result.data.duplicatedId;
											}}
									>
										<input type="hidden" name="id" value={tx.id} />
										<button class="act" type="submit" title="Duplica (poi modifica)" aria-label="Duplica transazione">⧉</button>
									</form>
									<form
										method="POST"
										action="?/delete"
										use:enhance
										class="inline"
										onsubmit={(e) => {
											if (!confirm('Eliminare questa transazione?')) e.preventDefault();
										}}
									>
										<input type="hidden" name="id" value={tx.id} />
										<button class="act del" type="submit" title="Elimina" aria-label="Elimina transazione">✕</button>
									</form>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
		{#if editingId !== null && form?.error}
			<p class="error">{form.error}</p>
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
	.tx-form {
		display: grid;
		grid-template-columns: 2fr 1fr 1.2fr 1fr 1fr 1fr 1fr;
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
		grid-column: span 6;
	}
	@media (max-width: 1000px) {
		.tx-form {
			grid-template-columns: 1fr 1fr;
		}
		.tx-form .notes {
			grid-column: span 2;
		}
	}
	.hint {
		margin-top: 0.7rem;
		font-size: 0.82rem;
	}
	.sec-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.sec-actions {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		flex-wrap: wrap;
		font-size: 0.82rem;
	}
	.inst-cell {
		white-space: nowrap;
	}
	.type-ico {
		display: inline-flex;
		vertical-align: -0.18em;
		margin-right: 0.45rem;
	}
	.type-ico.etf {
		color: #86b6ef;
	}
	.type-ico.crypto {
		color: #b7aef0;
	}
	.broker {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		white-space: nowrap;
	}
	.broker img {
		border-radius: 4px;
		object-fit: contain;
		background: var(--surface-2);
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
	.row-actions {
		white-space: nowrap;
	}
	.inline {
		display: inline;
	}
	.act {
		background: none;
		border: none;
		color: var(--ink-3);
		cursor: pointer;
		font-size: 0.85rem;
		padding: 0.2rem 0.4rem;
		border-radius: 6px;
	}
	.act:hover {
		color: var(--ink);
		background: rgba(255, 255, 255, 0.08);
	}
	.act.del:hover {
		color: var(--bad);
		background: rgba(230, 103, 103, 0.12);
	}
	.ok-act:hover {
		color: #7fd67f;
		background: rgba(12, 163, 12, 0.13);
	}
	tr.editing input,
	tr.editing select {
		width: 100%;
		min-width: 0;
		padding: 0.25rem 0.4rem;
		font-size: 0.82rem;
	}
	tr.editing .mini {
		width: 80px;
		text-align: right;
	}
	.scroll-x {
		overflow-x: auto;
	}
</style>
