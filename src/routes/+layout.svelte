<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/space-grotesk';
	import '../app.css';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';

	let { data, children } = $props();

	let refreshing = $state(false);

	async function refresh() {
		refreshing = true;
		try {
			await fetch('/api/refresh', { method: 'POST' });
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	const STORAGE_KEY = 'cunti:sidebar-collapsed';

	/** Barra ridotta a sole icone (desktop). Preferenza per browser. */
	let collapsed = $state(false);
	/** Drawer aperto (sotto i 900px la barra è fuori schermo). */
	let drawerOpen = $state(false);

	// La preferenza si legge dopo l'idratazione: il markup SSR resta quello espanso.
	$effect(() => {
		collapsed = localStorage.getItem(STORAGE_KEY) === '1';
	});

	function toggleCollapsed() {
		collapsed = !collapsed;
		if (browser) localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
	}

	// Cambio pagina: il drawer si richiude da solo.
	$effect(() => {
		if (page.url.pathname) drawerOpen = false;
	});

	const nav = [
		{ href: '/', label: 'Dashboard', icon: 'M4 19 10 12 14 15 20 6M20 6v5M20 6h-5' },
		{ href: '/transactions', label: 'Transazioni', icon: 'M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4' },
		{ href: '/spese', label: 'Spese', icon: 'M3 7h18v13H3zM3 11h18M7 16h4' },
		{ href: '/admin', label: 'Amministrazione', icon: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1' }
	];

	let lastRefreshLabel = $derived(
		data.lastRefresh
			? new Date(data.lastRefresh).toLocaleString('it-IT', {
					day: '2-digit',
					month: '2-digit',
					hour: '2-digit',
					minute: '2-digit'
				})
			: 'mai'
	);
</script>

{#snippet burgerIcon()}
	<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
		<path d="M4 7h16M4 12h16M4 17h16" />
	</svg>
{/snippet}

{#snippet logo(withName: boolean, gradId: string)}
	<a class="logo" href="/">
		<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
			<defs>
				<linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
					<stop offset="0" stop-color="#3987e5" />
					<stop offset="1" stop-color="#9085e9" />
				</linearGradient>
			</defs>
			<rect width="32" height="32" rx="8" fill="#161615" />
			<path
				d="M6 22 L13 14 L18 18 L26 8"
				fill="none"
				stroke="url(#{gradId})"
				stroke-width="3.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		{#if withName}<span class="logo-name">Cunti</span>{/if}
	</a>
{/snippet}

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') drawerOpen = false; }} />

<div class={['shell', { collapsed, 'drawer-open': drawerOpen }]}>
	<aside id="sidebar" aria-label="Navigazione principale">
		<div class="side-head">
			{@render logo(!collapsed, 'logo-grad-side')}
			<button
				type="button"
				class="burger side-burger"
				aria-expanded={!collapsed}
				aria-controls="sidebar"
				aria-label={collapsed ? 'Espandi la barra laterale' : 'Riduci la barra laterale'}
				title={collapsed ? 'Espandi la barra laterale' : 'Riduci la barra laterale'}
				onclick={toggleCollapsed}
			>
				{@render burgerIcon()}
			</button>
		</div>

		<nav>
			{#each nav as item (item.href)}
				<a
					href={item.href}
					class={['nav-item', { active: page.url.pathname === item.href || (item.href !== '/' && page.url.pathname.startsWith(item.href)) }]}
					title={collapsed ? item.label : undefined}
				>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d={item.icon} />
					</svg>
					<span class="nav-label">{item.label}</span>
				</a>
			{/each}
		</nav>

		<div class="side-footer">
			<button
				class="btn ghost"
				onclick={refresh}
				disabled={refreshing}
				title={collapsed ? 'Aggiorna prezzi' : undefined}
				aria-label="Aggiorna prezzi"
			>
				<span class="refresh-ico" aria-hidden="true">↻</span>
				<span class="nav-label">{refreshing ? 'Aggiorno…' : 'Aggiorna prezzi'}</span>
			</button>
			<small class="nav-label">Ultimo: {lastRefreshLabel}</small>
		</div>
	</aside>

	<button
		type="button"
		class="scrim"
		tabindex={drawerOpen ? 0 : -1}
		aria-label="Chiudi il menu"
		onclick={() => (drawerOpen = false)}
	></button>

	<main>
		<div class="topbar">
			<button
				type="button"
				class="burger"
				aria-expanded={drawerOpen}
				aria-controls="sidebar"
				aria-label={drawerOpen ? 'Chiudi il menu' : 'Apri il menu'}
				onclick={() => (drawerOpen = !drawerOpen)}
			>
				{@render burgerIcon()}
			</button>
			{@render logo(true, 'logo-grad-top')}
		</div>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		--side-w: 230px;
		display: grid;
		grid-template-columns: var(--side-w) 1fr;
		min-height: 100vh;
		transition: grid-template-columns 0.18s ease;
	}
	.shell.collapsed {
		--side-w: 76px;
	}

	aside {
		position: sticky;
		top: 0;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: 2rem;
		padding: 1.4rem 1rem;
		border-right: 1px solid var(--border);
		background: rgba(13, 13, 13, 0.6);
		backdrop-filter: blur(8px);
		overflow: hidden;
	}

	.side-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.shell.collapsed .side-head {
		flex-direction: column;
		gap: 0.7rem;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		padding: 0.2rem 0.4rem;
		white-space: nowrap;
	}

	.burger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		flex: none;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--ink-2);
		cursor: pointer;
		padding: 0;
	}
	.burger:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--ink);
	}
	.burger:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.6rem 0.8rem;
		border-radius: var(--radius-sm);
		color: var(--ink-2);
		font-weight: 500;
		font-size: 0.95rem;
		white-space: nowrap;
	}
	.nav-item svg {
		flex: none;
	}
	.nav-item:hover {
		background: rgba(255, 255, 255, 0.05);
		color: var(--ink);
	}
	.nav-item.active {
		background: linear-gradient(120deg, rgba(57, 135, 229, 0.18), rgba(144, 133, 233, 0.14));
		color: var(--ink);
		box-shadow: inset 0 0 0 1px rgba(57, 135, 229, 0.35);
	}

	.side-footer {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.side-footer .btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		white-space: nowrap;
	}
	.side-footer small {
		color: var(--ink-3);
		font-size: 0.72rem;
		text-align: center;
	}

	/* stato ridotto: restano solo le icone */
	.shell.collapsed .nav-label,
	.shell.collapsed .logo-name {
		display: none;
	}
	.shell.collapsed .nav-item {
		justify-content: center;
		padding: 0.6rem 0;
	}
	.shell.collapsed .side-footer .btn {
		padding: 0.6rem 0;
	}
	.refresh-ico {
		font-size: 1rem;
		line-height: 1;
	}

	/* lo scrim copre la pagina solo con il drawer aperto (mobile) */
	.scrim {
		display: none;
		border: none;
		padding: 0;
	}

	.topbar {
		display: none;
		align-items: center;
		gap: 0.8rem;
		margin-bottom: 1rem;
	}

	main {
		padding: 2rem 2.4rem 4rem;
		width: 100%;
		min-width: 0;
	}

	@media (max-width: 900px) {
		.shell,
		.shell.collapsed {
			--side-w: 0px;
			grid-template-columns: 1fr;
		}
		aside {
			position: fixed;
			z-index: 40;
			top: 0;
			left: 0;
			width: 250px;
			height: 100vh;
			padding: 1.2rem 1rem;
			background: var(--surface);
			border-right: 1px solid var(--border);
			transform: translateX(-100%);
			transition: transform 0.2s ease;
		}
		.shell.drawer-open aside {
			transform: none;
			box-shadow: 0 0 40px rgba(0, 0, 0, 0.6);
		}
		/* nel drawer la barra è sempre estesa, anche se ridotta su desktop */
		.shell.collapsed .nav-label,
		.shell.collapsed .logo-name {
			display: inline;
		}
		.shell.collapsed .side-head {
			flex-direction: row;
		}
		.shell.collapsed .nav-item {
			justify-content: flex-start;
			padding: 0.6rem 0.8rem;
		}
		.side-burger {
			display: none;
		}
		.shell.drawer-open .scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 30;
			background: rgba(0, 0, 0, 0.55);
			cursor: default;
		}
		.topbar {
			display: flex;
		}
		main {
			padding: 1.2rem;
		}
	}
</style>
