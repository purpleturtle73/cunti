<script lang="ts">
	// Paginatore « ‹ Pagina N di M › »: non si mostra se c'è una sola pagina.
	let {
		page,
		pages,
		onpage,
		label = 'Pagine'
	}: { page: number; pages: number; onpage: (n: number) => void; label?: string } = $props();
</script>

{#if pages > 1}
	<nav class="pager" aria-label={label}>
		<button type="button" disabled={page === 1} onclick={() => onpage(1)} aria-label="Prima pagina">«</button>
		<button type="button" disabled={page === 1} onclick={() => onpage(page - 1)} aria-label="Pagina precedente">‹</button>
		<span class="pager-label">Pagina {page} di {pages}</span>
		<button type="button" disabled={page === pages} onclick={() => onpage(page + 1)} aria-label="Pagina successiva">›</button>
		<button type="button" disabled={page === pages} onclick={() => onpage(pages)} aria-label="Ultima pagina">»</button>
	</nav>
{/if}

<style>
	.pager {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.35rem;
		margin: 0.6rem 0;
	}
	button {
		background: transparent;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		color: var(--ink-2);
		font: 600 0.85rem var(--font-body);
		padding: 0.25rem 0.65rem;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		color: var(--ink);
		background: var(--hover);
	}
	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.pager-label {
		font-size: 0.82rem;
		color: var(--ink-2);
		margin: 0 0.4rem;
	}
</style>
