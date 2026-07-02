// @ts-nocheck
import { Server } from 'socket.io';

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const HAND_SIZE = 4;
const KEESH_WINDOW_MS = 10000;

function createDeck() {
	return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
}

function buildDeck(playerCount) {
	const single = createDeck();
	if (playerCount >= 7) {
		return [...single, ...single];
	} else if (playerCount === 6) {
		const extra = single.filter((c) => c.suit === 'spades' || c.suit === 'diamonds');
		return [...single, ...extra];
	}
	return single;
}

function shuffle(array) {
	const a = [...array];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function isRed(card) {
	return card.suit === 'hearts' || card.suit === 'diamonds';
}

function cardPoints(card) {
	if (card.rank === 'K') return isRed(card) ? 12 : 0;
	if (card.rank === 'Q') return 11;
	if (card.rank === 'J') return -1;
	if (card.rank === 'A') return 1;
	return parseInt(card.rank, 10);
}

function drawnCardAction(card) {
	if (card.rank === '7' || card.rank === '8') return 'peek';
	if (card.rank === '9' || card.rank === '10') return 'spy';
	if (card.rank === 'Q') return 'blindSwap';
	if (card.rank === 'K' && isRed(card)) return 'lookyLookySwap';
	return null;
}

const games = new Map();
const socketRoom = new Map();

function getOrCreateGame(roomId) {
	if (!games.has(roomId)) {
		games.set(roomId, {
			id: roomId,
			status: 'waiting',
			players: [],
			deck: [],
			discardPile: [],
			dealerIndex: 0,
			currentPlayerIndex: 0,
			drawnCard: null,
			drawnAction: null,
			pendingChoice: null,
			keeshCallerId: null,
			finalScores: null,
			totalScores: {},
			matchWinnerIds: null,
			keeshWindow: null,
			pendingEndGame: null,
			log: []
		});
	}
	return games.get(roomId);
}

function removeSocketFromGame(socket) {
	const roomId = socketRoom.get(socket.id);
	if (!roomId) return;
	const game = games.get(roomId);
	if (!game) return;
	socketRoom.delete(socket.id);
	socket.leave(roomId);
	if (game.status === 'waiting') {
		game.players = game.players.filter((p) => p.id !== socket.id);
		if (game.players.length === 0) {
			games.delete(roomId);
		} else {
			broadcastState(game);
		}
	} else {
		const player = game.players.find((p) => p.id === socket.id);
		if (player) {
			player.disconnected = true;
			log(game, `${player.name} disconnected (hand preserved)`);
			if (game.currentPlayerIndex >= game.players.length) game.currentPlayerIndex = 0;
			broadcastState(game);
		}
	}
}

function log(game, message) {
	game.log.push(message);
	if (game.log.length > 20) game.log.shift();
}

function currentPlayerId(game) {
	if (game.players.length === 0) return null;
	return game.players[game.currentPlayerIndex].id;
}

function getStateForPlayer(game, playerId) {
	const player = game.players.find((p) => p.id === playerId);
	if (!player) return null;
	const isCurrent = currentPlayerId(game) === playerId;
	return {
		id: game.id,
		status: game.status,
		myPlayerId: playerId,
		myHand: player.hand,
		myKnownCards: player.knownCards,
		drawnCard: game.drawnCard && isCurrent ? game.drawnCard : null,
		drawnAction: game.drawnCard && isCurrent ? game.drawnAction : null,
		pendingChoice: game.pendingChoice?.playerId === playerId ? game.pendingChoice : null,
		players: game.players.map((p) => ({
			id: p.id,
			name: p.name,
			handCount: p.hand.filter((c) => c !== null).length,
			handSlots: p.hand.map((c) => c !== null),
			looked: p.looked,
			isCurrent: currentPlayerId(game) === p.id,
			disconnected: p.disconnected ?? false,
			score: game.finalScores?.[p.id] ?? null
		})),
		currentPlayerId: currentPlayerId(game),
		dealerPlayerId: game.players[game.dealerIndex]?.id ?? null,
		keeshCallerId: game.keeshCallerId,
		discardPileTop: game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : null,
		finalScores: game.finalScores,
		totalScores: game.totalScores,
		matchWinnerIds: game.matchWinnerIds,
		keeshWindow: game.keeshWindow,
		pendingEndGame: game.pendingEndGame ? { endsAt: game.pendingEndGame.endsAt } : null,
		revealedHands: game.status === 'finished'
			? game.players.map((p) => ({ id: p.id, name: p.name, hand: p.hand }))
			: null,
		log: game.log
	};
}

function broadcastState(game) {
	for (const player of game.players) {
		player.socket.emit('state', getStateForPlayer(game, player.id));
	}
}

function broadcastSwapHighlight(game, slots) {
	for (const player of game.players) {
		player.socket.emit('swapHighlight', slots);
	}
}

function addPlayer(game, socket, playerName) {
	if (game.players.find((p) => p.id === socket.id)) return;
	const name = playerName || `Player ${game.players.length + 1}`;
	if (game.status === 'waiting' && game.players.find((p) => p.name === name)) {
		socket.emit('nameTaken', { name });
		return;
	}
	if (game.status !== 'waiting') {
		const existing = game.players.find((p) => p.name === name);
		if (existing) {
			const oldId = existing.id;
			socketRoom.delete(oldId);
			existing.id = socket.id;
			existing.socket = socket;
			existing.disconnected = false;
			if (game.totalScores[socket.id] === undefined && game.totalScores[oldId] !== undefined) {
				game.totalScores[socket.id] = game.totalScores[oldId];
				delete game.totalScores[oldId];
			}
			socket.join(game.id);
			socketRoom.set(socket.id, game.id);
			broadcastState(game);
			return;
		}
	}
	game.players.push({
		id: socket.id,
		name,
		hand: [],
		knownCards: [],
		looked: false,
		socket
	});
	if (game.totalScores[socket.id] === undefined) {
		game.totalScores[socket.id] = 0;
	}
	socket.join(game.id);
	socketRoom.set(socket.id, game.id);
	broadcastState(game);
}

function startGame(game, socket) {
	if (game.status !== 'waiting') {
		socket.emit('error', 'Game already started');
		return;
	}
	if (game.players.length < 2) {
		socket.emit('error', 'Need at least 2 players');
		return;
	}
	game.deck = shuffle(buildDeck(game.players.length));
	for (const p of game.players) {
		p.hand = game.deck.splice(0, HAND_SIZE);
		p.knownCards = new Array(HAND_SIZE).fill(false);
		p.looked = false;
	}
	game.discardPile = [];
	game.dealerIndex = 0;
	game.currentPlayerIndex = 1 % game.players.length;
	game.drawnCard = null;
	game.drawnAction = null;
	game.pendingChoice = null;
	game.keeshCallerId = null;
	game.finalScores = null;
	game.status = 'looking';
	log(game, `${game.players[0].name} deals. ${game.players[game.currentPlayerIndex].name} goes first.`);
	broadcastState(game);
}

function lookAtCard(game, socket, cardIndex) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (game.status !== 'looking') {
		socket.emit('error', 'Not in look phase');
		return;
	}
	if (player.looked) {
		socket.emit('error', 'You already looked at a card');
		return;
	}
	if (cardIndex < 0 || cardIndex >= player.hand.length || player.hand[cardIndex] === null) {
		socket.emit('error', 'Invalid card');
		return;
	}
	player.knownCards[cardIndex] = false;
	player.looked = true;
	log(game, `${player.name} looked at their card ${cardIndex + 1}`);
	socket.emit('peekReveal', { cardIndex, card: player.hand[cardIndex], duration: 3000 });
	broadcastSwapHighlight(game, [{ playerId: player.id, cardIndex }]);
	if (game.players.every((p) => p.looked)) {
		game.status = 'playing';
		log(game, 'All players ready. First turn begins.');
	}
	broadcastState(game);
}

