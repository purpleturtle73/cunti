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

	// `match`: prefissi che accendono la voce (il dettaglio posizione è parte di Investimenti)
	// icone: portafoglio (Finanze), grafico in salita (Investimenti), ingranaggio (Admin,
	// tracciato "settings" di Lucide, lucide.dev, licenza ISC)
	const nav = [
		{
			href: '/finanze',
			label: 'Finanze',
			icon: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 6V4H6a3 3 0 0 0-3 3M21 11h-4a2 2 0 0 0 0 4h4M17 13h.01',
			match: ['/finanze']
		},
		{ href: '/investimenti', label: 'Investimenti', icon: 'M4 19 10 12 14 15 20 6M20 6v5M20 6h-5', match: ['/investimenti', '/positions'] },
		{
			href: '/admin',
			label: 'Admin',
			icon: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
			match: ['/admin']
		}
	];
	const isActive = (match: string[]) =>
		match.some((m) => page.url.pathname === m || page.url.pathname.startsWith(m + '/'));

	// Tema: scuro di default. app.html applica la preferenza salvata prima del primo
	// paint (niente lampo di tema sbagliato); qui la si legge e la si cambia.
	const THEME_KEY = 'cunti:theme';
	let theme = $state<'dark' | 'light'>('dark');
	$effect(() => {
		theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
	});
	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem(THEME_KEY, theme);
		} catch {
			/* storage non disponibile: il tema vale per questa visita */
		}
	}

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
	<a class="logo" href="/finanze">
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
					class={['nav-item', { active: isActive(item.match) }]}
					aria-current={isActive(item.match) ? 'page' : undefined}
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
				type="button"
				class="btn ghost theme-toggle"
				onclick={toggleTheme}
				aria-pressed={theme === 'light'}
				aria-label={theme === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
				title={collapsed ? (theme === 'dark' ? 'Tema chiaro' : 'Tema scuro') : undefined}
			>
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					{#if theme === 'dark'}
						<!-- sole: azione = passare al chiaro -->
						<circle cx="12" cy="12" r="4" />
						<path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
					{:else}
						<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
					{/if}
				</svg>
				<span class="nav-label">{theme === 'dark' ? 'Tema chiaro' : 'Tema scuro'}</span>
			</button>
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
		background: var(--sidebar-bg);
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
		background: var(--hover);
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
		background: var(--hover);
		color: var(--ink);
	}
	.nav-item.active {
		background: var(--selected);
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
			box-shadow: 0 0 40px var(--shadow);
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
