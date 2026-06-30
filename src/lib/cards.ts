export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
	suit: Suit;
	rank: Rank;
}

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function createDeck(): Card[] {
	return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
}

export function createDecks(count: number): Card[] {
	const deck = createDeck();
	return Array.from({ length: count }, () => deck).flat();
}

export function isRed(card: Card): boolean {
	return card.suit === 'hearts' || card.suit === 'diamonds';
}

export function cardPoints(card: Card): number {
	if (card.rank === 'K') return isRed(card) ? 12 : 0;
	if (card.rank === 'Q') return 11;
	if (card.rank === 'J') return -1;
	if (card.rank === 'A') return 1;
	return parseInt(card.rank, 10);
}

export function shuffle<T>(array: T[]): T[] {
	const a = [...array];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

export function suitSymbol(suit: Suit): string {
	switch (suit) {
		case 'hearts':
			return '♥';
		case 'diamonds':
			return '♦';
		case 'clubs':
			return '♣';
		case 'spades':
			return '♠';
	}
}

export function suitColor(suit: Suit): 'red' | 'black' {
	return suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black';
}

export function cardName(card: Card): string {
	return `${card.rank} of ${card.suit}`;
}