function currentPlayer(game) {
	return game.players[game.currentPlayerIndex];
}

function nextPlayer(game) {
	if (game.pendingEndGame) return;
	if (game.keeshCallerId && game.status === 'playing') {
		const nextIndex = (game.currentPlayerIndex + 1) % game.players.length;
		if (game.players[nextIndex].id === game.keeshCallerId) {
			game.currentPlayerIndex = nextIndex;
			game.drawnCard = null;
			game.drawnAction = null;
			game.pendingChoice = null;
			game.keeshWindow = null;
			startEndGameDelay(game);
			return;
		}
	}
	game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
	game.drawnCard = null;
	game.drawnAction = null;
	game.pendingChoice = null;
}

function startEndGameDelay(game) {
	game.pendingEndGame = {
		endsAt: Date.now() + 10000,
		timer: setTimeout(() => {
			if (game.pendingEndGame) {
				game.pendingEndGame = null;
				endGame(game);
			}
		}, 10000)
	};
	log(game, 'Final snap window: 10 seconds to snap');
	broadcastState(game);
}

function finishTurnWithKeeshWindow(game, playerId) {
	if (game.keeshCallerId) {
		nextPlayer(game);
		broadcastState(game);
		return;
	}
	game.keeshWindow = { playerId: playerId, expiresAt: Date.now() + KEESH_WINDOW_MS };
	broadcastState(game);
	setTimeout(() => {
		if (game.keeshWindow && game.keeshWindow.playerId === playerId) {
			game.keeshWindow = null;
			nextPlayer(game);
			broadcastState(game);
		}
	}, KEESH_WINDOW_MS);
}

