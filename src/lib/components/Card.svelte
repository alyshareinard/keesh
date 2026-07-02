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
	const colorClass = $derived(
		suitColor(card.suit) === 'red' ? 'text-red-600' : 'text-slate-900'
	);
</script>

<button
	type="button"
	class="relative w-16 h-24 sm:w-20 sm:h-28 bg-white rounded-lg shadow-md flex flex-col items-center justify-between p-1 transition-transform hover:-translate-y-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 touch-manipulation"
	class:ring-2={selected}
	class:ring-emerald-400={selected}
	class:-translate-y-3={selected}
	aria-label={cardName(card)}
	onclick={() => onclick?.()}
>
	<span class="absolute top-1 left-1 text-sm sm:text-xs font-bold {colorClass}">
		{card.rank}{symbol}
	</span>
	<span class="text-4xl sm:text-3xl {colorClass}">{symbol}</span>
	<span class="absolute bottom-1 right-1 text-sm sm:text-xs font-bold {colorClass} rotate-180">
		{card.rank}{symbol}
	</span>
</button>
