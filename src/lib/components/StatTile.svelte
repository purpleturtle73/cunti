<script lang="ts">
	let {
		label,
		value,
		sub = '',
		tone = 'neutral' as 'neutral' | 'pos' | 'neg',
		hint = ''
	}: {
		label: string;
		value: string;
		sub?: string;
		tone?: 'neutral' | 'pos' | 'neg';
		hint?: string;
	} = $props();
</script>

<div class="tile" title={hint}>
	<span class="label">{label}</span>
	<span class={['value', 'tabular', tone]}>{value}</span>
	{#if sub}
		<span class="sub">{sub}</span>
	{/if}
</div>

<style>
	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0)),
			var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.2rem;
		min-width: 0;
	}
	.label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--ink-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.value {
		font-family: var(--font-display);
		font-size: 1.45rem;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	.value.pos {
		color: var(--good);
	}
	.value.neg {
		color: var(--bad);
	}
	.sub {
		font-size: 0.75rem;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
</style>
