<script lang="ts">
	import { enhance } from '$app/forms';
	import { fmtCurrency, fmtDate } from '$lib/format';

	let { data, form } = $props();

	let instType = $state('etf');

	function fmtWhen(iso: string): string {
		return new Date(iso).toLocaleString('it-IT', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head><title>Cunti — Admin · Investimenti</title></svelte:head>

<section class="card">
	<h2>Strumenti</h2>
	<form method="POST" action="?/createInstrument" use:enhance class="inst-form">
		<label class="field">
			Tipo
			<select name="type" bind:value={instType}>
				<option value="etf">ETF (Borsa Italiana)</option>
				<option value="crypto">Crypto</option>
			</select>
		</label>
		<label class="field">
			{instType === 'etf' ? 'Ticker Yahoo (es. SWDA.MI)' : 'ID CoinGecko (es. bitcoin)'}
			<input type="text" name="symbol" placeholder={instType === 'etf' ? 'SWDA.MI' : 'bitcoin'} required />
		</label>
		<label class="field">
			Nome
			<input type="text" name="name" placeholder={instType === 'etf' ? 'iShares Core MSCI World' : 'Bitcoin'} required />
		</label>
		<label class="field">
			Valuta
			<select name="currency">
				<option value="EUR">EUR</option>
				<option value="USD">USD</option>
			</select>
		</label>
		{#if instType === 'etf'}
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

	{#if form?.section === 'instruments'}
		{#if form.error}<p class="error">{form.error}</p>{/if}
		{#if 'warning' in (form ?? {}) && form.warning}<p class="warning">{form.warning}</p>{/if}
		{#if 'success' in (form ?? {}) && form.success}<p class="ok">{form.success}</p>{/if}
	{/if}

	<p class="muted hint">
		ETF: usa il ticker Yahoo Finance con suffisso <code>.MI</code> (quotazione EUR su Borsa Italiana).
		Crypto: usa l'<em>ID</em> CoinGecko (minuscolo, es. <code>bitcoin</code>, <code>ethereum</code>) —
		storico max 365 giorni con l'API gratuita. La <strong>valuta</strong> è quella in cui sono
		quotati prezzi e operazioni dello strumento: con USD i valori vengono convertiti in EUR al
		cambio EURUSD del giorno per totali e fisco. L'<strong>aliquota</strong> riguarda solo gli ETF
		(26% standard; abbassala per ETF con quota di titoli di stato whitelist, tassati al 12,5%);
		per le crypto è automatica per anno di realizzo (26% fino al 2025, 33% dal 2026).
	</p>

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
						<th>Valuta</th>
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
							<td>{inst.currency}</td>
							<td>{inst.isin ?? '—'}</td>
							<td class="num">
								{#if inst.type === 'etf'}
									<form method="POST" action="?/updateInstrument" use:enhance class="inline-edit">
										<input type="hidden" name="id" value={inst.id} />
										<input type="hidden" name="tax_rate_pct" value={inst.tax_rate_pct} />
										<input class="mini" type="text" inputmode="decimal" name="ter_pct" value={inst.ter_pct} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
									</form>
								{:else}
									<span class="muted">—</span>
								{/if}
							</td>
							<td class="num">
								{#if inst.type === 'etf'}
									<form method="POST" action="?/updateInstrument" use:enhance class="inline-edit">
										<input type="hidden" name="id" value={inst.id} />
										<input type="hidden" name="ter_pct" value={inst.ter_pct} />
										<input class="mini" type="text" inputmode="decimal" name="tax_rate_pct" value={inst.tax_rate_pct} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
									</form>
								{:else}
									<span class="muted" title="Automatica per anno di realizzo: 26% fino al 2025, 33% dal 2026">auto</span>
								{/if}
							</td>
							<td class="num">{inst.tx_count}</td>
							<td class="num">{inst.last_price_date ? fmtDate(inst.last_price_date) : '—'}</td>
							<td>
								<form
									method="POST"
									action="?/deleteInstrument"
									use:enhance
									onsubmit={(e) => {
										if (!confirm(`Eliminare ${inst.name}?`)) {
											e.preventDefault();
											return;
										}
										if (inst.tx_count > 0) {
											if (!confirm(`ATTENZIONE: verranno eliminate anche le ${inst.tx_count} operazioni di ${inst.name} e tutto lo storico prezzi. Confermi definitivamente?`)) {
												e.preventDefault();
												return;
											}
											const force = e.currentTarget.elements.namedItem('force') as HTMLInputElement;
											force.value = '1';
										}
									}}
								>
									<input type="hidden" name="id" value={inst.id} />
									<input type="hidden" name="force" value="" />
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

<section class="card">
	<h2>Broker</h2>
	<p class="muted">
		I broker si selezionano quando registri un'operazione. Eliminandone uno, le operazioni
		esistenti restano senza broker.
	</p>

	{#if form?.section === 'broker'}
		{#if form.error}<p class="error">{form.error}</p>{/if}
		{#if 'success' in (form ?? {}) && form.success}<p class="ok">{form.success}</p>{/if}
	{/if}

	<form method="POST" action="?/createBroker" use:enhance enctype="multipart/form-data" class="broker-form">
		<label class="field">
			Nome
			<input type="text" name="name" placeholder="es. Directa" required />
		</label>
		<label class="field">
			Logo (PNG/JPEG/SVG/WebP, max 512 KB)
			<input type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" />
		</label>
		<button class="btn" type="submit">Aggiungi broker</button>
	</form>

	{#if data.brokers.length === 0}
		<p class="muted">Nessun broker configurato.</p>
	{:else}
		<ul class="broker-list">
			{#each data.brokers as b (b.id)}
				<li>
					{#if b.has_logo}
						<img src="/api/brokers/{b.id}/logo" alt="" width="28" height="28" />
					{:else}
						<span class="logo-fallback" aria-hidden="true">{b.name.slice(0, 1).toUpperCase()}</span>
					{/if}
					<span class="broker-name">{b.name}</span>
					<span class="muted tx-count">{b.tx_count} operazioni</span>
					<form method="POST" action="?/updateBrokerLogo" use:enhance enctype="multipart/form-data" class="logo-update">
						<input type="hidden" name="id" value={b.id} />
						<label class="btn ghost sm">
							{b.has_logo ? 'Cambia logo' : 'Aggiungi logo'}
							<input
								class="hidden-file"
								type="file"
								name="logo"
								accept="image/png,image/jpeg,image/svg+xml,image/webp"
								onchange={(e) => e.currentTarget.form?.requestSubmit()}
							/>
						</label>
					</form>
					<form
						method="POST"
						action="?/deleteBroker"
						use:enhance
						onsubmit={(e) => {
							if (!confirm(`Eliminare il broker "${b.name}"?`)) e.preventDefault();
						}}
					>
						<input type="hidden" name="id" value={b.id} />
						<button class="del" type="submit" title="Elimina" aria-label="Elimina broker">✕</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card">
	<h2>Investimenti: importa CSV</h2>
	{#if form?.section === 'tx-import' && form.txPreview}
		{@const p = form.txPreview}
		<div class="preview">
			<p>
				<strong>Anteprima</strong> — {p.total} righe nel file:
				<strong class="ok-text">{p.toInsert} nuove</strong>,
				{p.skippedDuplicates} già presenti (saltate).
				{#if p.skippedLines.length > 0}
					<span class="muted">Righe saltate: {p.skippedLines.join(', ')}.</span>
				{/if}
			</p>

			{#if p.rows.length > 0}
				<div class="scroll-x">
					<table class="data compact">
						<thead>
							<tr>
								<th>Riga</th>
								<th>Data</th>
								<th>Strumento</th>
								<th>Tipo</th>
								<th class="num">Quantità</th>
								<th class="num">Prezzo</th>
								<th class="num">Commissioni</th>
								<th>Broker</th>
							</tr>
						</thead>
						<tbody>
							{#each p.rows as r (r.line)}
								<tr>
									<td class="muted">{r.line}</td>
									<td class="nowrap">{fmtDate(r.date)}</td>
									<td><code>{r.symbol}</code></td>
									<td>{r.type === 'buy' ? 'Acquisto' : 'Vendita'}</td>
									<td class="num">{r.quantity.toLocaleString('it-IT', { maximumFractionDigits: 8 })}</td>
									<td class="num nowrap">{fmtCurrency(r.price, r.currency)}</td>
									<td class="num nowrap">{fmtCurrency(r.fee, r.currency)}</td>
									<td>{r.broker ?? '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if p.truncated > 0}
					<p class="muted">… e altre {p.truncated} righe non mostrate (verranno importate comunque).</p>
				{/if}
			{:else}
				<p class="muted">Nessuna riga nuova: il file è già tutto nel database.</p>
			{/if}

			<form method="POST" action="?/applyTransactionImport" use:enhance>
				<input type="hidden" name="token" value={p.token} />
				<div class="preview-actions">
					<button class="btn" type="submit" disabled={p.toInsert === 0}>Conferma import</button>
				</div>
			</form>
			<form method="POST" action="?/cancelTransactionImport" use:enhance class="cancel-form">
				<input type="hidden" name="token" value={p.token} />
				<button class="btn ghost" type="submit">Annulla</button>
			</form>
		</div>
	{:else}
		<form method="POST" action="?/importTransactions" enctype="multipart/form-data" use:enhance class="import-form">
			<input type="file" name="file" accept=".csv,text/csv" required />
			<button class="btn" type="submit">Carica e mostra anteprima</button>
		</form>
		{#if form?.section === 'tx-import' && form.txApplied}
			<p class="ok">
				Import applicato: {form.txApplied.inserted} operazioni inserite{form.txApplied.skipped > 0
					? `, ${form.txApplied.skipped} saltate come duplicate`
					: ''}.
			</p>
		{/if}
		{#if form?.section === 'tx-import' && form.txCancelled}
			<p class="muted">Import annullato, nessuna modifica.</p>
		{/if}
		{#if form?.section === 'tx-import' && form.importErrors}
			<ul class="error import-errors">
				{#each form.importErrors as err (err)}<li>{err}</li>{/each}
			</ul>
		{/if}
		<p class="muted hint">
			Colonne minime: <code>data;tipo;quantita;prezzo</code> più <code>strumento</code> e/o
			<code>isin</code>. Opzionali: <code>commissioni</code>, <code>broker</code>,
			<code>note</code>. Separatore <code>;</code> o <code>,</code>, data <code>YYYY-MM-DD</code> o
			<code>GG/MM/AAAA</code>, decimali con virgola o punto. <strong>strumento</strong> = simbolo (es.
			<code>SWDA.MI</code>, <code>bitcoin</code>), <strong>isin</strong> = ISIN censito sullo strumento:
			se presente vince sul simbolo, e se i due indicano strumenti diversi la riga è un errore.
			<strong>tipo</strong> = <code>acquisto</code>/<code>vendita</code> (o buy/sell),
			<strong>broker</strong> = nome esistente. Nulla viene scritto prima della conferma; le righe
			identiche a operazioni già presenti (stesso strumento, tipo, data, quantità, prezzo e
			commissioni) vengono saltate, quindi reimportare lo stesso file è idempotente. Con errori di
			formato non viene importato nulla.
		</p>
	{/if}
</section>

<section class="card">
	<h2>Ultimo aggiornamento prezzi</h2>
	{#if data.refreshReport.length === 0}
		<p class="muted">Nessun refresh eseguito finora.</p>
	{:else}
		<p class="muted">
			Eseguito: <strong>{data.lastRefresh ? fmtWhen(data.lastRefresh) : '—'}</strong>. Log completi:
			<code>journalctl --user -u cunti.service -f</code> oppure <code>podman logs -f cunti</code>.
		</p>
		<div class="scroll-x">
			<table class="data">
				<thead>
					<tr>
						<th>Simbolo</th>
						<th>Esito</th>
						<th class="num">Punti</th>
						<th>Errore</th>
					</tr>
				</thead>
				<tbody>
					{#each data.refreshReport as r (r.symbol)}
						<tr>
							<td><code>{r.symbol}</code></td>
							<td>{r.ok ? '✓ ok' : '✗ fallito'}</td>
							<td class="num">{r.points ?? '—'}</td>
							<td class="err-cell">{r.error ?? ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<section class="card" id="demo">
	<h2>Investimenti: dati demo</h2>
	<p class="muted">
		Due ETF e una crypto finti (simboli <code>DEMO…</code>, esclusi dall'aggiornamento prezzi) con circa due anni
		di prezzi sintetici, due broker, un PAC mensile di 18 rate, acquisti crypto e una vendita. Solo con la sezione
		vuota: i dati demo non si mescolano a quelli veri. Per toglierli: svuota la sezione ed elimina gli strumenti demo.
	</p>
	{#if form?.section === 'demo'}
		{#if form.error}<p class="error">{form.error}</p>{/if}
		{#if 'success' in (form ?? {}) && form.success}<p class="ok">{form.success}</p>{/if}
	{/if}
	<form method="POST" action="?/createDemo" use:enhance>
		<button class="btn" type="submit" disabled={data.hasOperations}>Crea dati demo</button>
		{#if data.hasOperations}<span class="muted small">Ci sono già operazioni: svuota prima la sezione.</span>{/if}
	</form>
</section>

<section class="card danger-zone">
	<h2>Investimenti: svuota</h2>
	<p class="muted">
		Per la modifica di massa: <a class="link" href="/api/transactions/export" download>esporta il CSV</a>,
		modificalo, svuota qui e reimporta. Prima dello svuotamento viene creato automaticamente un backup
		del database. Strumenti, storico prezzi e broker <strong>non</strong> vengono toccati.
	</p>
	{#if form?.section === 'tx-dati'}
		{#if form.error}<p class="error">{form.error}</p>{/if}
		{#if 'success' in (form ?? {}) && form.success}<p class="ok">{form.success}</p>{/if}
	{/if}
	<form
		method="POST"
		action="?/wipeTransactions"
		use:enhance
		class="wipe-form"
		onsubmit={(e) => {
			if (!confirm('Eliminare TUTTE le operazioni? Viene creato un backup prima.')) e.preventDefault();
		}}
	>
		<input type="text" name="confirm" placeholder="scrivi ELIMINA" required />
		<button class="btn danger" type="submit">Svuota tutte le operazioni</button>
	</form>
</section>
