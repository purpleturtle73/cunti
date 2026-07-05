<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/space-grotesk';
	import '../app.css';
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

	const nav = [
		{ href: '/', label: 'Dashboard', icon: 'M4 19 10 12 14 15 20 6M20 6v5M20 6h-5' },
		{ href: '/transactions', label: 'Transazioni', icon: 'M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4' },
		{ href: '/instruments', label: 'Strumenti', icon: 'M12 3v18M5 8c2 0 3-2 7-2s5 2 7 2M5 16c2 0 3-2 7-2s5 2 7 2' }
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

<div class="shell">
	<aside>
		<a class="logo" href="/">
			<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
				<defs>
					<linearGradient id="lg" x1="0" y1="1" x2="1" y2="0">
						<stop offset="0" stop-color="#3987e5" />
						<stop offset="1" stop-color="#9085e9" />
					</linearGradient>
				</defs>
				<rect width="32" height="32" rx="8" fill="#161615" />
				<path
					d="M6 22 L13 14 L18 18 L26 8"
					fill="none"
					stroke="url(#lg)"
					stroke-width="3.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<span>Cunti</span>
		</a>

		<nav>
			{#each nav as item (item.href)}
				<a href={item.href} class={['nav-item', { active: page.url.pathname === item.href || (item.href !== '/' && page.url.pathname.startsWith(item.href)) }]}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d={item.icon} />
					</svg>
					{item.label}
				</a>
			{/each}

			<span class="nav-item disabled" title="In arrivo: tracciamento spese personali">
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M3 7h18v13H3zM3 11h18M7 16h4" />
				</svg>
				Spese
				<em>presto</em>
			</span>
		</nav>

		<div class="side-footer">
			<button class="btn ghost" onclick={refresh} disabled={refreshing}>
				{refreshing ? 'Aggiorno…' : '↻ Aggiorna prezzi'}
			</button>
			<small>Ultimo: {lastRefreshLabel}</small>
		</div>
	</aside>

	<main>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 230px 1fr;
		min-height: 100vh;
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
	.nav-item.disabled {
		color: var(--ink-3);
		cursor: default;
	}
	.nav-item.disabled:hover {
		background: none;
		color: var(--ink-3);
	}
	.nav-item em {
		margin-left: auto;
		font-style: normal;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
	}

	.side-footer {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.side-footer small {
		color: var(--ink-3);
		font-size: 0.72rem;
		text-align: center;
	}

	main {
		padding: 2rem 2.4rem 4rem;
		max-width: 1280px;
		width: 100%;
		margin: 0 auto;
		min-width: 0;
	}

	@media (max-width: 900px) {
		.shell {
			grid-template-columns: 1fr;
		}
		aside {
			position: static;
			height: auto;
			flex-direction: row;
			align-items: center;
			border-right: none;
			border-bottom: 1px solid var(--border);
		}
		nav {
			flex-direction: row;
		}
		.side-footer {
			margin-top: 0;
			margin-left: auto;
		}
		main {
			padding: 1.2rem;
		}
	}
</style>