function ensureDeck(game) {
	if (game.deck.length > 0) return;
	if (game.discardPile.length > 1) {
		const top = game.discardPile.pop();
		game.deck = shuffle(game.discardPile);
		game.discardPile = [top];
	}
}

function removeCardFromHand(player, cardIndex) {
	player.hand[cardIndex] = null;
	player.knownCards[cardIndex] = false;
}

function addCardToHand(player, card, slotIndex = null) {
	if (slotIndex !== null && player.hand[slotIndex] === null) {
		player.hand[slotIndex] = card;
		player.knownCards[slotIndex] = false;
		return;
	}
	const emptyIndex = player.hand.findIndex((c) => c === null);
	if (emptyIndex !== -1) {
		player.hand[emptyIndex] = card;
		player.knownCards[emptyIndex] = false;
		return;
	}
	player.hand.push(card);
	player.knownCards.push(false);
}

function drawCard(game, socket) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (currentPlayer(game).id !== player.id) {
		socket.emit('error', 'Not your turn');
		return;
	}
	if (game.drawnCard) {
		socket.emit('error', 'You already drew a card');
		return;
	}
	if (game.pendingEndGame) {
		socket.emit('error', 'Game is ending — no more draws');
		return;
	}
	if (game.keeshWindow) {
		socket.emit('error', 'Wait for the keesh window to close');
		return;
	}
	ensureDeck(game);
	if (game.deck.length === 0) {
		socket.emit('error', 'No cards left to draw');
		return;
	}
	const card = game.deck.pop();
	game.drawnCard = card;
	game.drawnAction = drawnCardAction(card);
	log(game, `${player.name} drew a card`);
	broadcastState(game);
}

function discardDrawn(game, socket) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (currentPlayer(game).id !== player.id) {
		socket.emit('error', 'Not your turn');
		return;
	}
	if (!game.drawnCard) {
		socket.emit('error', 'No drawn card to discard');
		return;
	}
	const action = game.drawnAction;
	game.discardPile.push(game.drawnCard);
	game.drawnCard = null;
	game.drawnAction = null;
	if (action === 'peek') {
		game.pendingChoice = { playerId: player.id, type: 'peek', cardIndex: null };
		log(game, `${player.name} discarded a peek card — choosing a card to peek`);
		broadcastState(game);
	} else if (action === 'spy') {
		game.pendingChoice = { playerId: player.id, type: 'spy', targetPlayerId: null, targetCardIndex: null };
		log(game, `${player.name} discarded a spy card — choosing a card to spy`);
		broadcastState(game);
	} else if (action === 'blindSwap') {
		game.pendingChoice = { playerId: player.id, type: 'blindSwap', targetPlayerId: null, targetCardIndex: null, ownCardIndex: null };
		log(game, `${player.name} discarded and is choosing a blind swap`);
		broadcastState(game);
	} else if (action === 'lookyLookySwap') {
		game.pendingChoice = { playerId: player.id, type: 'lookyLookySwap', targetPlayerId: null, targetCardIndex: null, ownCardIndex: null };
		log(game, `${player.name} discarded and is choosing a looky-looky swap`);
		broadcastState(game);
	} else {
		log(game, `${player.name} discarded the drawn card`);
		finishTurnWithKeeshWindow(game, player.id);
	}
}

function skipAction(game, socket) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (!game.pendingChoice || game.pendingChoice.playerId !== player.id) {
		socket.emit('error', 'No action to skip');
		return;
	}
	if (!['peek', 'spy', 'blindSwap', 'lookyLookySwap'].includes(game.pendingChoice.type)) {
		socket.emit('error', 'Cannot skip this action');
		return;
	}
	log(game, `${player.name} skipped the action`);
	game.pendingChoice = null;
	finishTurnWithKeeshWindow(game, player.id);
}

