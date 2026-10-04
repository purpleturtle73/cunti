<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let restoring = $state(false);

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

<svelte:head><title>Cunti — Admin</title></svelte:head>

<p class="muted area-intro">
	Impostazioni comuni a tutta l'app. Strumenti, broker e import delle operazioni stanno in
	<a class="link" href="/admin/investimenti">Investimenti</a>; card, import, categorie e conflitti
	dei movimenti in <a class="link" href="/admin/finanze">Finanze</a>.
</p>

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
