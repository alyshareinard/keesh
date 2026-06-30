<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getSocket } from '$lib/socket';
	import { type Card } from '$lib/cards';
	import CardComponent from '$lib/components/Card.svelte';
	import { onMount } from 'svelte';
	import type { Socket } from 'socket.io-client';

	type PlayerPublic = {
		id: string;
		name: string;
		handCount: number;
		handSlots: boolean[];
		looked: boolean;
		isCurrent: boolean;
		score: number | null;
	};

	type DrawnAction = 'peek' | 'spy' | 'blindSwap' | 'lookyLookySwap' | null;

	type PendingChoice =
		| {
				type: 'blindSwap';
				ownCardIndex: number | null;
		  }
		| {
				type: 'lookyLookySwap';
				ownCardIndex: number | null;
				targetPlayerId?: string | null;
				targetCardIndex?: number | null;
				targetCard?: Card;
		  }
		| {
				type: 'snapGive';
				targetPlayerId: string;
				targetSlotIndex: number;
				previousPlayerIndex?: number;
				savedKeeshWindow?: KeeshWindow | null;
		  };

	type KeeshWindow = {
		playerId: string;
		expiresAt: number;
	};

	type GameState = {
		id: string;
		status: 'waiting' | 'looking' | 'playing' | 'finished';
		myPlayerId: string;
		myHand: (Card | null)[];
		myKnownCards: boolean[];
		drawnCard: Card | null;
		drawnAction: DrawnAction;
		pendingChoice: PendingChoice | null;
		players: PlayerPublic[];
		currentPlayerId: string | null;
		dealerPlayerId: string | null;
		keeshCallerId: string | null;
		discardPileTop: Card | null;
		finalScores: Record<string, number> | null;
		totalScores: Record<string, number>;
		matchWinnerIds: string[] | null;
		keeshWindow: KeeshWindow | null;
		log: string[];
	};

	let roomId = $derived(page.params.id);
	let playerName = $derived(page.url.searchParams.get('name') || 'Player');

	let gameState: GameState | null = $state(null);
	let connected = $state(false);
	let client: Socket | null = $state(null);
	let selectMode: 'peek' | 'spy' | null = $state(null);
	let spyResult: { playerId: string; cardIndex: number; card: Card } | null = $state(null);
	let peekReveal: { cardIndex: number; card: Card } | null = $state(null);

	onMount(async () => {
		const socket = await getSocket();
		client = socket;
		if (!socket) return;
		socket.on('connect', () => {
			connected = true;
			socket.emit('join', { roomId, playerName });
		});
		socket.on('disconnect', () => {
			connected = false;
		});
		socket.on('state', (s: GameState) => {
			if (gameState && s.currentPlayerId !== gameState.currentPlayerId) {
				spyResult = null;
			}
			gameState = s;
		});
		socket.on('spyResult', (r) => {
			spyResult = r;
		});
		socket.on('peekReveal', (r: { cardIndex: number; card: Card; duration: number }) => {
			peekReveal = { cardIndex: r.cardIndex, card: r.card };
			setTimeout(() => { peekReveal = null; }, r.duration);
		});
		socket.on('error', (msg: string) => {
			alert(msg);
		});
	});

	function start() {
		client?.emit('start');
	}

	function look(cardIndex: number) {
		client?.emit('look', { cardIndex });
	}

	function draw() {
		client?.emit('draw');
	}

	function discardDrawn() {
		spyResult = null;
		client?.emit('discardDrawn');
	}

	function swap(cardIndex: number) {
		spyResult = null;
		client?.emit('swap', { cardIndex });
	}

	function peek(cardIndex: number) {
		client?.emit('peek', { cardIndex });
	}

	function spy(targetPlayerId: string, cardIndex: number) {
		client?.emit('spy', { targetPlayerId, cardIndex });
	}

	function blindSwap() {
		spyResult = null;
		client?.emit('blindSwap');
	}

	function lookyLookySwap() {
		spyResult = null;
		client?.emit('lookyLookySwap');
	}

	function selectSwapOwnCard(cardIndex: number) {
		client?.emit('selectSwapOwnCard', { cardIndex });
	}

	function selectSwapOpponentCard(targetPlayerId: string, cardIndex: number) {
		client?.emit('selectSwapOpponentCard', { targetPlayerId, cardIndex });
	}

	function selectSnapGiveCard(cardIndex: number) {
		client?.emit('selectSnapGiveCard', { cardIndex });
	}

	function resolveLookyLookySwap(swap: boolean) {
		spyResult = null;
		client?.emit('resolveLookyLookySwap', { swap });
	}

	function snap(targetPlayerId: string, cardIndex: number) {
		client?.emit('snap', { targetPlayerId, cardIndex });
	}

	function callKeesh() {
		client?.emit('keesh');
	}

	function nextRound() {
		client?.emit('nextRound');
	}

	function newMatch() {
		client?.emit('newMatch');
	}

	function leaveRoom() {
		client?.emit('leave');
		goto('/');
	}

	function handleOwnCardClick(cardIndex: number) {
		const g = gameState;
		if (!g) return;
		if (g.status === 'looking') {
			look(cardIndex);
			return;
		}
		const choice = g.pendingChoice;
		if (choice?.type === 'snapGive') {
			selectSnapGiveCard(cardIndex);
			return;
		}
		if (choice?.type === 'blindSwap' && choice.ownCardIndex === null) {
			selectSwapOwnCard(cardIndex);
			return;
		}
		if (choice?.type === 'lookyLookySwap' && choice.ownCardIndex === null) {
			selectSwapOwnCard(cardIndex);
			return;
		}
		if (g.status !== 'playing') return;
		if (selectMode === 'peek') {
			peek(cardIndex);
			selectMode = null;
			return;
		}
		if (g.drawnCard && g.currentPlayerId === g.myPlayerId) {
			swap(cardIndex);
		} else {
			snap(g.myPlayerId, cardIndex);
		}
	}

	function handleOpponentCardClick(playerId: string, cardIndex: number) {
		const g = gameState;
		if (!g || g.status !== 'playing') return;
		const choice = g.pendingChoice;
		if (choice?.type === 'snapGive') return;
		if (choice?.type === 'blindSwap') {
			if (choice.ownCardIndex !== null) {
				selectSwapOpponentCard(playerId, cardIndex);
			}
			return;
		}
		if (choice?.type === 'lookyLookySwap') {
			if (choice.ownCardIndex !== null && choice.targetPlayerId == null) {
				selectSwapOpponentCard(playerId, cardIndex);
			}
			return;
		}
		if (selectMode === 'spy') {
			spy(playerId, cardIndex);
			selectMode = null;
			return;
		}
		snap(playerId, cardIndex);
	}

	function isMyTurn() {
		return gameState?.currentPlayerId === gameState?.myPlayerId;
	}

	function statusText() {
		const g = gameState;
		if (!g) return 'Connecting...';
		if (g.status === 'waiting') return 'Waiting for players';
		if (g.status === 'looking') {
			const me = g.players.find((p) => p.id === g.myPlayerId);
			return me?.looked ? 'Waiting for others to look at their cards' : 'Look at one card to start';
		}
		if (g.status === 'finished') {
			if (g.matchWinnerIds && g.matchWinnerIds.length > 0) return 'Game over — scores below';
			return 'Round over — scores below';
		}
		if (!isMyTurn()) return `Waiting for ${g.players.find((p) => p.id === g.currentPlayerId)?.name ?? '...'}`;
		const choice = g.pendingChoice;
		if (choice?.type === 'snapGive') {
			return `Choose a card to give to ${playerNameById(choice.targetPlayerId)}`;
		}
			if (choice?.type === 'blindSwap') {
			if (choice.ownCardIndex === null) return 'Select one of your face-down cards to swap';
			return 'Select an opponent face-down card to swap';
		}
		if (choice?.type === 'lookyLookySwap') {
			if (choice.ownCardIndex === null) return 'Select one of your face-down cards to swap';
			if (choice.targetCard == null) return 'Select an opponent face-down card to swap';
			return 'Swap or keep the opponent card?';
		}
		if (g.keeshWindow?.playerId === g.myPlayerId) return 'Call Keesh now or pass';
		if (g.drawnCard) return 'Your turn: choose an action with the drawn card';
		return 'Your turn: draw a card';
	}

	function actionLabel(action: DrawnAction): string {
		switch (action) {
			case 'peek':
				return 'Peek at your own card';
			case 'spy':
				return 'Spy on an opponent';
			case 'blindSwap':
				return 'Blind swap (discard queen)';
			case 'lookyLookySwap':
				return 'Looky-looky swap (discard red king)';
			default:
				return '';
		}
	}

	function cardHint(): string {
		const g = gameState;
		if (!g) return '';
		if (g.status === 'looking') return 'Click a face-down card to peek';
		const choice = g.pendingChoice;
		if (choice?.type === 'snapGive') {
			return `Click one of your cards to give to ${playerNameById(choice.targetPlayerId)}`;
		}
		if (choice?.type === 'blindSwap') {
			if (choice.ownCardIndex === null) return 'Click one of your face-down cards to swap';
			return 'Click an opponent face-down card to swap';
		}
		if (choice?.type === 'lookyLookySwap') {
			if (choice.ownCardIndex === null) return 'Click one of your face-down cards to swap';
			if (choice.targetCard == null) return 'Click an opponent face-down card to swap';
			return 'Choose Swap or Keep';
		}
		if (g.status !== 'playing') return '';
		if (selectMode) {
			if (selectMode === 'peek') return 'Click one of your face-down cards to peek';
			return 'Click an opponent face-down card to spy';
		}
		if (g.keeshWindow?.playerId === g.myPlayerId) return 'Click the green Keesh button to call keesh';
		if (g.drawnCard && g.currentPlayerId === g.myPlayerId)
			return 'Click a face-down card to swap, or discard the drawn card';
		if (!g.drawnCard && g.currentPlayerId === g.myPlayerId) return 'Draw a card, then swap or use its action';
		return 'Click any face-down card to snap';
	}

	function playerNameById(id: string): string {
		return gameState?.players.find((p) => p.id === id)?.name ?? 'Unknown';
	}
