<script lang="ts">
	import { fmtDate, fmtEur } from '$lib/format';

	interface Point {
		date: string;
		value: number;
		invested?: number;
	}

	interface Marker {
		date: string;
		type: 'buy' | 'sell';
		label: string;
	}

	let {
		points,
		height = 300,
		showInvested = true,
		markers = []
	}: { points: Point[]; height?: number; showInvested?: boolean; markers?: Marker[] } = $props();

	const PAD = { top: 14, right: 14, bottom: 28, left: 62 };

	let width = $state(0);
	let hoverIdx: number | null = $state(null);

	function niceTicks(min: number, max: number, count = 4): number[] {
		const span = max - min;
		if (span <= 0) return [min];
		const step = Math.pow(10, Math.floor(Math.log10(span / count)));
		const err = (span / count) / step;
		const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
		const s = mult * step;
		const ticks = [];
		for (let v = Math.ceil(min / s) * s; v <= max; v += s) ticks.push(v);
		return ticks;
	}

	let plot = $derived.by(() => {
		const w = width - PAD.left - PAD.right;
		const h = height - PAD.top - PAD.bottom;
		if (points.length < 2 || w <= 10) return null;

		let min = Infinity;
		let max = -Infinity;
		for (const p of points) {
			min = Math.min(min, p.value, showInvested ? (p.invested ?? p.value) : p.value);
			max = Math.max(max, p.value, showInvested ? (p.invested ?? p.value) : p.value);
		}
		if (min === max) {
			min -= 1;
			max += 1;
		}
		const padY = (max - min) * 0.07;
		min = Math.max(0, min - padY);
		max += padY;

		const x = (i: number) => PAD.left + (i / (points.length - 1)) * w;
		const y = (v: number) => PAD.top + h - ((v - min) / (max - min)) * h;

		let line = '';
		let invLine = '';
		for (let i = 0; i < points.length; i++) {
			line += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(points[i].value).toFixed(1)}`;
			if (showInvested && points[i].invested != null)
				invLine += `${invLine === '' ? 'M' : 'L'}${x(i).toFixed(1)},${y(points[i].invested!).toFixed(1)}`;
		}
		const area = `${line}L${x(points.length - 1).toFixed(1)},${PAD.top + h}L${x(0).toFixed(1)},${PAD.top + h}Z`;

		const yTicks = niceTicks(min, max).map((v) => ({ v, y: y(v) }));
		const xTickCount = Math.min(6, points.length);
		const xTicks = Array.from({ length: xTickCount }, (_, k) => {
			const i = Math.round((k / (xTickCount - 1)) * (points.length - 1));
			const anchor = k === 0 ? 'start' : k === xTickCount - 1 ? 'end' : 'middle';
			return { i, x: x(i), label: fmtDate(points[i].date).slice(3), anchor };
		});

		return { x, y, line, invLine, area, yTicks, xTicks, w, h };
	});

	function onMove(e: PointerEvent) {
		if (!plot) return;
		const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
		const rel = (e.clientX - rect.left - PAD.left) / plot.w;
		hoverIdx = Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1))));
	}

	let hover = $derived(hoverIdx != null && plot ? { p: points[hoverIdx], px: plot.x(hoverIdx), py: plot.y(points[hoverIdx].value) } : null);
	let tipRight = $derived(hover != null && width > 0 && hover.px > width * 0.62);

	// Marker operazioni: raggruppati per giorno e ancorati al punto della serie
	let markerDots = $derived.by(() => {
		if (!plot || markers.length === 0) return [];
		const idxByDate = new Map(points.map((p, i) => [p.date, i]));
		const byDay = new Map<string, { buys: Marker[]; sells: Marker[] }>();
		for (const m of markers) {
			if (!idxByDate.has(m.date)) continue; // fuori dal periodo visualizzato
			const g = byDay.get(m.date) ?? { buys: [], sells: [] };
			(m.type === 'buy' ? g.buys : g.sells).push(m);
			byDay.set(m.date, g);
		}
		const out: { x: number; y: number; type: 'buy' | 'sell'; title: string }[] = [];
		for (const [date, g] of byDay) {
			const i = idxByDate.get(date)!;
			const px = plot.x(i);
			const py = plot.y(points[i].value);
			if (g.buys.length > 0)
				out.push({
					x: px,
					y: py,
					type: 'buy',
					title: `${fmtDate(date)}\n${g.buys.map((m) => 'Acquisto ' + m.label).join('\n')}`
				});
			if (g.sells.length > 0)
				out.push({
					x: px,
					y: py - (g.buys.length > 0 ? 9 : 0),
					type: 'sell',
					title: `${fmtDate(date)}\n${g.sells.map((m) => 'Vendita ' + m.label).join('\n')}`
				});
		}
		return out;
	});
</script>

<div class="wrap" bind:clientWidth={width} style:height="{height}px">
	{#if plot}
		<svg width={width} {height} role="img" aria-label="Andamento del valore del portafoglio">
			<defs>
				<linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="var(--series-1)" stop-opacity="0.32" />
					<stop offset="1" stop-color="var(--series-1)" stop-opacity="0" />
				</linearGradient>
			</defs>

			{#each plot.yTicks as t (t.v)}
				<line x1={PAD.left} x2={width - PAD.right} y1={t.y} y2={t.y} stroke="var(--grid)" />
				<text x={PAD.left - 8} y={t.y + 3.5} text-anchor="end" class="tick">{fmtEur(t.v, true)}</text>
			{/each}
			{#each plot.xTicks as t (t.i)}
				<text x={t.x} y={height - 8} text-anchor={t.anchor} class="tick">{t.label}</text>
			{/each}

			<path d={plot.area} fill="url(#areaFill)" />
			<path d={plot.line} fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" />
			{#if showInvested && plot.invLine}
				<path d={plot.invLine} fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="5 4" />
			{/if}

			{#if hover}
				<line x1={hover.px} x2={hover.px} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--baseline)" />
				<circle cx={hover.px} cy={hover.py} r="4.5" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" />
			{/if}

			<rect
				x="0"
				y="0"
				{width}
				{height}
				fill="transparent"
				role="presentation"
				onpointermove={onMove}
				onpointerleave={() => (hoverIdx = null)}
			/>

			{#each markerDots as m (m.type + m.x + m.y)}
				<circle
					cx={m.x}
					cy={m.y}
					r="4"
					class={['marker', m.type]}
					stroke="var(--surface)"
					stroke-width="1.5"
				>
					<title>{m.title}</title>
				</circle>
			{/each}
		</svg>

		{#if hover}
			<div class="tooltip" style:top="{Math.max(6, hover.py - 64)}px" style={tipRight ? `right: ${width - hover.px + 12}px` : `left: ${hover.px + 12}px`}>
				<strong>{fmtDate(hover.p.date)}</strong>
				<span><i style:background="var(--series-1)"></i>Valore {fmtEur(hover.p.value)}</span>
				{#if showInvested && hover.p.invested != null}
					<span><i class="dash"></i>Investito {fmtEur(hover.p.invested)}</span>
				{/if}
			</div>
		{/if}
	{:else}
		<p class="empty">Dati insufficienti — aggiungi transazioni e aggiorna i prezzi.</p>
	{/if}
</div>

{#if showInvested && plot}
	<div class="legend">
		<span><i style:background="var(--series-1)"></i>Valore di mercato</span>
		<span><i class="dash"></i>Capitale investito</span>
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
	.marker.buy {
		fill: var(--good);
	}
	.marker.sell {
		fill: var(--bad);
	}
	.tooltip {
		position: absolute;
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
	i.dash {
		height: 0;
		border-top: 2px dashed var(--ink-3);
		border-radius: 0;
	}
	.legend {
		display: flex;
		gap: 1.4rem;
		margin-top: 0.6rem;
		font-size: 0.78rem;
		color: var(--ink-2);
	}
	.empty {
		color: var(--ink-3);
		text-align: center;
		padding-top: 4rem;
	}
</style>
