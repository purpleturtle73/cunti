<script lang="ts">
	import { fmtEur } from '$lib/format';

	interface Bar {
		month: string; // YYYY-MM
		invested: number;
		divested: number;
	}

	let { bars, height = 220 }: { bars: Bar[]; height?: number } = $props();

	const PAD = { top: 12, right: 8, bottom: 26, left: 54 };

	let width = $state(0);
	let hovered: number | null = $state(null);

	const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

	function label(month: string): string {
		const [y, m] = month.split('-');
		return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
	}

	let plot = $derived.by(() => {
		const w = width - PAD.left - PAD.right;
		const h = height - PAD.top - PAD.bottom;
		if (bars.length === 0 || w <= 10) return null;
		const max = Math.max(...bars.map((b) => Math.max(b.invested, b.divested)), 1);
		const slot = w / bars.length;
		const bw = Math.min(34, slot * 0.62);
		const scale = (v: number) => (v / max) * h;
		return { w, h, slot, bw, scale, max };
	});

	let anyDivested = $derived(bars.some((b) => b.divested > 0.005));
</script>

<div class="wrap" bind:clientWidth={width} style:height="{height}px">
	{#if plot}
		<svg width={width} {height} role="img" aria-label="Flussi mensili di investimento">
			<line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plot.h} y2={PAD.top + plot.h} stroke="var(--baseline)" />
			<text x={PAD.left - 8} y={PAD.top + 4} text-anchor="end" class="tick">{fmtEur(plot.max, true)}</text>

			{#each bars as b, i (b.month)}
				{@const cx = PAD.left + i * plot.slot + plot.slot / 2}
				{@const hInv = plot.scale(b.invested)}
				{@const hDiv = plot.scale(b.divested)}
				<g
					role="presentation"
					opacity={hovered == null || hovered === i ? 1 : 0.35}
					onpointerenter={() => (hovered = i)}
					onpointerleave={() => (hovered = null)}
				>
					<rect x={cx - plot.slot / 2} y={PAD.top} width={plot.slot} height={plot.h} fill="transparent" />
					{#if b.invested > 0}
						<rect
							x={anyDivested ? cx - plot.bw / 2 - 1 : cx - plot.bw / 2}
							width={anyDivested ? plot.bw / 2 : plot.bw}
							y={PAD.top + plot.h - hInv}
							height={hInv}
							rx="4"
							fill="var(--series-1)"
						/>
					{/if}
					{#if b.divested > 0}
						<rect x={cx + 1} width={plot.bw / 2} y={PAD.top + plot.h - hDiv} height={hDiv} rx="4" fill="var(--series-2)" />
					{/if}
				</g>
				{#if bars.length <= 13 || i % 2 === (bars.length - 1) % 2}
					<text x={cx} y={height - 8} text-anchor="middle" class="tick">{label(b.month)}</text>
				{/if}
			{/each}
		</svg>

		{#if hovered != null && bars[hovered]}
			{@const b = bars[hovered]}
			<div class="tooltip" style:left="{Math.min(width - 150, Math.max(4, PAD.left + hovered * plot.slot - 40))}px">
				<strong>{label(b.month)}</strong>
				<span><i style:background="var(--series-1)"></i>Investito {fmtEur(b.invested)}</span>
				{#if b.divested > 0}
					<span><i style:background="var(--series-2)"></i>Disinvestito {fmtEur(b.divested)}</span>
				{/if}
			</div>
		{/if}
	{:else}
		<p class="empty">Nessun flusso registrato.</p>
	{/if}
</div>
{#if anyDivested}
	<div class="legend">
		<span><i style:background="var(--series-1)"></i>Investito</span>
		<span><i style:background="var(--series-2)"></i>Disinvestito</span>
	</div>
{/if}

<style>
	.wrap {
		position: relative;
		width: 100%;
	}
	.tick {
		fill: var(--ink-3);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.tooltip {
		position: absolute;
		top: 0;
		pointer-events: none;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: 0.5rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.8rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
		white-space: nowrap;
		z-index: 2;
	}
	.tooltip strong {
		font-size: 0.72rem;
		color: var(--ink-3);
		font-weight: 500;
	}
	.tooltip span,
	.legend span {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-variant-numeric: tabular-nums;
	}
	.tooltip i,
	.legend i {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		flex: none;
	}
	.legend {
		display: flex;
		gap: 1.4rem;
		margin-top: 0.5rem;
		font-size: 0.78rem;
		color: var(--ink-2);
	}
	.empty {
		color: var(--ink-3);
		text-align: center;
		padding-top: 3rem;
	}
</style>
