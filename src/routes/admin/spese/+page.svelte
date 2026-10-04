<script lang="ts">
	import { enhance } from '$app/forms';
	import { matchCard } from '$lib/cards';
	import { fmtDate, fmtEur } from '$lib/format';

	let { form, data } = $props();
</script>

<svelte:head><title>Cunti — Amministrazione · Spese</title></svelte:head>

<p class="muted area-intro">
	Categorie e keyword si gestiscono in <a class="link" href="/admin/spese/categorie">Categorie</a>;
	le voci in cui la tua categoria non coincide con le regole in
	<a class="link" href="/admin/spese/conflitti">Conflitti</a>.
</p>

<section class="card">
	<h2>Spese: card / conti</h2>
	<p class="muted">
		Config statica dei conti e delle carte che compaiono nel campo <code>card</code> delle spese: il logo
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

	{#if data.cardUsage.length > 0}
		<h3 class="sub-title">Valori nelle spese</h3>
		<p class="muted">
			Valori effettivi del campo <code>card</code> nello storico. Gli export bancari producono
			varianti di battitura dello stesso conto (maiuscole, punti finali) che spezzano filtro e
			statistiche per card: rinomina una variante <strong>verso un valore già esistente</strong> per
			<strong>unirle</strong>. La modifica propaga subito su tutte le spese, quindi conviene avere un
			backup prima di toccare molte righe.
		</p>
		<div class="scroll-x">
			<table class="data compact">
				<thead>
					<tr>
						<th>Valore</th>
						<th class="num">Spese</th>
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