function swapCard(game, socket, cardIndex) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (currentPlayer(game).id !== player.id) {
		socket.emit('error', 'Not your turn');
		return;
	}
	if (!game.drawnCard) {
		socket.emit('error', 'No drawn card to swap');
		return;
	}
	if (cardIndex < 0 || cardIndex >= player.hand.length) {
		socket.emit('error', 'Invalid card');
		return;
	}
	const oldCard = player.hand[cardIndex];
	player.hand[cardIndex] = game.drawnCard;
	player.knownCards[cardIndex] = false;
	game.drawnCard = null;
	game.drawnAction = null;
	if (oldCard) game.discardPile.push(oldCard);
	log(game, `${player.name} swapped their card ${cardIndex + 1} with the drawn card`);
	broadcastSwapHighlight(game, [{ playerId: player.id, cardIndex }]);
	finishTurnWithKeeshWindow(game, player.id);
}

function peekCard(game, socket, cardIndex) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (currentPlayer(game).id !== player.id) {
		socket.emit('error', 'Not your turn');
		return;
	}
	const viaChoice = game.pendingChoice?.playerId === player.id && game.pendingChoice?.type === 'peek';
	if (!viaChoice && (!game.drawnCard || game.drawnAction !== 'peek')) {
		socket.emit('error', 'No peek available');
		return;
	}
	if (cardIndex < 0 || cardIndex >= player.hand.length || player.hand[cardIndex] === null) {
		socket.emit('error', 'Invalid card');
		return;
	}
	if (!viaChoice) {
		game.discardPile.push(game.drawnCard);
		game.drawnCard = null;
		game.drawnAction = null;
	}
	game.pendingChoice = null;
	player.knownCards[cardIndex] = false;
	log(game, `${player.name} peeked at their card ${cardIndex + 1}`);
	player.socket.emit('peekReveal', { cardIndex, card: player.hand[cardIndex], duration: 3000 });
	broadcastSwapHighlight(game, [{ playerId: player.id, cardIndex }]);
	finishTurnWithKeeshWindow(game, player.id);
}

function spyCard(game, socket, targetPlayerId, cardIndex) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (currentPlayer(game).id !== player.id) {
		socket.emit('error', 'Not your turn');
		return;
	}
	const viaChoice = game.pendingChoice?.playerId === player.id && game.pendingChoice?.type === 'spy';
	if (!viaChoice && (!game.drawnCard || game.drawnAction !== 'spy')) {
		socket.emit('error', 'No spy available');
		return;
	}
	const target = game.players.find((p) => p.id === targetPlayerId);
	if (!target || cardIndex < 0 || cardIndex >= target.hand.length || target.hand[cardIndex] === null) {
		socket.emit('error', 'Invalid spy target');
		return;
	}
	if (game.keeshCallerId === target.id) {
		socket.emit('error', "Can't spy on the keesh caller's cards");
		return;
	}
	if (!viaChoice) {
		game.discardPile.push(game.drawnCard);
		game.drawnCard = null;
		game.drawnAction = null;
	}
	game.pendingChoice = null;
	player.socket.emit('spyResult', {
		playerId: targetPlayerId,
		cardIndex,
		card: target.hand[cardIndex],
		duration: 3000
	});
	target.socket.emit('spyNotify', { cardIndex, spiedBy: player.name });
	log(game, `${player.name} spied on ${target.name}'s card ${cardIndex + 1}`);
	broadcastSwapHighlight(game, [{ playerId: target.id, cardIndex }]);
	finishTurnWithKeeshWindow(game, player.id);
}

function blindSwap(game, socket) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (currentPlayer(game).id !== player.id) {
		socket.emit('error', 'Not your turn');
		return;
	}
	if (!game.drawnCard || game.drawnAction !== 'blindSwap') {
		socket.emit('error', 'No blind swap available');
		return;
	}
	game.discardPile.push(game.drawnCard);
	game.drawnCard = null;
	game.drawnAction = null;
	game.pendingChoice = {
		playerId: player.id,
		type: 'blindSwap',
		targetPlayerId: null,
		targetCardIndex: null,
		ownCardIndex: null
	};
	log(game, `${player.name} discarded the queen and is choosing a blind swap`);
	broadcastState(game);
}

function lookyLookySwap(game, socket) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (currentPlayer(game).id !== player.id) {
		socket.emit('error', 'Not your turn');
		return;
	}
	if (!game.drawnCard || game.drawnAction !== 'lookyLookySwap') {
		socket.emit('error', 'No looky-looky swap available');
		return;
	}
	game.discardPile.push(game.drawnCard);
	game.drawnCard = null;
	game.drawnAction = null;
	game.pendingChoice = {
		playerId: player.id,
		type: 'lookyLookySwap',
		targetPlayerId: null,
		targetCardIndex: null,
		ownCardIndex: null
	};
	log(game, `${player.name} discarded the red king and is choosing a looky-looky swap`);
	broadcastState(game);
}

