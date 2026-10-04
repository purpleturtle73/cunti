<script lang="ts">
	import { fmtEur } from '$lib/format';

	interface Bar {
		label: string; // etichetta breve (anno o mese)
		moneyIn: number;
		moneyOut: number; // positivo
	}

	let {
		bars,
		height = 240,
		onselect
	}: { bars: Bar[]; height?: number; onselect?: (label: string) => void } = $props();

	const PAD = { top: 14, right: 8, bottom: 26, left: 62 };

	let width = $state(0);
	let hovered: number | null = $state(null);

	const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

	function shortLabel(label: string): string {
		if (/^\d{4}-\d{2}$/.test(label)) return MONTHS[Number(label.slice(5)) - 1];
		return label;
	}

	let plot = $derived.by(() => {
		const w = width - PAD.left - PAD.right;
		const h = height - PAD.top - PAD.bottom;
		if (bars.length === 0 || w <= 10) return null;
		const max = Math.max(...bars.map((b) => Math.max(b.moneyIn, b.moneyOut)), 1);
		const slot = w / bars.length;
		const bw = Math.min(38, slot * 0.62);
		const scale = (v: number) => (v / max) * h;
		return { w, h, slot, bw, scale, max };
	});
</script>

<div class="wrap" bind:clientWidth={width} style:height="{height}px">
	{#if plot}
		<svg width={width} {height} role="img" aria-label="Entrate e uscite per periodo">
			<line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plot.h} y2={PAD.top + plot.h} stroke="var(--baseline)" />
			<text x={PAD.left - 8} y={PAD.top + 4} text-anchor="end" class="tick">{fmtEur(plot.max, true)}</text>

			{#each bars as b, i (b.label)}
				{@const cx = PAD.left + i * plot.slot + plot.slot / 2}
				{@const hIn = plot.scale(b.moneyIn)}
				{@const hOut = plot.scale(b.moneyOut)}
				<g
					role="presentation"
					class={{ clickable: !!onselect }}
					opacity={hovered == null || hovered === i ? 1 : 0.35}
					onpointerenter={() => (hovered = i)}
					onpointerleave={() => (hovered = null)}
					onclick={() => onselect?.(b.label)}
				>
					<rect x={cx - plot.slot / 2} y={PAD.top} width={plot.slot} height={plot.h} fill="transparent" />
					{#if b.moneyIn > 0}
						<rect x={cx - plot.bw / 2 - 1} width={plot.bw / 2} y={PAD.top + plot.h - hIn} height={hIn} rx="4" fill="var(--good)" opacity="0.85" />
					{/if}
					{#if b.moneyOut > 0}
						<rect x={cx + 1} width={plot.bw / 2} y={PAD.top + plot.h - hOut} height={hOut} rx="4" fill="var(--bad)" opacity="0.85" />
					{/if}
				</g>
				{#if bars.length <= 14 || i % 2 === (bars.length - 1) % 2}
					<text x={cx} y={height - 8} text-anchor="middle" class="tick">{shortLabel(b.label)}</text>
				{/if}
			{/each}
		</svg>

		{#if hovered != null && bars[hovered]}
			{@const b = bars[hovered]}
			<div class="tooltip" style:left="{Math.min(width - 170, Math.max(4, PAD.left + hovered * plot.slot - 40))}px">
				<strong>{b.label}</strong>
				<span><i class="in"></i>Entrate {fmtEur(b.moneyIn)}</span>
				<span><i class="out"></i>Uscite {fmtEur(b.moneyOut)}</span>
				<span class="net">Saldo {fmtEur(b.moneyIn - b.moneyOut)}</span>
			</div>
		{/if}
	{:else}
		<p class="empty">Nessun dato.</p>
	{/if}
</div>
<div class="legend">
	<span><i class="in"></i>Entrate</span>
	<span><i class="out"></i>Uscite</span>
</div>

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
	.clickable {
		cursor: pointer;
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
		box-shadow: 0 8px 24px var(--shadow);
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
	.tooltip .net {
		color: var(--ink-2);
	}
	i.in,
	i.out {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		flex: none;
	}
	i.in {
		background: var(--good);
	}
	i.out {
		background: var(--bad);
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
