<script lang="ts">
	import { enhance } from '$app/forms';
	import { matchCard } from '$lib/cards';
	import { fmtDate, fmtEur } from '$lib/format';

	let { form, data } = $props();

	// passo di mappatura: importo unico con segno oppure entrate/uscite separate
	let mapMode = $state<'signed' | 'split'>('signed');
	$effect(() => {
		if (form?.mapping) mapMode = form.mapping.mapping.amountMode;
	});
</script>

{#snippet colSelect(name: string, label: string, headers: string[], value: string, optional: boolean)}
	<label class="field">
		{label}
		<select {name}>
			<option value="" selected={value === ''}>{optional ? '— nessuna —' : 'scegli…'}</option>
			{#each headers as h (h)}<option value={h} selected={h === value}>{h}</option>{/each}
		</select>
	</label>
{/snippet}

<svelte:head><title>Cunti — Admin · Finanze</title></svelte:head>

<p class="muted area-intro">
	Categorie e keyword si gestiscono in <a class="link" href="/admin/finanze/categorie">Categorie</a>;
	le voci in cui la tua categoria non coincide con le regole in
	<a class="link" href="/admin/finanze/conflitti">Conflitti</a>.
</p>

<section class="card">
	<h2>Finanze: card / conti</h2>
	<p class="muted">
		Config statica dei conti e delle carte che compaiono nel campo <code>card</code> dei movimenti: il logo
		(Mastercard, Visa, logo banca…) viene mostrato nella lista movimenti. L'abbinamento è per
		<strong>prefisso</strong>, senza distinzione di maiuscole: la card <code>Mastercard</code> copre
		<code>MASTERCARD - 1234</code> e ogni altro numero dello stesso brand, quindi basta una voce e un
		logo per brand. A parità vince il nome più lungo (<code>MASTERCARD GOLD</code> batte
		<code>MASTERCARD</code>).
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
							if (!confirm(`Eliminare la card "${c.name}"? I movimenti restano intatti.`)) e.preventDefault();
						}}
					>
						<input type="hidden" name="id" value={c.id} />
						<button class="del" type="submit" title="Elimina" aria-label="Elimina card">✕</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.cardUsage.length > 0}
		<h3 class="sub-title">Valori nei movimenti</h3>
		<p class="muted">
			Valori effettivi del campo <code>card</code> nello storico. Gli export bancari producono
			varianti di battitura dello stesso conto (maiuscole, punti finali) che spezzano filtro e
			statistiche per card: rinomina una variante <strong>verso un valore già esistente</strong> per
			<strong>unirle</strong>. La modifica propaga subito su tutti i movimenti, quindi conviene avere un
			backup prima di toccare molte righe.
		</p>
		<div class="scroll-x">
			<table class="data compact">
				<thead>
					<tr>
						<th>Valore</th>
						<th class="num">Movimenti</th>
						<th>Dal</th>
						<th>Al</th>
						<th>Card abbinata</th>
						<th>Rinomina / unisci a</th>
					</tr>
				</thead>
				<tbody>
					{#each data.cardUsage as u (u.card)}
						{@const matched = matchCard(u.card, data.cards)}
						<tr>
							<td><code>{u.card}</code></td>
							<td class="num">{u.count.toLocaleString('it-IT')}</td>
							<td class="nowrap">{fmtDate(u.first)}</td>
							<td class="nowrap">{fmtDate(u.last)}</td>
							<td class="nowrap">
								{#if matched}
									<span class="ok-text">{matched.name}</span>
									{#if !matched.has_logo}<span class="muted">(senza logo)</span>{/if}
								{:else}
									<span class="muted">nessuna</span>
								{/if}
							</td>
							<td>
								<form method="POST" action="?/renameExpenseCard" use:enhance class="rename-form">
									<input type="hidden" name="old" value={u.card} />
									<input
										class="rename-input"
										type="text"
										name="new"
										list="card-values"
										placeholder="nuovo valore"
										required
									/>
									<button class="btn ghost sm" type="submit">Applica</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<datalist id="card-values">
			{#each data.cardUsage as u (u.card)}<option value={u.card}></option>{/each}
			{#each data.cards as c (c.id)}<option value={c.name}></option>{/each}
		</datalist>
	{/if}
</section>

<section class="card">
	<h2>Finanze: importa CSV</h2>
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
			{#if form.mappedNote}<p class="muted">{form.mappedNote}</p>{/if}
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
	{:else if form?.section === 'spese-import' && form.mapping}
		{@const s = form.mapping}
		<div class="mapping">
			<p>
				<strong>Mappatura delle colonne</strong> — <code>{s.fileName}</code>: {s.totalRows} righe sotto l'intestazione
				(riga {s.headerLine}).
			</p>
			{#if s.notice}<p class="muted">{s.notice}</p>{/if}
			{#if s.errors.length > 0}
				<ul class="error import-errors">
					{#each s.errors as err (err)}<li>{err}</li>{/each}
				</ul>
			{/if}
			<div class="scroll-x sample">
				<table class="data compact">
					<thead>
						<tr>{#each s.headers as h, i (i)}<th>{h || `(colonna ${i + 1})`}</th>{/each}</tr>
					</thead>
					<tbody>
						{#each s.sample as row, r (r)}
							<tr>{#each s.headers as _, i (i)}<td title={row[i] ?? ''}>{row[i] ?? ''}</td>{/each}</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<form method="POST" action="?/mapImport" use:enhance class="map-form">
				<input type="hidden" name="token" value={s.token} />
				<div class="map-grid">
					<div class="map-group">
						<label class="field">
							Intestazione alla riga
							<span class="inline-field">
								<input type="number" name="m_header_line" min="1" value={s.headerLine} />
								<button class="btn ghost sm" type="submit" name="intent" value="refresh" title="Rileggi le colonne da questa riga">
									Aggiorna colonne
								</button>
							</span>
						</label>
					</div>
					<div class="map-group">
						{@render colSelect('m_date', 'Data *', s.headers, s.mapping.date, false)}
						<label class="field">
							Formato data
							<select name="m_date_format">
								{#each [['auto', 'automatico (GG/MM/AAAA o AAAA-MM-GG)'], ['dmy', 'giorno/mese/anno'], ['ymd', 'anno-mese-giorno'], ['mdy', 'mese/giorno/anno (USA)']] as [v, l] (v)}
									<option value={v} selected={s.mapping.dateFormat === v}>{l}</option>
								{/each}
							</select>
						</label>
					</div>
					<div class="map-group">
						{@render colSelect('m_description', 'Descrizione *', s.headers, s.mapping.description, false)}
						{@render colSelect('m_description2', 'Descrizione aggiuntiva (accodata)', s.headers, s.mapping.description2, true)}
					</div>
					<div class="map-group">
						<span class="field-label">Importo *</span>
						<label class="radio"><input type="radio" name="m_amount_mode" value="signed" bind:group={mapMode} /> una colonna con il segno</label>
						<label class="radio"><input type="radio" name="m_amount_mode" value="split" bind:group={mapMode} /> entrate e uscite separate (Avere/Dare)</label>
						{#if mapMode === 'signed'}
							{@render colSelect('m_amount', 'Colonna importo', s.headers, s.mapping.amount, false)}
							<label class="radio"><input type="checkbox" name="m_invert" checked={s.mapping.invert} /> nel file le uscite sono positive (inverti il segno)</label>
						{:else}
							{@render colSelect('m_money_in', 'Entrate / Avere', s.headers, s.mapping.moneyIn, true)}
							{@render colSelect('m_money_out', 'Uscite / Dare', s.headers, s.mapping.moneyOut, true)}
						{/if}
						<label class="field">
							Separatore decimale
							<select name="m_decimal">
								{#each [['auto', 'automatico'], ['comma', 'virgola (1.234,56)'], ['dot', 'punto (1,234.56)']] as [v, l] (v)}
									<option value={v} selected={s.mapping.decimal === v}>{l}</option>
								{/each}
							</select>
						</label>
					</div>
					<div class="map-group">
						{@render colSelect('m_card', `Card / conto (vuoto = "${s.defaultCard}")`, s.headers, s.mapping.card, true)}
						{@render colSelect('m_category', 'Categoria (vuoto = regole)', s.headers, s.mapping.category, true)}
						<label class="radio">
							<input type="checkbox" name="m_skip_invalid" checked={s.mapping.skipInvalidDates} />
							ignora le righe senza una data valida (totali, saldi, intestazioni ripetute)
						</label>
					</div>
					<div class="map-group">
						<label class="field">
							Salva come profilo (facoltativo)
							<input type="text" name="profile_name" value={s.profileName} placeholder="es. nome della banca" maxlength="60" />
						</label>
						<p class="muted small-note">Con un profilo, i prossimi file con questa intestazione vengono letti da soli.</p>
					</div>
				</div>
				<div class="preview-actions">
					<button class="btn" type="submit" name="intent" value="apply">Applica e mostra anteprima</button>
					<button class="btn ghost" type="submit" name="intent" value="cancel">Annulla</button>
				</div>
			</form>
		</div>
	{:else}
		<form method="POST" action="?/importExpenses" enctype="multipart/form-data" use:enhance class="import-form">
			<input type="file" name="file" accept=".csv,text/csv,.txt" required />
			<label class="field">
				Formato
				<select name="format">
					<option value="auto">automatico (Cunti o profilo riconosciuto)</option>
					<option value="manual">mappa le colonne a mano</option>
					{#each data.importProfiles as p (p.name)}<option value="profile:{p.name}">profilo: {p.name}</option>{/each}
				</select>
			</label>
			<label class="field">
				Card di default (se il CSV non ha la colonna)
				<input type="text" name="default_card" placeholder="conto" />
			</label>
			<button class="btn" type="submit">Carica e mostra anteprima</button>
		</form>
		{#if data.importProfiles.length > 0}
			<div class="profiles">
				<span class="muted">Profili di import:</span>
				{#each data.importProfiles as p (p.name)}
					<form
						method="POST"
						action="?/deleteImportProfile"
						use:enhance
						class="profile-chip"
						onsubmit={(e) => {
							if (!confirm(`Eliminare il profilo "${p.name}"?`)) e.preventDefault();
						}}
					>
						<input type="hidden" name="name" value={p.name} />
						<span title="{p.columns} colonne · aggiornato il {fmtDate(p.updated.slice(0, 10))}">{p.name}</span>
						<button type="submit" class="chip-x" aria-label="Elimina il profilo {p.name}">✕</button>
					</form>
				{/each}
			</div>
		{/if}
		{#if form?.section === 'profili'}
			{#if form.error}<p class="error">{form.error}</p>{/if}
			{#if 'success' in form && form.success}<p class="ok">{form.success}</p>{/if}
		{/if}
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
			Formato di Cunti: <code>data_ops;descrizione;importo</code>, opzionali <code>card</code>,
			<code>moneyin</code>/<code>moneyout</code> (validate), <code>categoria</code> (se assente o
			<code>unknown</code> ci pensano le regole). Un export della banca in un altro formato va bene lo stesso: ti
			verrà chiesto quali colonne usare, e la scelta si può salvare come profilo. Nulla viene scritto prima della
			conferma; dedup a conteggio (reimport idempotente, doppioni legittimi preservati).
		</p>
	{/if}
</section>

<section class="card" id="demo">
	<h2>Finanze: dati demo</h2>
	<p class="muted">
		Circa due anni di movimenti finti (stipendio, affitto, bollette, abbonamenti, spesa, ristoranti, viaggi…) su
		tre conti correnti, un conto trading e tre carte di credito. Alcune voci restano senza categoria e alcune sono in
		conflitto con le regole, così Categorie e Conflitti hanno qualcosa da mostrare. Solo con la sezione vuota: i dati
		demo non si mescolano a quelli veri.
	</p>
	<p class="muted">
		<strong>Sostituisce la configurazione</strong>: categorie e keyword diventano il solo set di default e le card
		configurate le sole card demo. Prima viene creato un backup automatico, da cui recuperare le tue
		(Admin → Generale → ripristino).
	</p>
	{#if form?.section === 'demo'}
		{#if form.error}<p class="error">{form.error}</p>{/if}
		{#if 'success' in (form ?? {}) && form.success}<p class="ok">{form.success}</p>{/if}
	{/if}
	<form
		method="POST"
		action="?/createDemo"
		use:enhance
		onsubmit={(e) => {
			if (!confirm('Categorie, keyword e card configurate verranno sostituite da quelle demo. Viene creato un backup prima. Procedere?'))
				e.preventDefault();
		}}
	>
		<button class="btn" type="submit" disabled={data.hasMovements}>Crea dati demo</button>
		{#if data.hasMovements}<span class="muted small">Ci sono già movimenti: svuota prima la sezione.</span>{/if}
	</form>
</section>

<section class="card danger-zone">
	<h2>Finanze: svuota</h2>
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
			if (!confirm('Eliminare TUTTI i movimenti? Viene creato un backup prima.')) e.preventDefault();
		}}
	>
		<input type="text" name="confirm" placeholder="scrivi ELIMINA" required />
		<button class="btn danger" type="submit">Svuota tutti i movimenti</button>
	</form>
</section>