function selectSwapOwnCard(game, socket, cardIndex) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (
		!game.pendingChoice ||
		game.pendingChoice.playerId !== player.id ||
		(game.pendingChoice.type !== 'blindSwap' && game.pendingChoice.type !== 'lookyLookySwap')
	) {
		socket.emit('error', 'No swap in progress');
		return;
	}
	if (game.pendingChoice.targetPlayerId === null || game.pendingChoice.targetCardIndex === null) {
		socket.emit('error', 'Select an opponent card first');
		return;
	}
	if (game.pendingChoice.ownCardIndex !== null) {
		socket.emit('error', 'You already selected your card');
		return;
	}
	if (cardIndex < 0 || cardIndex >= player.hand.length || player.hand[cardIndex] === null) {
		socket.emit('error', 'Invalid card');
		return;
	}
	const choice = game.pendingChoice;
	if (choice.type === 'blindSwap') {
		const target = game.players.find((p) => p.id === choice.targetPlayerId);
		if (!target) return;
		const ownIndex = cardIndex;
		const targetCardIndex = choice.targetCardIndex;
		const targetCard = target.hand[targetCardIndex];
		const playerCard = player.hand[ownIndex];
		player.hand[ownIndex] = targetCard;
		player.knownCards[ownIndex] = false;
		target.hand[targetCardIndex] = playerCard;
		target.knownCards[targetCardIndex] = false;
		game.pendingChoice = null;
		log(game, `${player.name} blind-swapped their card ${ownIndex + 1} with ${target.name}'s card ${targetCardIndex + 1}`);
		broadcastSwapHighlight(game, [{ playerId: player.id, cardIndex: ownIndex }, { playerId: target.id, cardIndex: targetCardIndex }]);
		if (targetCardIndex !== null) {
			target.socket.emit('swapNotify', { cardIndex: targetCardIndex, swappedBy: player.name });
		}
		nextPlayer(game);
		broadcastState(game);
		return;
	}
	choice.ownCardIndex = cardIndex;
	log(game, `${player.name} chose their card ${cardIndex + 1} to swap`);
	broadcastState(game);
}

function selectSwapOpponentCard(game, socket, targetPlayerId, cardIndex) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (
		!game.pendingChoice ||
		game.pendingChoice.playerId !== player.id ||
		(game.pendingChoice.type !== 'blindSwap' && game.pendingChoice.type !== 'lookyLookySwap')
	) {
		socket.emit('error', 'No swap in progress');
		return;
	}
	if (game.pendingChoice.targetPlayerId !== null || game.pendingChoice.targetCardIndex !== null) {
		socket.emit('error', 'You already selected an opponent card');
		return;
	}
	const target = game.players.find((p) => p.id === targetPlayerId);
	if (!target || cardIndex < 0 || cardIndex >= target.hand.length || target.hand[cardIndex] === null) {
		socket.emit('error', 'Invalid swap target');
		return;
	}
	if (game.keeshCallerId === target.id) {
		socket.emit('error', "Can't swap with the keesh caller's cards");
		return;
	}
	const choice = game.pendingChoice;
	choice.targetPlayerId = targetPlayerId;
	choice.targetCardIndex = cardIndex;
	if (choice.type === 'lookyLookySwap') {
		choice.targetCard = target.hand[cardIndex];
		target.socket.emit('spyNotify', { cardIndex, spiedBy: player.name });
		player.socket.emit('spyResult', {
			playerId: target.id,
			cardIndex,
			card: target.hand[cardIndex],
			duration: 3000
		});
		log(game, `${player.name} peeked at ${target.name}'s card ${cardIndex + 1} and is deciding`);
		broadcastSwapHighlight(game, [{ playerId: target.id, cardIndex }]);
	} else {
		log(game, `${player.name} chose ${target.name}'s card ${cardIndex + 1} to swap with`);
	}
	broadcastState(game);
}

