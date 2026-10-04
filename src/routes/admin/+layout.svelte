<script lang="ts">
	import { page } from '$app/state';
	import './admin.css';

	let { data, children } = $props();

	// Generale = ciò che vale per tutta l'app; poi un'area per dominio.
	// Categorie e Conflitti sono sottopagine delle Spese ma stanno in prima fila:
	// sono gli strumenti che si usano più spesso dopo un import.
	const tabs = [
		{ href: '/admin', label: 'Generale' },
		{ href: '/admin/transazioni', label: 'Transazioni' },
		{ href: '/admin/spese', label: 'Spese' },
		{ href: '/admin/spese/categorie', label: 'Categorie', child: true },
		{ href: '/admin/spese/conflitti', label: 'Conflitti', child: true }
	];
</script>

<div class="admin-area">
	<h1 class="page-title">Amministrazione</h1>
	<p class="app-version">
		Versione immagine <code title="Release dell'immagine container in esecuzione">{data.version}</code>
		{#if data.version === 'dev'}<span class="muted">(esecuzione fuori da un'immagine)</span>{/if}
	</p>

	<nav class="admin-tabs" aria-label="Sezioni dell'amministrazione">
		{#each tabs as t (t.href)}
			<a
				href={t.href}
				class={['admin-tab', { child: t.child, active: page.url.pathname === t.href }]}
				aria-current={page.url.pathname === t.href ? 'page' : undefined}
			>
				{t.label}
			</a>
		{/each}
	</nav>

	{@render children()}
</div>
