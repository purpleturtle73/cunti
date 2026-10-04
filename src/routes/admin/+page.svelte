<script lang="ts">
	import { enhance } from '$app/forms';
	import CategoryIcon from '$lib/components/CategoryIcon.svelte';
	import { ICON_NAMES } from '$lib/expense-icons';
	import { fmtCurrency, fmtDate, fmtEur } from '$lib/format';

	let { data, form } = $props();

	let restoring = $state(false);
	let instType = $state('etf');

	function fmtSize(bytes: number): string {
		if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' MB';
		return Math.max(1, Math.round(bytes / 1024)).toLocaleString('it-IT') + ' KB';
	}

	function fmtWhen(iso: string): string {
		return new Date(iso).toLocaleString('it-IT', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	let lastBackupLabel = $derived(data.lastBackup ? fmtWhen(data.lastBackup) : 'mai');
</script>

<svelte:head><title>Cunti — Amministrazione</title></svelte:head>

<h1 class="page-title">Amministrazione</h1>
<p class="app-version">
	Versione immagine <code title="Release dell'immagine container in esecuzione">{data.version}</code>
	{#if data.version === 'dev'}<span class="muted">(esecuzione fuori da un'immagine)</span>{/if}
</p>

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
											if (!confirm(`ATTENZIONE: verranno eliminate anche le ${inst.tx_count} transazioni di ${inst.name} e tutto lo storico prezzi. Confermi definitivamente?`)) {
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
	<h2>Transazioni: importa CSV</h2>
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
				Import applicato: {form.txApplied.inserted} transazioni inserite{form.txApplied.skipped > 0
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
			identiche a transazioni già presenti (stesso strumento, tipo, data, quantità, prezzo e
			commissioni) vengono saltate, quindi reimportare lo stesso file è idempotente. Con errori di
			formato non viene importato nulla.
		</p>
	{/if}
</section>

<section class="card">
	<h2>Spese: card / conti</h2>
	<p class="muted">
		Config statica dei conti e delle carte che compaiono nel campo <code>card</code> delle spese: il logo
		(Mastercard, Visa, logo banca…) viene mostrato nella lista movimenti. L'abbinamento è per <strong>nome</strong>:
		usa lo stesso valore presente nel CSV.
	</p>

	{#if form?.section === 'card'}
		{#if form.error}<p class="error">{form.error}</p>{/if}
		{#if 'success' in (form ?? {}) && form.success}<p class="ok">{form.success}</p>{/if}
	{/if}

	<form method="POST" action="?/createCard" use:enhance enctype="multipart/form-data" class="broker-form">
		<label class="field">
			Nome (= valore nel CSV)
			<input type="text" name="name" placeholder="es. conto, BancaX" required />
		</label>
		<label class="field">
			Logo (PNG/JPEG/SVG/WebP, max 512 KB)
			<input type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml,image/webp" />
		</label>
		<button class="btn" type="submit">Aggiungi card</button>
	</form>

	{#if data.cards.length === 0}
		<p class="muted">Nessuna card configurata.</p>
	{:else}
		<ul class="broker-list">
			{#each data.cards as c (c.id)}
				<li>
					{#if c.has_logo}
						<img src="/api/cards/{c.id}/logo" alt="" width="28" height="28" />
					{:else}
						<span class="logo-fallback" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
					{/if}
					<span class="broker-name">{c.name}</span>
					<form method="POST" action="?/updateCardLogo" use:enhance enctype="multipart/form-data" class="logo-update">
						<input type="hidden" name="id" value={c.id} />
						<label class="btn ghost sm">
							{c.has_logo ? 'Cambia logo' : 'Aggiungi logo'}
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
						action="?/deleteCard"
						use:enhance
						onsubmit={(e) => {
							if (!confirm(`Eliminare la card "${c.name}"? Le spese restano intatte.`)) e.preventDefault();
						}}
					>
						<input type="hidden" name="id" value={c.id} />
						<button class="del" type="submit" title="Elimina" aria-label="Elimina card">✕</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card">
	<h2>Spese: importa CSV</h2>
	{#if form?.section === 'spese-import' && form.preview}
		{@const p = form.preview}
		<div class="preview">
			<p>
				<strong>Anteprima</strong> — {p.total} righe nel file:
				<strong class="ok-text">{p.toInsert} nuove</strong>,
				{p.skippedDuplicates} già presenti (saltate){p.conflicts.length > 0 ? ',' : '.'}
				{#if p.conflicts.length > 0}
					<strong class="warn-text">{p.conflicts.length} conflitti di categoria</strong>.
				{/if}
				Categorizzate: {p.bySource.csv} dal CSV, {p.bySource.rules} dalle regole, {p.bySource.unknown} unknown.
			</p>
			{#if p.rulesError}<p class="warning">{p.rulesError}</p>{/if}
			{#if p.newCategories.length > 0}
				<p class="muted">Categorie nuove: {p.newCategories.join(', ')}</p>
			{/if}

			<form method="POST" action="?/applyExpenseImport" use:enhance>
				<input type="hidden" name="token" value={p.token} />
				{#if p.conflicts.length > 0}
					<p class="muted">
						Stessa voce (data, descrizione, card, importo) ma categoria diversa — scegli quale tenere:
					</p>
					<div class="scroll-x">
						<table class="data compact">
							<thead>
								<tr>
									<th>Data</th>
									<th>Descrizione</th>
									<th class="num">Importo</th>
									<th>Nel DB</th>
									<th>Nel CSV</th>
									<th>Scelta</th>
								</tr>
							</thead>
							<tbody>
								{#each p.conflicts as c, i (i)}
									<tr>
										<td class="nowrap">{fmtDate(c.date)}</td>
										<td class="desc-cell" title={c.description}>{c.description}</td>
										<td class="num nowrap">{fmtEur(c.amount)}</td>
										<td><code>{c.dbCategory}</code></td>
										<td><code>{c.csvCategory}</code></td>
										<td class="nowrap">
											<input type="hidden" name="key-{i}" value={`${c.date}|${c.description}|${c.card}|${c.amount.toFixed(2)}`} />
											<label class="radio"><input type="radio" name="conflict-{i}" value="db" checked /> DB</label>
											<label class="radio"><input type="radio" name="conflict-{i}" value="csv" /> CSV</label>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<div class="bulk-choice">
						<button class="btn ghost sm" type="button" onclick={(e) => { for (const r of e.currentTarget.closest('form')?.querySelectorAll('input[value="db"]') ?? []) (r as HTMLInputElement).checked = true; }}>Tutte DB</button>
						<button class="btn ghost sm" type="button" onclick={(e) => { for (const r of e.currentTarget.closest('form')?.querySelectorAll('input[value="csv"]') ?? []) (r as HTMLInputElement).checked = true; }}>Tutte CSV</button>
					</div>
				{/if}
				<div class="preview-actions">
					<button class="btn" type="submit">Conferma import</button>
				</div>
			</form>
			<form method="POST" action="?/cancelExpenseImport" use:enhance class="cancel-form">
				<input type="hidden" name="token" value={p.token} />
				<button class="btn ghost" type="submit">Annulla</button>
			</form>
		</div>
	{:else}
		<form method="POST" action="?/importExpenses" enctype="multipart/form-data" use:enhance class="import-form">
			<input type="file" name="file" accept=".csv,text/csv" required />
			<label class="field">
				Card di default (se il CSV non ha la colonna)
				<input type="text" name="default_card" placeholder="conto" />
			</label>
			<button class="btn" type="submit">Carica e mostra anteprima</button>
		</form>
		{#if form?.section === 'spese-import' && form.applied}
			<p class="ok">Import applicato: {form.applied.inserted} voci inserite{form.applied.updatedCategories > 0 ? `, ${form.applied.updatedCategories} categorie aggiornate dai conflitti` : ''}.</p>
		{/if}
		{#if form?.section === 'spese-import' && form.cancelled}
			<p class="muted">Import annullato, nessuna modifica.</p>
		{/if}
		{#if form?.section === 'spese-import' && form.importErrors}
			<ul class="error import-errors">
				{#each form.importErrors as err (err)}<li>{err}</li>{/each}
			</ul>
		{/if}
		<p class="muted hint">
			Colonne minime: <code>data_ops;descrizione;importo</code>. Opzionali: <code>card</code>,
			<code>moneyin</code>/<code>moneyout</code> (validate), <code>categoria</code> (se assente o
			<code>unknown</code> ci pensano le regole). Nulla viene scritto prima della conferma; dedup a
			conteggio (reimport idempotente, doppioni legittimi preservati).
		</p>
	{/if}
</section>

<section class="card">
	<h2>Spese: categorie</h2>
	{#if form?.section === 'spese-categorie'}
		{#if form.error}<p class="error">{form.error}</p>{/if}
		{#if 'renamed' in (form ?? {}) && form.renamed}<p class="ok">{form.renamed}</p>{/if}
	{/if}
	{#if data.expenseSummaries.length === 0}
		<p class="muted">Ancora nessuna categoria (importa le spese).</p>
	{:else}
		<div class="scroll-x">
			<table class="data compact">
				<thead>
					<tr>
						<th></th>
						<th>Categoria</th>
						<th class="num">Voci</th>
						<th class="num">Uscite</th>
						<th class="num">Entrate</th>
						<th>Icona</th>
						<th title="Giroconti tra conti propri o doppi conteggi (es. totale carta di credito): esclusi da entrate/uscite e dai grafici">Escludi dai totali</th>
						<th>Rinomina</th>
					</tr>
				</thead>
				<tbody>
					{#each data.expenseSummaries as s (s.category)}
						{@const m = data.expenseMeta[s.category] ?? {}}
						<tr>
							<td><CategoryIcon category={s.category} icon={m.icon} color={m.color} size={15} /></td>
							<td><code>{s.category}</code></td>
							<td class="num">{s.count}</td>
							<td class="num">{fmtEur(s.moneyOut)}</td>
							<td class="num">{fmtEur(s.moneyIn)}</td>
							<td>
								<form method="POST" action="?/setExpenseMeta" use:enhance class="inline-edit">
									<input type="hidden" name="category" value={s.category} />
									{#if m.transfer}<input type="hidden" name="transfer" value="1" />{/if}
									<select name="icon" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
										<option value="" selected={!m.icon}>—</option>
										{#each ICON_NAMES as n (n)}
											<option value={n} selected={m.icon === n}>{n}</option>
										{/each}
									</select>
								</form>
							</td>
							<td>
								<form method="POST" action="?/setExpenseMeta" use:enhance class="inline-edit">
									<input type="hidden" name="category" value={s.category} />
									<input type="hidden" name="icon" value={m.icon ?? ''} />
									<input type="checkbox" name="transfer" value="1" checked={!!m.transfer} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
								</form>
							</td>
							<td>
								<form method="POST" action="?/renameExpenseCategory" use:enhance class="rename-form">
									<input type="hidden" name="old" value={s.category} />
									<input class="rename-input" type="text" name="new" placeholder="nuovo nome" />
									<button class="btn ghost sm" type="submit">→</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted hint">
			<strong>Escludi dai totali</strong> serve per giroconti (es. <code>investimenti</code>, <code>ignore</code>)
			e doppi conteggi (es. <code>carte_credito</code>, già presente come voci singole): le voci restano nei
			movimenti ma spariscono da entrate/uscite, saldo e grafici. Icona e flag finiscono in
			<code>categories-meta.json</code> (editabile anche a mano, lì si imposta pure il colore). La rinomina
			aggiorna voci nel DB, <code>categories.json</code> e meta.
		</p>
	{/if}
</section>

<section class="card">
	<h2>Spese: regole (categories.json)</h2>
	{#if data.rulesInfo.error}
		<p class="warning">{data.rulesInfo.error}</p>
	{:else}
		<p class="muted">
			{data.rulesInfo.categories} categorie, {data.rulesInfo.keywords} keyword. Il file si edita a mano
			(<code>DATA_DIR/categories.json</code>) e viene riletto a ogni import.
		</p>
	{/if}
	{#if data.rulesInfo.warnings.length > 0}
		<details class="warn-details">
			<summary class="warning">{data.rulesInfo.warnings.length} keyword sospette (sintassi regex: mai matchate)</summary>
			<ul class="muted small-list">
				{#each data.rulesInfo.warnings as w (w)}<li>{w}</li>{/each}
			</ul>
		</details>
	{/if}

	{#if form?.section === 'spese-regole' && form.error}<p class="error">{form.error}</p>{/if}

	<div class="rules-tools">
		<form method="POST" action="?/testDescription" use:enhance class="test-form">
			<input type="text" name="description" placeholder="prova una descrizione…" required />
			<button class="btn ghost" type="submit">Test</button>
			{#if form?.section === 'spese-regole' && form.test}
				<span class="test-result">
					→ <code>{form.test.category}</code>{#if form.test.keyword}&nbsp;(keyword: <code>{form.test.keyword}</code>){/if}
				</span>
			{/if}
		</form>
		<form method="POST" action="?/applyRules" use:enhance class="inline-form">
			<button class="btn ghost" type="submit">Anteprima regole sulle unknown</button>
		</form>
		<form method="POST" action="?/keywordReport" use:enhance class="inline-form">
			<button class="btn ghost" type="submit">Report utilizzo keyword</button>
		</form>
	</div>

	{#if form?.section === 'spese-regole' && form.rulesPreview}
		{@const rp = form.rulesPreview}
		<div class="preview">
			<p>Voci <code>unknown</code>: {rp.unknown} — le regole ne categorizzerebbero <strong>{rp.matched}</strong>:</p>
			{#if rp.byCategory.length > 0}
				<ul class="muted small-list">
					{#each rp.byCategory as bc (bc.category)}<li><code>{bc.category}</code>: {bc.count}</li>{/each}
				</ul>
				<form method="POST" action="?/applyRules" use:enhance>
					<input type="hidden" name="confirm" value="1" />
					<button class="btn" type="submit">Applica ({rp.matched} voci)</button>
				</form>
			{/if}
		</div>
	{/if}
	{#if form?.section === 'spese-regole' && form.rulesApplied !== undefined}
		<p class="ok">Regole applicate: {form.rulesApplied} voci categorizzate.</p>
	{/if}

	{#if form?.section === 'spese-regole' && form.report}
		<div class="scroll-x report">
			<table class="data compact">
				<thead>
					<tr><th>Keyword</th><th>Categoria</th><th class="num">Match</th><th>Ultimo</th></tr>
				</thead>
				<tbody>
					{#each form.report as r (r.category + '|' + r.keyword)}
						<tr class={r.matches === 0 ? 'dead' : ''}>
							<td><code>{r.keyword}</code></td>
							<td>{r.category}</td>
							<td class="num">{r.matches}</td>
							<td class="nowrap">{r.last ? fmtDate(r.last) : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted hint">Le keyword a 0 match (evidenziate) sono candidate alla rimozione dal file.</p>
	{/if}
</section>

<section class="card danger-zone">
	<h2>Transazioni: svuota</h2>
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
			if (!confirm('Eliminare TUTTE le transazioni? Viene creato un backup prima.')) e.preventDefault();
		}}
	>
		<input type="text" name="confirm" placeholder="scrivi ELIMINA" required />
		<button class="btn danger" type="submit">Svuota tutte le transazioni</button>
	</form>
</section>

<section class="card danger-zone">
	<h2>Spese: svuota</h2>
	<p class="muted">
		Per la modifica di massa: <a class="link" href="/api/expenses/export" download>esporta il CSV</a>, modificalo,
		svuota qui e reimporta. Prima dello svuotamento viene creato automaticamente un backup del database.
	</p>
	{#if form?.section === 'spese-dati'}
		{#if form.error}<p class="error">{form.error}</p>{/if}
		{#if 'success' in (form ?? {}) && form.success}<p class="ok">{form.success}</p>{/if}
	{/if}
	<form
		method="POST"
		action="?/wipeExpenses"
		use:enhance
		class="wipe-form"
		onsubmit={(e) => {
			if (!confirm('Eliminare TUTTE le spese? Viene creato un backup prima.')) e.preventDefault();
		}}
	>
		<input type="text" name="confirm" placeholder="scrivi ELIMINA" required />
		<button class="btn danger" type="submit">Svuota tutte le spese</button>
	</form>
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

<section class="card">
	<div class="sec-head">
		<h2>Backup</h2>
		<form method="POST" action="?/backupNow" use:enhance>
			<button class="btn" type="submit">Esegui backup ora</button>
		</form>
	</div>
	<p class="muted">
		Backup automatico almeno una volta al giorno in <code>DATA_DIR/backups</code>, rotazione a 10
		giorni. Ultimo backup: <strong>{lastBackupLabel}</strong>.
	</p>

	{#if form?.section === 'backup'}
		{#if form.error}<p class="error">{form.error}</p>{/if}
		{#if 'success' in (form ?? {}) && form.success}<p class="ok">{form.success}</p>{/if}
	{/if}

	{#if data.backups.length === 0}
		<p class="muted">Nessun backup presente.</p>
	{:else}
		<div class="scroll-x">
			<table class="data">
				<thead>
					<tr>
						<th>File</th>
						<th class="num">Dimensione</th>
						<th>Data</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.backups as b (b.name)}
						<tr>
							<td><code>{b.name}</code></td>
							<td class="num">{fmtSize(b.size)}</td>
							<td>{fmtWhen(b.mtime)}</td>
							<td class="row-actions">
								<a class="btn ghost sm" href="/api/backups/{b.name}" download>Scarica</a>
								<form
									method="POST"
									action="?/restore"
									use:enhance={() => {
										restoring = true;
										return async ({ update }) => {
											restoring = false;
											await update();
										};
									}}
									onsubmit={(e) => {
										if (
											!confirm(
												`Ripristinare ${b.name}?\n\nI dati attuali verranno SOSTITUITI (viene comunque creato un backup di sicurezza prima).`
											)
										)
											e.preventDefault();
									}}
								>
									<input type="hidden" name="name" value={b.name} />
									<button class="btn ghost sm" type="submit" disabled={restoring}>
										{restoring ? 'Ripristino…' : 'Ripristina'}
									</button>
								</form>
								<form
									method="POST"
									action="?/deleteBackup"
									use:enhance
									onsubmit={(e) => {
										if (!confirm(`Eliminare ${b.name}?`)) e.preventDefault();
									}}
								>
									<input type="hidden" name="name" value={b.name} />
									<button class="del" type="submit" title="Elimina" aria-label="Elimina backup">✕</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<form method="POST" action="?/uploadBackup" use:enhance enctype="multipart/form-data" class="upload">
		<label class="field">
			Ripristina da file (.db)
			<input type="file" name="file" accept=".db" required />
		</label>
		<button class="btn ghost" type="submit">Carica</button>
	</form>
</section>


<style>
	.page-title {
		font-size: 1.7rem;
		margin-bottom: 0.3rem;
	}
	.app-version {
		margin: 0 0 1.2rem;
		font-size: 0.85rem;
		color: var(--ink-3);
	}
	.app-version code {
		background: var(--surface-2);
		border-radius: 4px;
		padding: 0.05rem 0.4rem;
		color: var(--ink-2);
		font-weight: 600;
	}
	section.card {
		margin-bottom: 1rem;
	}
	.sec-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.muted {
		color: var(--ink-3);
	}
	.muted code {
		background: var(--surface-2);
		border-radius: 4px;
		padding: 0.05rem 0.3rem;
	}
	.error {
		color: var(--bad);
		margin: 0.8rem 0 0;
		font-size: 0.85rem;
	}
	.ok {
		color: #7fd67f;
		margin: 0.8rem 0 0;
		font-size: 0.85rem;
	}
	.scroll-x {
		overflow-x: auto;
	}
	.inst-form {
		display: grid;
		grid-template-columns: 1fr 1.2fr 1.6fr 0.6fr 1fr 0.7fr 0.7fr;
		gap: 0.8rem;
		align-items: end;
	}
	@media (max-width: 1000px) {
		.inst-form {
			grid-template-columns: 1fr 1fr;
		}
	}
	.inst-form :global(input),
	.inst-form :global(select) {
		width: 100%;
		min-width: 0;
	}
	.inst-form .field {
		min-width: 0;
	}
	.hint {
		margin: 0.9rem 0;
		font-size: 0.78rem;
		max-width: 70rem;
	}
	.warning {
		color: var(--series-3);
		margin: 0.8rem 0 0;
		font-size: 0.85rem;
	}
	.mini {
		width: 60px;
		text-align: right;
		padding: 0.25rem 0.4rem;
	}
	.inline-edit {
		display: inline;
	}
	.pos-link {
		font-weight: 600;
	}
	.pos-link:hover {
		color: var(--accent);
	}
	.err-cell {
		max-width: 420px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--bad);
		font-size: 0.8rem;
	}
	.row-actions {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		justify-content: flex-end;
	}
	.btn.sm {
		font-size: 0.75rem;
		padding: 0.3rem 0.6rem;
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
	.upload {
		margin-top: 1.1rem;
		display: flex;
		gap: 0.8rem;
		align-items: end;
		flex-wrap: wrap;
	}
	.broker-form {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 0.8rem;
		align-items: end;
		margin: 1rem 0 1.2rem;
	}
	@media (max-width: 800px) {
		.broker-form {
			grid-template-columns: 1fr;
		}
	}
	.broker-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.broker-list li {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.55rem 0.2rem;
		border-top: 1px solid var(--border);
	}
	.broker-list img,
	.logo-fallback {
		width: 28px;
		height: 28px;
		border-radius: 7px;
		object-fit: contain;
		background: var(--surface-2);
		flex: none;
	}
	.logo-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.8rem;
		color: var(--ink-2);
	}
	.broker-name {
		font-weight: 600;
	}
	.tx-count {
		font-size: 0.78rem;
	}
	.logo-update {
		margin-left: auto;
	}
	.hidden-file {
		display: none;
	}
	.nowrap {
		white-space: nowrap;
	}
	.desc-cell {
		max-width: 380px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--ink-2);
	}
	table.compact th,
	table.compact :global(td) {
		padding-top: 0.35rem;
		padding-bottom: 0.35rem;
	}
	.import-form {
		display: flex;
		gap: 0.8rem;
		align-items: end;
		flex-wrap: wrap;
	}
	.import-errors {
		margin: 0.8rem 0 0;
		padding-left: 1.2rem;
	}
	.preview {
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: 0.9rem 1rem;
		margin-bottom: 0.6rem;
	}
	.preview-actions {
		margin-top: 0.9rem;
		display: flex;
		gap: 0.8rem;
	}
	.cancel-form {
		margin-top: 0.5rem;
	}
	.bulk-choice {
		display: flex;
		gap: 0.6rem;
		margin-top: 0.5rem;
	}
	.radio {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-right: 0.5rem;
		font-size: 0.8rem;
	}
	.ok-text {
		color: #7fd67f;
	}
	.warn-text,
	.warning {
		color: var(--series-3);
	}
	.warning {
		margin: 0.8rem 0 0;
		font-size: 0.85rem;
	}
	.hint {
		margin: 0.9rem 0 0;
		font-size: 0.78rem;
	}
	.hint code {
		background: var(--surface-2);
		border-radius: 4px;
		padding: 0.05rem 0.3rem;
	}
	.inline-edit {
		display: inline;
	}
	.rename-form {
		display: flex;
		gap: 0.3rem;
		align-items: center;
	}
	.rename-input {
		width: 110px;
		padding: 0.2rem 0.4rem;
		font-size: 0.78rem;
	}
	.rules-tools {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.8rem;
	}
	.test-form {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.test-result {
		font-size: 0.85rem;
	}
	.inline-form {
		display: inline;
	}
	.small-list {
		font-size: 0.8rem;
		margin: 0.4rem 0;
		padding-left: 1.2rem;
	}
	.warn-details {
		margin-top: 0.6rem;
	}
	.warn-details summary {
		cursor: pointer;
		font-size: 0.85rem;
	}
	.report {
		margin-top: 0.8rem;
		max-height: 420px;
		overflow-y: auto;
	}
	tr.dead td {
		color: var(--series-3);
	}
	.danger-zone {
		border-color: rgba(230, 103, 103, 0.35);
	}
	.wipe-form {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.6rem;
	}
	.btn.danger {
		background: rgba(230, 103, 103, 0.15);
		color: #f0a3a3;
		border: 1px solid rgba(230, 103, 103, 0.4);
	}
	.btn.danger:hover {
		background: rgba(230, 103, 103, 0.25);
	}
	.link {
		color: var(--accent);
		font-weight: 600;
	}
</style>