function resolveLookyLookySwap(game, socket, swap) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (!game.pendingChoice || game.pendingChoice.playerId !== player.id || game.pendingChoice.type !== 'lookyLookySwap') {
		socket.emit('error', 'No looky-looky swap to resolve');
		return;
	}
	const { ownCardIndex, targetPlayerId, targetCardIndex } = game.pendingChoice;
	if (ownCardIndex === null || targetPlayerId === null || targetCardIndex === null) {
		socket.emit('error', 'Swap not ready');
		return;
	}
	const target = game.players.find((p) => p.id === targetPlayerId);
	if (!target) return;
	if (swap) {
		const playerCard = player.hand[ownCardIndex];
		const targetCard = target.hand[targetCardIndex];
		player.hand[ownCardIndex] = targetCard;
		player.knownCards[ownCardIndex] = false;
		target.hand[targetCardIndex] = playerCard;
		target.knownCards[targetCardIndex] = false;
		log(game, `${player.name} swapped their card ${ownCardIndex + 1} with ${target.name}'s card ${targetCardIndex + 1} (looky-looky)`);
		game.pendingChoice = null;
		broadcastSwapHighlight(game, [{ playerId: player.id, cardIndex: ownCardIndex }, { playerId: target.id, cardIndex: targetCardIndex }]);
		target.socket.emit('swapNotify', { cardIndex: targetCardIndex, swappedBy: player.name });
	} else {
		log(game, `${player.name} declined the looky-looky swap of ${target.name}'s card ${targetCardIndex + 1}`);
		game.pendingChoice = null;
	}
	nextPlayer(game);
	broadcastState(game);
}

function checkAutomaticKeesh(game, player) {
	if (player.hand.every((c) => c === null) && !game.keeshCallerId) {
		log(game, `${player.name} has no cards left — automatic keesh!`);
		callKeeshAutomatic(game, player);
	}
}

function snapCard(game, socket, targetPlayerId, cardIndex) {
	const snapper = game.players.find((p) => p.id === socket.id);
	if (!snapper) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (game.pendingChoice) {
		socket.emit('error', 'Cannot snap while another action is pending');
		return;
	}
	if (game.discardPile.length === 0) {
		socket.emit('error', 'Nothing to snap yet');
		return;
	}
	if (game.keeshCallerId && snapper.id === game.keeshCallerId) {
		socket.emit('error', 'Your hand is frozen — you called Keesh');
		return;
	}
	const targetRank = game.discardPile[game.discardPile.length - 1].rank;
	const target = game.players.find((p) => p.id === targetPlayerId);
	if (!target || cardIndex < 0 || cardIndex >= target.hand.length) {
		socket.emit('error', 'Invalid snap target');
		return;
	}
	if (game.keeshCallerId && target.id === game.keeshCallerId) {
		socket.emit('error', "Can't snap from the Keesh caller's frozen hand");
		return;
	}
	const card = target.hand[cardIndex];
	if (!card) {
		socket.emit('error', 'Empty slot');
		return;
	}
	if (card.rank !== targetRank) {
		ensureDeck(game);
		if (game.deck.length === 0) {
			socket.emit('error', 'No cards to draw as penalty');
			return;
		}
		const penalty = game.deck.pop();
		addCardToHand(snapper, penalty);
		log(game, `${snapper.name} snapped wrong and drew a penalty`);
		broadcastState(game);
		return;
	}
	const endGameAfterResolution = !!game.pendingEndGame;
	if (game.pendingEndGame) {
		clearTimeout(game.pendingEndGame.timer);
		game.pendingEndGame = null;
	}
	removeCardFromHand(target, cardIndex);
	game.discardPile.push(card);
	log(game, `${snapper.name} snapped ${card.rank} of ${card.suit} from ${target.name}'s card ${cardIndex + 1}`);
	checkAutomaticKeesh(game, target);
	if (target.id !== snapper.id && game.status === 'playing') {
		const previousPlayerIndex = game.currentPlayerIndex;
		const savedKeeshWindow = game.keeshWindow;
		const savedDrawnCard = game.drawnCard;
		const savedDrawnAction = game.drawnAction;
		game.currentPlayerIndex = game.players.findIndex((p) => p.id === snapper.id);
		game.drawnCard = null;
		game.drawnAction = null;
		game.keeshWindow = null;
		game.pendingChoice = {
			playerId: snapper.id,
			type: 'snapGive',
			targetPlayerId: target.id,
			targetSlotIndex: cardIndex,
			previousPlayerIndex,
			savedKeeshWindow,
			savedDrawnCard,
			savedDrawnAction,
			endGameAfterResolution
		};
		broadcastState(game);
		return;
	}
	if (endGameAfterResolution) {
		endGame(game);
		broadcastState(game);
		return;
	}
	broadcastState(game);
}

