<script lang="ts">
	import { cardName, suitColor, suitSymbol, type Card } from '$lib/cards';

	let {
		card,
		selected = false,
		onclick
	}: {
		card: Card;
		selected?: boolean;
		onclick?: () => void;
	} = $props();

	const symbol = $derived(suitSymbol(card.suit));
	const isJoker = $derived(card.rank === 'Joker');
	const colorClass = $derived(
		isJoker ? 'text-purple-700' : suitColor(card.suit) === 'red' ? 'text-red-600' : 'text-slate-900'
	);
	const cornerLabel = $derived(isJoker ? 'JK' : card.rank);
</script>

<button
	type="button"
	class="relative w-16 h-24 sm:w-20 sm:h-28 bg-white rounded-lg shadow-md flex flex-col items-center justify-center p-1 transition-transform hover:-translate-y-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 touch-manipulation"
	class:ring-2={selected}
	class:ring-emerald-400={selected}
	class:-translate-y-3={selected}
	aria-label={cardName(card)}
	onclick={() => onclick?.()}
>
	<span class="absolute top-1 left-1 text-sm sm:text-xs font-bold {colorClass}">
		{cornerLabel}{symbol}
	</span>
<div class="flex flex-row items-center justify-center">
	{#if isJoker}
		<span class="text-sm sm:text-base font-extrabold tracking-wide {colorClass}">JOKER</span>
	{:else}
		<span class="text-2xl font-bold {colorClass}">{card.rank}</span>
		<span class="text-3xl {colorClass}">{symbol}</span>
	{/if}
</div>
	<span class="absolute bottom-1 right-1 text-sm sm:text-xs font-bold {colorClass} rotate-180">
		{cornerLabel}{symbol}
	</span>
</button>
