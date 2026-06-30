<script lang="ts">
	import Card from './Card.svelte';
	import type { Card as CardType } from '$lib/cards';

	let {
		cards,
		selectedCard,
		onSelect
	}: {
		cards: CardType[];
		selectedCard: CardType | null;
		onSelect: (card: CardType) => void;
	} = $props();
</script>

<div class="flex flex-wrap items-end justify-center gap-2 p-4">
	{#each cards as card (card.suit + card.rank)}
		<Card
			{card}
			selected={selectedCard === card}
			onclick={() => onSelect(card)}
		/>
	{/each}
</div>