function selectSnapGiveCard(game, socket, cardIndex) {
	const snapper = game.players.find((p) => p.id === socket.id);
	if (!snapper) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (currentPlayer(game).id !== snapper.id) {
		socket.emit('error', 'Not your turn');
		return;
	}
	const choice = game.pendingChoice;
	if (!choice || choice.type !== 'snapGive' || choice.playerId !== snapper.id) {
		socket.emit('error', 'No snap give in progress');
		return;
	}
	if (cardIndex < 0 || cardIndex >= snapper.hand.length || snapper.hand[cardIndex] === null) {
		socket.emit('error', 'Invalid card');
		return;
	}
	const target = game.players.find((p) => p.id === choice.targetPlayerId);
	if (!target) {
		socket.emit('error', 'Target player not found');
		return;
	}
	const card = snapper.hand[cardIndex];
	removeCardFromHand(snapper, cardIndex);
	target.hand[choice.targetSlotIndex] = card;
	target.knownCards[choice.targetSlotIndex] = false;
	game.pendingChoice = null;
	log(game, `${snapper.name} gave a card to ${target.name}'s slot ${choice.targetSlotIndex + 1}`);
	checkAutomaticKeesh(game, snapper);
	game.currentPlayerIndex = choice.previousPlayerIndex;
	if (choice.savedDrawnCard) {
		game.drawnCard = choice.savedDrawnCard;
		game.drawnAction = choice.savedDrawnAction || null;
	}
	if (choice.endGameAfterResolution) {
		endGame(game);
		broadcastState(game);
		return;
	}
	if (choice.savedKeeshWindow && choice.savedKeeshWindow.expiresAt > Date.now()) {
		game.keeshWindow = choice.savedKeeshWindow;
		const remaining = choice.savedKeeshWindow.expiresAt - Date.now();
		setTimeout(() => {
			if (game.keeshWindow && game.keeshWindow.playerId === choice.savedKeeshWindow.playerId) {
				game.keeshWindow = null;
				nextPlayer(game);
				broadcastState(game);
			}
		}, remaining);
	} else if (choice.savedKeeshWindow) {
		nextPlayer(game);
	}
	broadcastState(game);
}

function _callKeesh(game, player) {
	if (game.keeshCallerId) return;
	game.keeshWindow = null;
	game.keeshCallerId = player.id;
	log(game, `${player.name} called keesh!`);
	for (const p of game.players) {
		p.socket.emit('keeshCalled', { callerName: player.name });
	}
	nextPlayer(game);
	broadcastState(game);
}

function passKeesh(game, socket) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (!game.keeshWindow || game.keeshWindow.playerId !== player.id) {
		socket.emit('error', 'No keesh window to pass');
		return;
	}
	if (game.keeshCallerId) {
		socket.emit('error', 'Keesh already called');
		return;
	}
	game.keeshWindow = null;
	log(game, `${player.name} passed on keesh`);
	nextPlayer(game);
	broadcastState(game);
}

function callKeesh(game, socket) {
	const player = game.players.find((p) => p.id === socket.id);
	if (!player) return;
	if (game.status !== 'playing') {
		socket.emit('error', 'Game not in progress');
		return;
	}
	if (game.keeshCallerId) {
		socket.emit('error', 'Keesh already called');
		return;
	}
	if (game.keeshWindow && game.keeshWindow.playerId === player.id) {
		game.keeshWindow = null;
		_callKeesh(game, player);
		return;
	}
	if (currentPlayer(game).id !== player.id) {
		socket.emit('error', 'Only the current player can call keesh');
		return;
	}
	_callKeesh(game, player);
}

function callKeeshAutomatic(game, player) {
	if (game.status !== 'playing' || game.keeshCallerId) return;
	_callKeesh(game, player);
}

function endGame(game) {
	game.status = 'finished';
	game.keeshWindow = null;
	if (game.pendingEndGame) {
		clearTimeout(game.pendingEndGame.timer);
		game.pendingEndGame = null;
	}
	const scores = {};
	for (const p of game.players) {
		scores[p.id] = p.hand.reduce((sum, card) => sum + (card ? cardPoints(card) : 0), 0);
	}
	if (game.keeshCallerId) {
		const caller = game.players.find((p) => p.id === game.keeshCallerId);
		const lowestScore = Math.min(...Object.values(scores));
		const lowestPlayers = game.players.filter((p) => scores[p.id] === lowestScore);
		const callerWins = caller && lowestPlayers.length === 1 && lowestPlayers[0].id === caller.id;
		if (callerWins) {
			scores[caller.id] -= 5;
			log(game, `${caller.name} wins keesh and gets the Bettina bonus!`);
		} else {
			scores[caller.id] += 5;
			log(game, `${caller.name} loses keesh and gets the Pants penalty.`);
		}
	}
	game.finalScores = scores;
	for (const p of game.players) {
		game.totalScores[p.id] = (game.totalScores[p.id] || 0) + scores[p.id];
	}
	const maxTotal = Math.max(...game.players.map((p) => game.totalScores[p.id]));
	if (maxTotal >= 100) {
		const minTotal = Math.min(...game.players.map((p) => game.totalScores[p.id]));
		game.matchWinnerIds = game.players.filter((p) => game.totalScores[p.id] === minTotal).map((p) => p.id);
		log(
			game,
			`Match over — ${game.matchWinnerIds
				.map((id) => game.players.find((p) => p.id === id)?.name)
				.join(' and ')} wins!`
		);
	}
	broadcastState(game);
}