</script>



<div class="min-h-screen flex flex-col bg-green-900 text-white">
	<header class="flex items-center justify-between p-4 bg-black/20">
		<h1 class="font-bold text-lg">Room: {roomId}</h1>
		<div class="flex items-center gap-3">
			<span class="text-emerald-100">{playerName}</span>
			<span
				class="text-xs uppercase tracking-wider {connected ? 'text-emerald-400' : 'text-red-400'}"
			>
				{connected ? 'Online' : 'Offline'}
			</span>
			<button
				onclick={leaveRoom}
				class="px-3 py-1 text-xs bg-red-800/60 hover:bg-red-700 rounded transition-colors touch-manipulation"
			>Leave</button>
		</div>
	</header>

	<main class="flex-1 flex flex-col items-center p-4 gap-6 overflow-auto">
		{#if !gameState}
			<p class="text-emerald-100">Connecting...</p>
		{:else if gameState.status === 'waiting'}
			<div class="text-center w-full max-w-sm">
				<p class="mb-4 text-emerald-100">Waiting for players...</p>
				<div class="bg-black/20 rounded-lg p-4 mb-6">
					<p class="text-sm text-emerald-200 mb-2">
						Joined: {gameState.players.length} player{gameState.players.length === 1 ? '' : 's'}
					</p>
					<ul class="space-y-1">
						{#each gameState.players as player}
							<li class="text-emerald-100 font-medium">
								{player.name}
								{player.id === gameState.myPlayerId ? '(you)' : ''}
							</li>
						{/each}
					</ul>
				</div>
				{#if gameState.players.length > 1}
					<button
						onclick={start}
						class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold shadow transition-colors touch-manipulation"
					>
						Start game
					</button>
				{/if}
			</div>
		{:else if gameState.status === 'looking'}
			<div class="text-center max-w-md">
				<p class="text-emerald-100 font-medium mb-2">{statusText()}</p>
				<p class="text-sm text-emerald-200 mb-6">
					Click one of your four face-down cards to peek at it. Once everyone has looked, play begins.
				</p>
			</div>
		{:else if gameState.status === 'finished'}
			<div class="text-center max-w-md">
				{#if gameState.matchWinnerIds && gameState.matchWinnerIds.length > 0}
					<p class="text-emerald-100 font-bold mb-2 text-xl">
						Game over — {gameState.matchWinnerIds.map((id) => playerNameById(id)).join(' & ')} wins!
					</p>
				{:else}
					<p class="text-emerald-100 font-medium mb-4">Round over</p>
				{/if}
				<div class="space-y-2">
					{#each gameState.players as player}
						<div class="bg-black/20 rounded-lg p-3 flex items-center justify-between">
							<span class="font-bold">
								{player.name}
								{player.id === gameState.myPlayerId ? '(you)' : ''}
							</span>
							<div class="text-right text-sm">
								<div class="text-emerald-100">
									Round: {gameState.finalScores?.[player.id] ?? '-'}
								</div>
								<div class="text-emerald-200">
									Total: {gameState.totalScores?.[player.id] ?? 0}
								</div>
							</div>
							</div>
						{/each}
				</div>
				{#if gameState.matchWinnerIds && gameState.matchWinnerIds.length > 0}
					<button
						onclick={newMatch}
						class="mt-6 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold shadow transition-colors touch-manipulation"
					>
						New game
					</button>
				{:else}
					<button
						onclick={nextRound}
						class="mt-6 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold shadow transition-colors touch-manipulation"
					>
						Play another round
					</button>
				{/if}
			</div>
		{:else}
			<p class="text-emerald-100 font-medium">{statusText()}</p>

			{#if gameState.keeshCallerId}
				<p class="text-amber-300 text-sm font-semibold">
					Keesh called by {playerNameById(gameState.keeshCallerId)} — one more round!
				</p>
			{/if}

			<div class="flex flex-wrap gap-4 justify-center">
				{#each gameState.players as player}
					<div
						class="bg-black/20 rounded-xl p-4 min-w-[12rem] {player.isCurrent
							? 'ring-2 ring-emerald-400'
							: ''}"
					>
						<h2 class="font-bold mb-2 flex items-center gap-2 flex-wrap">
							{player.name}
							{player.id === gameState.myPlayerId ? '(you)' : ''}
							{#if player.id === gameState.dealerPlayerId}
								<span class="text-xs bg-yellow-500/30 text-yellow-200 px-1.5 py-0.5 rounded">Dealer</span>
							{/if}
						</h2>
						<p class="text-sm text-emerald-100 mb-2">{player.handCount} cards</p>
						{#if player.id === gameState.myPlayerId}
							<div class="flex flex-wrap gap-1 mt-1">
								{#each gameState.myHand as card, i}
									{#if card === null}
										<div
											class="w-10 h-14 sm:w-12 sm:h-16 rounded border border-white/10 bg-black/10 flex items-center justify-center"
											aria-label="Empty slot {i + 1}"
										>
											<span class="text-xs text-white/50">{i + 1}</span>
										</div>
									{:else if peekReveal?.cardIndex === i}
										<CardComponent card={peekReveal.card} onclick={() => handleOwnCardClick(i)} />
									{:else}
										<button
											onclick={() => handleOwnCardClick(i)}
											class="w-10 h-14 sm:w-12 sm:h-16 bg-blue-700 rounded border border-white/20 hover:bg-blue-500 transition-colors flex flex-col items-center justify-center touch-manipulation"
											aria-label="Card {i + 1}"
										>
											<span class="text-xl">🂠</span>
											<span class="text-xs mt-0.5 text-white/80">{i + 1}</span>
										</button>
									{/if}
								{/each}
							</div>
						{:else}
							<div class="flex flex-wrap gap-1">
								{#each player.handSlots as occupied, i}
									{#if occupied}
										<button
											onclick={() => handleOpponentCardClick(player.id, i)}
											class="w-10 h-14 sm:w-12 sm:h-16 bg-blue-700 rounded border border-white/20 hover:bg-blue-500 transition-colors touch-manipulation"
											aria-label="Card {i + 1} from {player.name}"
										></button>
									{:else}
										<div
											class="w-10 h-14 sm:w-12 sm:h-16 rounded border border-white/10 bg-black/10"
											aria-label="Empty slot {i + 1} from {player.name}"
										></div>
									{/if}
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<div class="flex flex-col items-center">
				<h3 class="text-sm uppercase tracking-wider text-emerald-100 mb-2">Discard pile</h3>
				<div class="flex items-center gap-4">
					{#if gameState.discardPileTop}
						<CardComponent card={gameState.discardPileTop} />
					{:else}
						<div
							class="w-16 h-24 sm:w-20 sm:h-28 rounded-lg bg-green-700 border-2 border-white/30 flex items-center justify-center text-sm text-white/80"
						>
							Empty
						</div>
					{/if}
					{#if gameState.keeshWindow?.playerId === gameState.myPlayerId}
						<button
							onclick={callKeesh}
							class="px-4 py-2 bg-green-500 hover:bg-green-400 text-black rounded-lg font-bold animate-pulse transition-colors touch-manipulation"
						>
							Keesh
						</button>
					{:else}
						<button
							disabled
							class="px-4 py-2 bg-gray-700 text-white/50 rounded-lg font-bold cursor-not-allowed"
						>
							Keesh
						</button>
					{/if}
				</div>
			</div>

			{#if gameState.pendingChoice?.type === 'lookyLookySwap' && gameState.pendingChoice.targetCard}
				<div class="flex flex-col items-center gap-3 bg-black/20 rounded-xl p-4 max-w-md">
					<p class="text-sm text-emerald-100">Looky-looky swap — opponent's card:</p>
					<CardComponent card={gameState.pendingChoice.targetCard} />
					<div class="flex gap-2">
						<button
							onclick={() => resolveLookyLookySwap(true)}
							class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold transition-colors touch-manipulation"
						>
							Swap
						</button>
						<button
							onclick={() => resolveLookyLookySwap(false)}
							class="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-semibold transition-colors touch-manipulation"
						>
							Keep
						</button>
					</div>
				</div>
			{/if}

			{#if isMyTurn() && !gameState.pendingChoice}
				{#if gameState.keeshWindow?.playerId === gameState.myPlayerId}
					<p class="text-emerald-100 text-sm">Call Keesh or pass</p>
				{:else if gameState.drawnCard}
					<div class="flex flex-col items-center gap-3">
						<p class="text-sm text-emerald-100">You drew:</p>
						<CardComponent card={gameState.drawnCard} />
						<div class="flex flex-wrap gap-2 justify-center">
							<button
								onclick={discardDrawn}
								class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold transition-colors touch-manipulation"
							>
								Discard it
							</button>
							{#if gameState.drawnAction}
								<button
									onclick={() => { const action = gameState!.drawnAction; if (action === 'peek') selectMode = 'peek'; else if (action === 'spy') selectMode = 'spy'; else if (action === 'blindSwap') blindSwap(); else if (action === 'lookyLookySwap') lookyLookySwap(); }}
									class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition-colors touch-manipulation"
								>
									{actionLabel(gameState!.drawnAction)}
								</button>
							{/if}
							{#if selectMode}
								<button
									onclick={() => (selectMode = null)}
									class="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg font-semibold transition-colors touch-manipulation"
								>
									Cancel
								</button>
							{/if}
						</div>
						<p class="text-sm text-emerald-100">{cardHint()}</p>
					</div>
				{:else}
					<div class="flex flex-wrap gap-2">
						<button
							onclick={draw}
							class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold shadow transition-colors touch-manipulation"
						>
							Draw card
						</button>

					</div>
				{/if}
			{:else if !gameState.pendingChoice}
				<p class="text-emerald-100 text-sm">Wait for your turn — you can still snap!</p>
			{/if}

			{#if spyResult}
				<div class="flex flex-col items-center gap-2 bg-black/20 rounded-xl p-3">
					<p class="text-sm text-emerald-100">
						Spied on {playerNameById(spyResult.playerId)} card #{spyResult.cardIndex + 1}:
					</p>
					<CardComponent card={spyResult.card} />
					<button
						onclick={() => (spyResult = null)}
						class="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 rounded transition-colors touch-manipulation"
					>
						Hide
					</button>
				</div>
			{/if}

			{#if gameState.log.length > 0}
				<div class="w-full max-w-md bg-black/20 rounded-lg p-3 text-sm text-emerald-50">
					{#each gameState.log.slice(-5) as entry}
						<div>{entry}</div>
					{/each}
				</div>
			{/if}
		{/if}
	</main>

</div>
