<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getSocket } from '$lib/socket';
	import { type Card } from '$lib/cards';
	import CardComponent from '$lib/components/Card.svelte';
	import { onMount, onDestroy } from 'svelte';
	import type { Socket } from 'socket.io-client';

	type PlayerPublic = {
		id: string;
		name: string;
		handCount: number;
		handSlots: boolean[];
		looked: boolean;
		isCurrent: boolean;
		disconnected: boolean;
		score: number | null;
	};

	type DrawnAction = 'peek' | 'spy' | 'blindSwap' | 'lookyLookySwap' | null;

	type PendingChoice =
		| { type: 'peek'; playerId: string; cardIndex: number | null }
		| { type: 'spy'; playerId: string; targetPlayerId: string | null; targetCardIndex: number | null }
		| {
				type: 'blindSwap';
				playerId: string;
				targetPlayerId: string | null;
				targetCardIndex: number | null;
				ownCardIndex: number | null;
		  }
		| {
				type: 'lookyLookySwap';
				playerId: string;
				targetPlayerId: string | null;
				targetCardIndex: number | null;
				targetCard?: Card;
				ownCardIndex: number | null;
		  }
		| {
				type: 'snapGive';
				playerId: string;
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
		pendingEndGame: { endsAt: number } | null;
		revealedHands: { id: string; name: string; hand: (Card | null)[] }[] | null;
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
	let nameTaken = $state(false);
	let nameInput = $state('');
	let spyNotify: { cardIndex: number; spiedBy: string } | null = $state(null);
	let swapHighlights: { playerId: string; cardIndex: number }[] = $state([]);
	let keeshCalledBy: string | null = $state(null);
	let swapNotify: { cardIndex: number; swappedBy: string } | null = $state(null);
	let pendingEndGameCountdown = $state(0);
	let drawnCardInfo: Card | null = $state(null);

	onMount(async () => {
		const socket = await getSocket();
		client = socket;
		if (!socket) return;
		if (socket.connected) {
			connected = true;
			socket.emit('join', { roomId, playerName });
		}
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
		socket.on('spyResult', (r: { playerId: string; cardIndex: number; card: Card; duration: number }) => {
			spyResult = r;
			setTimeout(() => { spyResult = null; }, r.duration);
		});
		socket.on('peekReveal', (r: { cardIndex: number; card: Card; duration: number }) => {
			peekReveal = { cardIndex: r.cardIndex, card: r.card };
			setTimeout(() => { peekReveal = null; }, r.duration);
		});
		socket.on('nameTaken', () => {
			nameTaken = true;
			nameInput = playerName;
		});
		socket.on('spyNotify', (r: { cardIndex: number; spiedBy: string }) => {
			spyNotify = r;
			setTimeout(() => { spyNotify = null; }, 4000);
		});
		socket.on('swapHighlight', (slots: { playerId: string; cardIndex: number }[]) => {
			swapHighlights = slots;
			setTimeout(() => { swapHighlights = []; }, 2000);
		});
		socket.on('keeshCalled', (r: { callerName: string }) => {
			keeshCalledBy = r.callerName;
			setTimeout(() => { keeshCalledBy = null; }, 6000);
		});
		socket.on('swapNotify', (r: { cardIndex: number; swappedBy: string }) => {
			swapNotify = r;
			setTimeout(() => { swapNotify = null; }, 4000);
		});
		socket.on('error', (msg: string) => {
			alert(msg);
		});
	});

	onDestroy(() => {
		if (!client) return;
		client.off('connect');
		client.off('disconnect');
		client.off('state');
		client.off('spyResult');
		client.off('peekReveal');
		client.off('nameTaken');
		client.off('spyNotify');
		client.off('swapHighlight');
		client.off('keeshCalled');
		client.off('swapNotify');
		client.off('error');
	});

	$effect(() => {
		const g = gameState;
		const pending = g?.pendingEndGame;
		if (!pending) {
			pendingEndGameCountdown = 0;
			return;
		}
		const update = () => {
			pendingEndGameCountdown = Math.max(0, Math.ceil((pending.endsAt - Date.now()) / 1000));
		};
		update();
		const interval = setInterval(update, 1000);
		return () => clearInterval(interval);
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

	function passKeesh() {
		client?.emit('passKeesh');
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

	function skipAction() {
		client?.emit('skipAction');
	}

	function rejoinWithName() {
		if (!nameInput.trim()) return;
		nameTaken = false;
		client?.emit('join', { roomId, playerName: nameInput.trim() });
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
		if (choice?.type === 'peek') {
			peek(cardIndex);
			return;
		}
		if (choice?.type === 'blindSwap' && choice.targetPlayerId !== null && choice.ownCardIndex === null) {
			selectSwapOwnCard(cardIndex);
			return;
		}
		if (choice?.type === 'lookyLookySwap' && choice.targetPlayerId !== null && choice.ownCardIndex === null) {
			selectSwapOwnCard(cardIndex);
			return;
		}
		if (g.status !== 'playing') return;
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
		if (choice?.type === 'spy') {
			spy(playerId, cardIndex);
			return;
		}
		if (choice?.type === 'blindSwap' && choice.targetPlayerId === null) {
			selectSwapOpponentCard(playerId, cardIndex);
			return;
		}
		if (choice?.type === 'lookyLookySwap' && choice.targetPlayerId === null) {
			selectSwapOpponentCard(playerId, cardIndex);
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
		if (g.pendingEndGame) return `Final snap window: ${pendingEndGameCountdown} seconds left`;
		if (!isMyTurn()) return `Waiting for ${g.players.find((p) => p.id === g.currentPlayerId)?.name ?? '...'}`;
		const choice = g.pendingChoice;
		if (choice?.type === 'snapGive') {
			return `Choose a card to give to ${playerNameById(choice.targetPlayerId)}`;
		}
			if (choice?.type === 'blindSwap') {
			if (choice.targetPlayerId === null) return 'Select an opponent face-down card to swap';
			return 'Select one of your face-down cards to swap';
		}
		if (choice?.type === 'lookyLookySwap') {
			if (choice.targetCardIndex === null) return 'Select an opponent face-down card to swap';
			if (choice.ownCardIndex === null) return 'Select one of your face-down cards to swap';
			return 'Swap or decline the opponent card?';
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

	function cardPoints(card: Card): number {
		if (card.rank === 'K') return card.suit === 'hearts' || card.suit === 'diamonds' ? 12 : 0;
		if (card.rank === 'Q') return 11;
		if (card.rank === 'J') return -1;
		return parseInt(card.rank, 10);
	}

	function cardAbilityText(card: Card): string {
		if (card.rank === '7' || card.rank === '8') return 'Peek at one of your own cards';
		if (card.rank === '9' || card.rank === '10') return 'Spy on an opponent card';
		if (card.rank === 'Q') return 'Blind swap with any opponent card';
		if (card.rank === 'K' && (card.suit === 'hearts' || card.suit === 'diamonds')) {
			return 'Looky-looky swap — peek at an opponent card, then choose to swap or decline';
		}
		return 'No special ability';
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
			if (choice.targetPlayerId === null) return 'Click an opponent face-down card to swap';
			return 'Click one of your face-down cards to swap';
		}
		if (choice?.type === 'lookyLookySwap') {
			if (choice.targetCardIndex === null) return 'Click an opponent face-down card to swap';
			if (choice.ownCardIndex === null) return 'Click one of your face-down cards to swap';
			return 'Choose Swap or Decline';
		}
		if (g.status !== 'playing') return '';
		if (g.pendingEndGame) return 'Click any face-down card to snap before the game ends';
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
		{#if nameTaken}
			<div class="bg-black/30 rounded-2xl p-8 max-w-sm w-full text-center flex flex-col gap-4">
				<p class="text-red-300 font-semibold">That name is already taken in this room.</p>
				<p class="text-emerald-100 text-sm">Choose a different name to join:</p>
				<input
					bind:value={nameInput}
					onkeydown={(e) => e.key === 'Enter' && rejoinWithName()}
					class="w-full px-3 py-2 rounded-lg bg-black/20 border border-white/20 placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-400"
					placeholder="Your name"
				/>
				<button
					onclick={rejoinWithName}
					class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold transition-colors touch-manipulation"
				>Join as {nameInput || '…'}</button>
			</div>
		{:else if !gameState}
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
				{#if gameState.revealedHands}
					<div class="mt-4 w-full">
						<p class="text-emerald-200 text-sm text-center mb-3 uppercase tracking-wider">Final hands</p>
						<div class="flex flex-wrap gap-4 justify-center">
							{#each gameState.revealedHands as rh}
								<div class="bg-black/20 rounded-xl p-3">
									<p class="font-semibold mb-2 text-sm">{rh.name}{rh.id === gameState.myPlayerId ? ' (you)' : ''}</p>
									<div class="flex flex-wrap gap-1">
										{#each rh.hand as card}
											{#if card}
												<CardComponent {card} />
											{:else}
												<div class="w-10 h-14 sm:w-12 sm:h-16 rounded border border-white/10 bg-black/10"></div>
											{/if}
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}
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

			{#if gameState.pendingEndGame}
				<div class="bg-orange-600/80 text-white rounded-lg px-4 py-2 font-bold animate-pulse text-center">
					Final snap window — {pendingEndGameCountdown} seconds left
				</div>
			{/if}

			<div class="flex flex-wrap gap-4 justify-center">
				{#each [...gameState.players].sort((a, b) => a.id === gameState!.myPlayerId ? 1 : b.id === gameState!.myPlayerId ? -1 : 0) as player}
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
							{#if player.disconnected}
								<span class="text-xs bg-red-500/30 text-red-300 px-1.5 py-0.5 rounded">Away</span>
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
																		{:else}
										<button
											onclick={() => handleOwnCardClick(i)}
											class="w-10 h-14 sm:w-12 sm:h-16 bg-blue-700 rounded border hover:bg-blue-500 transition-all flex flex-col items-center justify-center touch-manipulation {swapHighlights.some((h) => h.playerId === gameState!.myPlayerId && h.cardIndex === i) ? 'border-orange-400 ring-2 ring-orange-400' : 'border-white/20'}"
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
											class="w-10 h-14 sm:w-12 sm:h-16 bg-blue-700 rounded border hover:bg-blue-500 transition-all touch-manipulation {swapHighlights.some((h) => h.playerId === player.id && h.cardIndex === i) ? 'border-orange-400 ring-2 ring-orange-400' : 'border-white/20'}"
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
						<div class="flex flex-col gap-2">
							<button
								onclick={callKeesh}
								class="px-4 py-2 bg-green-500 hover:bg-green-400 text-black rounded-lg font-bold animate-pulse transition-colors touch-manipulation"
							>
								Keesh?
							</button>
							<button
								onclick={passKeesh}
								class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold transition-colors touch-manipulation"
							>
								Nah
							</button>
						</div>
					{/if}
				</div>
			</div>

			{#if gameState.pendingChoice?.type === 'lookyLookySwap' && gameState.pendingChoice.targetCard && gameState.pendingChoice.ownCardIndex !== null}
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
							Decline
						</button>
					</div>
				</div>
			{/if}

			{#if isMyTurn() && !gameState.pendingChoice && !gameState.keeshWindow && !gameState.pendingEndGame}
				{#if gameState.drawnCard}
					<div class="flex flex-col items-center gap-3">
						<p class="text-sm text-emerald-100">You drew:</p>
						<div class="relative">
							<CardComponent card={gameState.drawnCard} />
							<button
								onclick={() => (drawnCardInfo = gameState!.drawnCard)}
								class="absolute -top-2 -right-2 w-6 h-6 bg-blue-500 hover:bg-blue-400 rounded-full text-white text-xs font-bold flex items-center justify-center shadow-lg touch-manipulation"
								aria-label="Card info"
							>
								i
							</button>
						</div>
						{#if gameState.drawnAction}
							<p class="text-xs text-emerald-200">Discard to use the {actionLabel(gameState.drawnAction)} ability, or swap it into your hand</p>
						{/if}
						<div class="flex flex-wrap gap-2 justify-center">
							<button
								onclick={discardDrawn}
								class="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg font-semibold transition-colors touch-manipulation"
							>
								Discard{gameState.drawnAction ? ' & use ability' : ''}
							</button>
						</div>
						<p class="text-xs text-emerald-200">— or click one of your cards above to swap —</p>
					</div>
				{:else if gameState.status === 'playing'}
					<div class="flex flex-wrap gap-2">
						<button
							onclick={draw}
							class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold shadow transition-colors touch-manipulation"
						>
							Draw card
						</button>
					</div>
				{/if}
			{:else if gameState.pendingChoice?.playerId === gameState.myPlayerId && gameState.pendingChoice.type === 'peek'}
				<div class="flex flex-col items-center gap-2 bg-black/20 rounded-xl p-4 max-w-md w-full">
					<p class="text-emerald-100 font-semibold">Peek: click one of your cards to look at it</p>
					<button onclick={skipAction} class="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 rounded transition-colors touch-manipulation">Skip</button>
				</div>
			{:else if gameState.pendingChoice?.playerId === gameState.myPlayerId && gameState.pendingChoice.type === 'spy'}
				<div class="flex flex-col items-center gap-2 bg-black/20 rounded-xl p-4 max-w-md w-full">
					<p class="text-emerald-100 font-semibold">Spy: click an opponent's card to peek at it</p>
					<button onclick={skipAction} class="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 rounded transition-colors touch-manipulation">Skip</button>
				</div>
			{:else if gameState.pendingChoice?.playerId === gameState.myPlayerId && gameState.pendingChoice.type === 'blindSwap'}
				<div class="flex flex-col items-center gap-2 bg-black/20 rounded-xl p-4 max-w-md w-full">
					<p class="text-emerald-100 font-semibold">
						{gameState.pendingChoice.targetPlayerId === null ? 'Blind swap: click an opponent\'s card' : 'Blind swap: now click one of your cards'}
					</p>
					<button onclick={skipAction} class="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 rounded transition-colors touch-manipulation">Skip</button>
				</div>
			{:else if gameState.pendingChoice?.playerId === gameState.myPlayerId && gameState.pendingChoice.type === 'lookyLookySwap' && gameState.pendingChoice.targetCardIndex === null}
				<div class="flex flex-col items-center gap-2 bg-black/20 rounded-xl p-4 max-w-md w-full">
					<p class="text-emerald-100 font-semibold">
						Looky-looky: click an opponent's card to reveal
					</p>
					<button onclick={skipAction} class="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 rounded transition-colors touch-manipulation">Skip</button>
				</div>
			{:else if gameState.pendingChoice?.playerId === gameState.myPlayerId && gameState.pendingChoice.type === 'lookyLookySwap' && gameState.pendingChoice.targetCardIndex !== null && gameState.pendingChoice.ownCardIndex === null}
				<div class="flex flex-col items-center gap-2 bg-black/20 rounded-xl p-4 max-w-md w-full">
					<p class="text-emerald-100 font-semibold">
						Looky-looky: {gameState.pendingChoice.targetCard?.rank} of {gameState.pendingChoice.targetCard?.suit} revealed — now click one of your cards
					</p>
					<button onclick={skipAction} class="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 rounded transition-colors touch-manipulation">Skip</button>
				</div>
			{:else if !gameState.pendingChoice}
				<p class="text-emerald-100 text-sm">Wait for your turn — you can still snap!</p>
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

{#if peekReveal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onclick={() => (peekReveal = null)}>
		<div class="flex flex-col items-center gap-4 bg-green-900 rounded-2xl p-8 shadow-2xl" onclick={(e) => e.stopPropagation()}>
			<p class="font-semibold text-lg">Your card #{peekReveal.cardIndex + 1}</p>
			<CardComponent card={peekReveal.card} />
			<p class="text-sm text-emerald-200">Tap anywhere to close</p>
		</div>
	</div>
{/if}

{#if spyResult}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onclick={() => (spyResult = null)}>
		<div class="flex flex-col items-center gap-4 bg-blue-900 rounded-2xl p-8 shadow-2xl" onclick={(e) => e.stopPropagation()}>
			<p class="font-semibold text-lg">Spied on {playerNameById(spyResult.playerId)}'s card #{spyResult.cardIndex + 1}</p>
			<CardComponent card={spyResult.card} />
			<p class="text-sm text-blue-200">Tap anywhere to close</p>
		</div>
	</div>
{/if}

{#if spyNotify}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onclick={() => (spyNotify = null)}>
		<div class="flex flex-col items-center gap-4 bg-blue-900 rounded-2xl p-8 shadow-2xl" onclick={(e) => e.stopPropagation()}>
			<p class="font-semibold text-lg">👀 {spyNotify.spiedBy} looked at your card #{spyNotify.cardIndex + 1}</p>
			<p class="text-sm text-blue-200">Tap anywhere to dismiss</p>
		</div>
	</div>
{/if}

{#if keeshCalledBy}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onclick={() => (keeshCalledBy = null)}>
		<div class="flex flex-col items-center gap-4 bg-amber-900 border-2 border-amber-400 rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4" onclick={(e) => e.stopPropagation()}>
			<p class="text-4xl">🃏</p>
			<p class="font-bold text-2xl text-amber-200 text-center">{keeshCalledBy} called Keesh!</p>
			<p class="text-sm text-amber-300 text-center">One round left — everyone plays until it gets back to {keeshCalledBy}</p>
			<button
				onclick={() => (keeshCalledBy = null)}
				class="mt-2 px-5 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg font-semibold transition-colors touch-manipulation"
			>
				Got it
			</button>
		</div>
	</div>
{/if}

{#if swapNotify}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onclick={() => (swapNotify = null)}>
		<div class="flex flex-col items-center gap-4 bg-purple-900 rounded-2xl p-8 shadow-2xl" onclick={(e) => e.stopPropagation()}>
			<p class="font-semibold text-lg">🔄 {swapNotify.swappedBy} swapped your card #{swapNotify.cardIndex + 1}</p>
			<p class="text-sm text-purple-200">Tap anywhere to dismiss</p>
		</div>
	</div>
{/if}

{#if drawnCardInfo}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onclick={() => (drawnCardInfo = null)}>
		<div class="flex flex-col items-center gap-4 bg-slate-800 rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4" onclick={(e) => e.stopPropagation()}>
			<p class="font-semibold text-lg">{drawnCardInfo.rank} of {drawnCardInfo.suit}</p>
			<CardComponent card={drawnCardInfo} />
			<p class="text-sm text-slate-200">Worth <strong>{cardPoints(drawnCardInfo)} points</strong> in your hand</p>
			<p class="text-sm text-slate-300 text-center">{cardAbilityText(drawnCardInfo)}</p>
			<p class="text-sm text-slate-400">Tap anywhere to close</p>
		</div>
	</div>
{/if}