function startNextRound(game, resetTotals = false) {
	if (resetTotals) {
		game.totalScores = {};
		for (const p of game.players) {
			game.totalScores[p.id] = 0;
		}
		game.matchWinnerIds = null;
	}
	game.deck = shuffle(buildDeck(game.players.length));
	for (const p of game.players) {
		p.hand = game.deck.splice(0, HAND_SIZE);
		p.knownCards = new Array(HAND_SIZE).fill(false);
		p.looked = false;
	}
	game.discardPile = [];
	game.dealerIndex = (game.dealerIndex + 1) % game.players.length;
	game.currentPlayerIndex = (game.dealerIndex + 1) % game.players.length;
	game.drawnCard = null;
	game.drawnAction = null;
	game.pendingChoice = null;
	game.keeshCallerId = null;
	game.finalScores = null;
	game.keeshWindow = null;
	if (game.pendingEndGame) {
		clearTimeout(game.pendingEndGame.timer);
		game.pendingEndGame = null;
	}
	game.status = 'looking';
	log(game, `${game.players[game.dealerIndex].name} deals. ${game.players[game.currentPlayerIndex].name} goes first.`);
	broadcastState(game);
}

export default function injectSocketIO(server) {
	const io = new Server(server);
	io.on('connection', (socket) => {
		socket.on('join', ({ roomId, playerName }) => {
			const game = getOrCreateGame(roomId);
			addPlayer(game, socket, playerName);
		});
		socket.on('start', () => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) startGame(game, socket);
		});
		socket.on('look', ({ cardIndex }) => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) lookAtCard(game, socket, cardIndex);
		});
		socket.on('draw', () => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) drawCard(game, socket);
		});
		socket.on('discardDrawn', () => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) discardDrawn(game, socket);
		});
		socket.on('swap', ({ cardIndex }) => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) swapCard(game, socket, cardIndex);
		});
		socket.on('peek', ({ cardIndex }) => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) peekCard(game, socket, cardIndex);
		});
		socket.on('spy', ({ targetPlayerId, cardIndex }) => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) spyCard(game, socket, targetPlayerId, cardIndex);
		});
		socket.on('blindSwap', () => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) blindSwap(game, socket);
		});
		socket.on('lookyLookySwap', () => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) lookyLookySwap(game, socket);
		});
		socket.on('selectSwapOwnCard', ({ cardIndex }) => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) selectSwapOwnCard(game, socket, cardIndex);
		});
		socket.on('selectSwapOpponentCard', ({ targetPlayerId, cardIndex }) => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) selectSwapOpponentCard(game, socket, targetPlayerId, cardIndex);
		});
		socket.on('resolveLookyLookySwap', ({ swap }) => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) resolveLookyLookySwap(game, socket, swap);
		});
		socket.on('selectSnapGiveCard', ({ cardIndex }) => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) selectSnapGiveCard(game, socket, cardIndex);
		});
		socket.on('snap', ({ targetPlayerId, cardIndex }) => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) snapCard(game, socket, targetPlayerId, cardIndex);
		});
		socket.on('skipAction', () => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) skipAction(game, socket);
		});
		socket.on('keesh', () => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) callKeesh(game, socket);
		});
		socket.on('passKeesh', () => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game) passKeesh(game, socket);
		});
		socket.on('nextRound', () => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game && game.status === 'finished' && !game.matchWinnerIds) startNextRound(game, false);
		});
		socket.on('newMatch', () => {
			const roomId = socketRoom.get(socket.id);
			if (!roomId) return;
			const game = games.get(roomId);
			if (game && game.status === 'finished' && game.matchWinnerIds) startNextRound(game, true);
		});
		socket.on('leave', () => {
			removeSocketFromGame(socket);
		});
		socket.on('disconnect', () => {
			removeSocketFromGame(socket);
		});
	});
}
