<script lang="ts">
	import { fmtEur, fmtPct } from '$lib/format';

	interface Slice {
		label: string;
		value: number;
		color: string;
		sub?: string;
	}

	let { slices, title = 'Totale' }: { slices: Slice[]; title?: string } = $props();

	const SIZE = 210;
	const R = 84;
	const THICK = 26;
	const GAP_DEG = 2.2;

	let hovered: number | null = $state(null);

	let total = $derived(slices.reduce((s, x) => s + x.value, 0));

	function arcPath(startDeg: number, endDeg: number): string {
		const c = SIZE / 2;
		const rOut = R;
		const rIn = R - THICK;
		const s = ((startDeg - 90) * Math.PI) / 180;
		const e = ((endDeg - 90) * Math.PI) / 180;
		const large = endDeg - startDeg > 180 ? 1 : 0;
		const p = (r: number, a: number) => `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
		return `M${p(rOut, s)}A${rOut},${rOut} 0 ${large} 1 ${p(rOut, e)}L${p(rIn, e)}A${rIn},${rIn} 0 ${large} 0 ${p(rIn, s)}Z`;
	}

	let arcs = $derived.by(() => {
		if (total <= 0) return [];
		let angle = 0;
		return slices.map((s, i) => {
			const sweep = (s.value / total) * 360;
			const gap = slices.length > 1 ? GAP_DEG : 0;
			const d = arcPath(angle + gap / 2, Math.max(angle + gap / 2 + 0.5, angle + sweep - gap / 2));
			angle += sweep;
			return { ...s, d, i };
		});
	});

	let center = $derived(
		hovered != null && arcs[hovered]
			? { label: arcs[hovered].label, value: arcs[hovered].value, pct: arcs[hovered].value / total }
			: { label: title, value: total, pct: null }
	);
</script>

<div class="donut">
	<svg viewBox="0 0 {SIZE} {SIZE}" width={SIZE} height={SIZE} role="img" aria-label="Allocazione del portafoglio">
		{#each arcs as a (a.label)}
			<path
				role="presentation"
				d={a.d}
				fill={a.color}
				opacity={hovered == null || hovered === a.i ? 1 : 0.28}
				onpointerenter={() => (hovered = a.i)}
				onpointerleave={() => (hovered = null)}
			/>
		{/each}
		<text x={SIZE / 2} y={SIZE / 2 - 12} text-anchor="middle" class="c-label">{center.label}</text>
		<text x={SIZE / 2} y={SIZE / 2 + 10} text-anchor="middle" class="c-value">{fmtEur(center.value, true)}</text>
		{#if center.pct != null}
			<text x={SIZE / 2} y={SIZE / 2 + 28} text-anchor="middle" class="c-pct">{fmtPct(center.pct, false)}</text>
		{/if}
	</svg>

	<ul>
		{#each arcs as a (a.label)}
			<li
				class={{ dim: hovered != null && hovered !== a.i }}
				onpointerenter={() => (hovered = a.i)}
				onpointerleave={() => (hovered = null)}
			>
				<i style:background={a.color}></i>
				<span class="name">{a.label}</span>
				<span class="w tabular">{fmtPct(a.value / total, false)}</span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.donut {
		display: flex;
		align-items: center;
		gap: 1.4rem;
		flex-wrap: wrap;
	}
	path {
		cursor: pointer;
		transition: opacity 0.12s;
	}
	.c-label {
		fill: var(--ink-3);
		font-size: 11.5px;
	}
	.c-value {
		fill: var(--ink);
		font-size: 21px;
		font-weight: 650;
		font-family: var(--font-display);
	}
	.c-pct {
		fill: var(--ink-2);
		font-size: 12px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 190px;
		flex: 1;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-size: 0.85rem;
		cursor: default;
		transition: opacity 0.12s;
	}
	li.dim {
		opacity: 0.4;
	}
	li i {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		flex: none;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.w {
		margin-left: auto;
		color: var(--ink-2);
	}
</style>
