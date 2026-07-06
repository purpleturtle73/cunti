<script lang="ts">
	import { categoryColor, EXPENSE_ICONS } from '$lib/expense-icons';

	let {
		category,
		icon = '',
		color = '',
		size = 18
	}: { category: string; icon?: string; color?: string; size?: number } = $props();

	let path = $derived(EXPENSE_ICONS[icon] ?? null);
	let tint = $derived(color || categoryColor(category));
</script>

<span class="cat-ico" title={category} style:color={tint} style:width="{size + 8}px" style:height="{size + 8}px">
	{#if path}
		<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d={path} />
		</svg>
	{:else}
		<b>{(category[0] ?? '?').toUpperCase()}</b>
	{/if}
</span>

<style>
	.cat-ico {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 7px;
		background: color-mix(in srgb, currentColor 14%, transparent);
		flex: none;
		vertical-align: middle;
	}
	b {
		font-size: 0.72rem;
		font-weight: 700;
	}
</style>
