<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let playerName = $state('');
	let roomCode = $state('');
	let playerId = $state('');

	const NAME_KEY = 'keesh-player-name';
	const ID_KEY = 'keesh-player-id';

	function generateId() {
		return Math.random().toString(36).slice(2) + Date.now().toString(36);
	}

	function savePlayer() {
		localStorage.setItem(NAME_KEY, playerName || 'Player 1');
		localStorage.setItem(ID_KEY, playerId);
	}

	onMount(() => {
		playerName = localStorage.getItem(NAME_KEY) || '';
		playerId = localStorage.getItem(ID_KEY) || generateId();
	});

	function createGame() {
		const code = Math.random().toString(36).slice(2, 8).toUpperCase();
		savePlayer();
		goto(`/game/${code}?name=${encodeURIComponent(playerName || 'Player 1')}&pid=${playerId}`);
	}

	function joinGame() {
		if (!roomCode.trim()) return;
		savePlayer();
		goto(`/game/${roomCode.trim().toUpperCase()}?name=${encodeURIComponent(playerName || 'Player 1')}&pid=${playerId}`);
	}
</script>

<div class="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-emerald-900 to-slate-900 text-white p-6">
	<h1 class="text-4xl md:text-5xl font-extrabold mb-2 text-center">Keesh Card Game</h1>
	<p class="text-emerald-100 mb-8 text-center max-w-md">
		Play your group's card game together in any browser.
	</p>

	<div class="bg-white/10 backdrop-blur rounded-2xl p-8 max-w-sm w-full shadow-2xl border border-white/10">
		<label for="name" class="block mb-2 text-sm font-medium">Your name</label>
		<input
			id="name"
			bind:value={playerName}
			class="w-full mb-6 px-3 py-2 rounded-lg bg-black/20 border border-white/20 placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-400"
			placeholder="Player 1"
		/>

		<button
			onclick={createGame}
			class="w-full mb-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold transition-colors"
		>
			Create a game
		</button>

		<div class="h-px bg-white/20 my-4"></div>

		<label for="room" class="block mb-2 text-sm font-medium">Room code</label>
		<input
			id="room"
			bind:value={roomCode}
			class="w-full mb-3 px-3 py-2 rounded-lg bg-black/20 border border-white/20 placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-400 uppercase"
			placeholder="ABCDEF"
		/>
		<button
			onclick={joinGame}
			class="w-full py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-colors"
		>
			Join game
		</button>
	</div>
</div>
