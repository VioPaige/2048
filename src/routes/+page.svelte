<script lang="ts">
    import { getContext, onMount } from "svelte";
    import { flip } from "svelte/animate";
    import { scale } from "svelte/transition";
    import { Tween } from "svelte/motion";
    import { createToaster, Dialog, Popover, Portal, Tabs } from "@skeletonlabs/skeleton-svelte";
    import { browser } from "$app/env";

    import type { Tile } from "./types";
    import { MenuIcon, XIcon, TrophyIcon } from "lucide-svelte";
    import { backOut, cubicOut } from "svelte/easing";
    import { getTileColour } from "$lib";
    import { config, loadTheme, setTheme, type Theme } from "$lib/config";

    // configuration variables
    let size = $state(4);
    const animDuration = 100; // in ms
    const minSwipe = 25; // in px
    const toaster: ReturnType<typeof createToaster> = getContext(`toaster`);
    const elements: {name?: HTMLInputElement, sizeInput?: HTMLInputElement} = $state({});

    // grid related variables
    let viewportTick = $state(0);
    let tileGap = $state(4); // px, ~m-1
    let tileSize = $derived.by(() => {
        if (!browser) return 64; // default

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const tick = viewportTick; // this is here to trigger re-derivation upon window resize
        const maxBoardDimension = Math.min(window.innerWidth - 32, window.innerHeight * 0.6);
        const totalGaps = (size + 1) * tileGap;
        const computed = (maxBoardDimension - totalGaps) / size;

        return Math.max(24, Math.floor(computed)); // floor so tiles line up on pixel grid, min size as a safety floor
    });

    // game variables
    let gameOver = $state(false);
    let canSaveScore = $state(true);
    let acceptingPresses = true;
    let leaderboardTab = $state(`4`);

    // logic variables
    let nextId = 1;
    let tiles: {[key: number]: Tile} = $state({});
    // svelte-ignore state_referenced_locally
    let tileLookup: (number | null)[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => null));

    // scoring variables
    let scores: { name: string; score: number }[] = $state([]);
    let currentScore = $state(0);
    let scorePlacement = $derived.by(() => {
        for (let i = 0; i < scores.length; i++) if (currentScore > scores[i].score) return i + 1;

        return scores.length + 1;
    });
    let animatedCurrentScore = Tween.of(() => currentScore, { duration: animDuration, easing: cubicOut });

    /**
     * Retrieves a list of all empty fields in the 2048 grid
     */
    const getEmptyCells = () => {
        const emptyCells: { row: number; col: number }[] = [];

        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (tileLookup[row][col] === null) emptyCells.push({ row, col });
            }
        }

        return emptyCells;
    };

    /**
     * Verifies whether the game is over due to no moves being left
     */
    const checkGameOver = () => {
        const emptyCells = getEmptyCells();
        if (emptyCells.length > 0) return false; // empty cells means no game over

        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const tileId = tileLookup[row][col] as number; // no empty cells so can't be null anyway

                const tile = tiles[tileId];

                if (col < size - 1) if (tiles[tileLookup[row][col + 1] as number].value === tile.value) return false;
                if (row < size - 1) if (tiles[tileLookup[row + 1][col] as number].value === tile.value) return false;
            }
        }

        return true;
    };

    /**
     * Spawns a 2 (or a 4 with 10% chance) in a random free spot in the grid
     */
    const spawnRandomTile = () => {
        const emptyCells = getEmptyCells();
        if (emptyCells.length === 0) return; // board full, nothing to spawn

        const { row, col } = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        const value = Math.random() < 0.9 ? 2 : 4;

        const id = nextId++;
        tiles[id] = { id, value, row, col };
        tileLookup[row][col] = id;
    };

    /**
     * Handles the logic behind making a move in the game
     * @param direction - the direction that the user input (up/down/left/right)
     */
    const move = (direction: `up` | `down` | `left` | `right`) => {
        let moved = false;
        const toRemove: number[] = [];

        const isVertical = direction === `up` || direction === `down`;
        const reverse = direction === `down` || direction === `right`;

        // Loops through lines depending on which direction was found, merges first two colliding blocks of the same value if possible
        // otherwise shoves everything in the movement direction as far as possible
        for (let line = 0; line < size; line++) {
            let write = reverse ? size - 1 : 0;
            const step = reverse ? -1 : 1;
            let mergeTargetId: number | null = null;

            for (let i = reverse ? size - 1 : 0; reverse ? i >= 0 : i < size; i += step) {
                const row = isVertical ? i : line;
                const col = isVertical ? line : i;

                const tileId = tileLookup[row][col];
                if (tileId === null) continue;

                const tile = tiles[tileId];

                if (mergeTargetId !== null && tiles[mergeTargetId].value === tile.value) {
                    tile.row = tiles[mergeTargetId].row;
                    tile.col = tiles[mergeTargetId].col;

                    tiles[mergeTargetId].value *= 2;
                    tileLookup[row][col] = null;
                    currentScore += tiles[mergeTargetId].value;

                    toRemove.push(tileId);
                    mergeTargetId = null;
                    moved = true;
                } else {
                    const writeRow = isVertical ? write : line;
                    const writeCol = isVertical ? line : write;

                    if (tile.row !== writeRow || tile.col !== writeCol) moved = true;

                    tileLookup[row][col] = null;
                    tileLookup[writeRow][writeCol] = tileId;
                    tile.row = writeRow;
                    tile.col = writeCol;

                    mergeTargetId = tileId;
                    write += step;
                }
            }
        }

        return { moved, toRemove };
    };

    /**
     * Wraps the movement logic function, checking if the game is over, saving the current game, and input blocking
     * @param direction - The name of the key that was pressed (or swipe that was done if on phone, but that should be named after the keys for consistency)
     */
    const handleMove = (direction: string) => {
        if (!acceptingPresses) return;
        acceptingPresses = false;

        let result = move(direction.replace(`Arrow`, ``).toLowerCase() as `up` | `down` | `left` | `right`);

        if (result.moved) {
            setTimeout(() => {
                for (const id of result.toRemove) delete tiles[id];

                spawnRandomTile();
                gameOver = checkGameOver();
                acceptingPresses = true;
                localStorage.setItem(`opengame`, JSON.stringify({
                    tiles,
                    tileLookup,
                    currentScore,
                    nextId,
                }));
            }, animDuration);
        } else acceptingPresses = true;
    }; 

    /**
     * Key listener, calls the handleMove function if an arrow key was pressed
     * @param event - KeyboardEvent passed by the event listener
     */
    const triggerMove = (event: KeyboardEvent) => {
        if (event.key.startsWith(`Arrow`)) handleMove(event.key);
    };
    
    /**
     * Clears saved game cache, resets current score and game state, and spawns two starter blocks
     */
    const restartGame = () => {
        gameOver = false;
        currentScore = 0;
        canSaveScore = true;

        scores = loadScores(size) ?? scores;
        
        tiles = {};
        tileLookup = Array.from({ length: size }, () => Array.from({ length: size }, () => null));
        localStorage.removeItem(`opengame`);
        nextId = 1;


        spawnRandomTile();
        spawnRandomTile();
    };

    /**
     * Finds and returns saved scores for the specified grid size
     * @param size - the size of the grid (size x size)
     */
    const loadScores = (size: number) => {
        const loadedScores = JSON.parse(localStorage.getItem(`scores_size:${size}`) || `[]`);

        if (!Array.isArray(loadedScores)) return;
        for (const score of loadedScores) if (typeof score.name !== `string` || typeof score.score !== `number`) return;

        return loadedScores;
    };
    /**
     * Saves a score in the local leaderboard of the currently active size 
     * @param name - the player name for this score
     * @param score - the score
     */
    const addScore = (name: string, score: number) => {
        if (!name || typeof name !== `string` || name.length > 20) return toaster.error({ title: `Invalid player name`, description: `Player name must be non-empty with a maximum length of 20 characters.` });
        if (typeof score !== `number`) return toaster.error({ title: `Invalid score`, description: `Score must be a number.` });

        canSaveScore = false;
        scores.push({ name, score });
        scores.sort((a, b) => b.score - a.score);
        if (scores.length > 10) scores.pop();

        localStorage.setItem(`scores_size:${size}`, JSON.stringify(scores));
    };
    /**
     * Resets/Deletes the score leaderboard for the currently active size
     */
    const resetScores = () => {
        localStorage.removeItem(`scores_size:${size}`);
        scores = [];
    };

    let touch: { x: number, y: number } | undefined = undefined;
    // Following two functions handle translating phone swipes into arrow key presses
    const touchStart = (ev: TouchEvent) => touch = { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    const touchEnd = (ev: TouchEvent) => {
        if (!touch) return;
        console.log(ev);
        let dx = ev.changedTouches[0].clientX - touch.x,
            dy = ev.changedTouches[0].clientY - touch.y;
        touch = undefined;

        if (Math.abs(dx) < minSwipe && Math.abs(dy) < minSwipe) return;
        if (Math.abs(dx) > Math.abs(dy)) handleMove(dx > 0 ? `ArrowRight` : `ArrowLeft`);
        else handleMove(dy > 0 ? `ArrowDown` : `ArrowUp`);
    };

    // Load saved theme
    onMount(loadTheme);
    onMount(() => {
        const onResize = () => viewportTick++;

        // Set up global event listeners
        window.addEventListener(`keydown`, triggerMove);
        window.addEventListener(`touchstart`, touchStart);
        window.addEventListener(`touchend`, touchEnd);
        window.addEventListener(`resize`, onResize);

        // Load scores as well as size/in-progress game from local storage
        scores = loadScores(size) ?? scores;
        
        size = parseInt(localStorage.getItem(`lastFieldSize`) ?? `4`);
        let data = localStorage.getItem(`opengame`);
        if (data) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let parsed = JSON.parse(data) as any;
            tiles = parsed.tiles;
            tileLookup = parsed.tileLookup;
            currentScore = parsed.currentScore;
            nextId = parsed.nextId;

            gameOver = checkGameOver();
        } else restartGame();

        
        // Clears old listeners if mount is repeated
        return () => {
            window.removeEventListener(`keydown`, triggerMove);
            window.removeEventListener(`touchstart`, touchStart);
            window.removeEventListener(`touchend`, touchEnd);
            window.removeEventListener(`resize`, onResize);
        };
    });
</script>

<div class="h-full w-full flex flex-row justify-center items-center p-4">
    <div class="flex-col flex gap-4">
        <div class="flex flex-row justify-evenly">
            <div class="flex flex-col">
                <p class="text-md text-center">Best</p>
                <p class="text-center font-bold text-md">{scores[0]?.score || Math.round(animatedCurrentScore.current)}</p>
            </div>
            <div class="flex flex-col">
                <p class="text-md text-center">Current</p>
                <p class="text-center font-bold text-md">{Math.round(animatedCurrentScore.current)}</p>
            </div>
        </div>
    
        <div class="w-fit h-fit bg-primary-50-950/10 rounded-xl flex flex-col p-2 gap-1" style="touch-action: none">
            <div class="relative" style="width: {size * tileSize + (size + 1) * tileGap}px; height: {size * tileSize + (size + 1) * tileGap}px;">
                {#each {length: size}}
                    <div class="flex flex-row justify-center w-fit">
                        {#each {length: size}}
                            <div class="rounded-lg font-bold bg-primary-50-950/20" style="width: {tileSize}px; height: {tileSize}px; margin: {tileGap/2}px;"></div>
                        {/each}
                    </div>
                {/each}
    
                {#each Object.values(tiles).sort((a, b) => (a.row * size + a.col) - (b.row * size + b.col)) as tile (tile.id)}
                    {@const style = getTileColour(tile.value)}

                    <div
                        class="rounded-lg absolute font-bold"
                        style="
                            width: {tileSize}px;
                            height: {tileSize}px;
                            top: {tile.row * (tileSize + tileGap) + tileGap}px;
                            left: {tile.col * (tileSize + tileGap) + tileGap}px;
                            background-color: var(--color-{style.colour}-{style.shade});
                            color: var(--color-{style.colour}-contrast-{style.shade});
                            font-size: {tileSize * 0.4}px;
                        "
                        animate:flip={{ duration: animDuration }}
                        in:scale={{ duration: animDuration, start: 0.3, easing: backOut }}
                    >
                        <div class="flex flex-col text-center justify-center h-full">{tile.value}</div>
                    </div>
                {/each}
            </div>
        </div>
    </div>
</div>

<!-- Top left menu -->
<Popover>
    <Popover.Trigger class="fixed w-10 h-10 rounded-lg top-4 left-4 bg-surface-500/50 drop-shadow-xl drop-shadow-secondary-500 flex flex-row justify-center items-center cursor-pointer hover:bg-secondary-500/50 transition-colors duration-400 ease-in-out">
        <MenuIcon class="text-gray-300 opacity-80" />
    </Popover.Trigger>
	<Portal>
		<Popover.Positioner>
			<Popover.Content class="card max-w-md p-4 bg-surface-100-900 shadow-xl">
				<Popover.Description class="flex flex-col gap-4">
                    <fieldset class="fieldset p-2">
                        <legend class="legend">Theme</legend>
                        <label class="label">
                            <div class="grid grid-cols-2 gap-2 w-full">
                                {#each config.themes as theme (theme)}
                                    <button 
                                        data-theme={theme.name}
                                        class="bg-surface-50-950 capitalize p-4 py-2 rounded-lg items-center gap-4 preset-outlined-surface-100-900 hover:preset-outlined-surface-200-800"
                                        onclick={() => setTheme(theme.name as Theme)}
                                    >
                                        <span>{theme.icon}</span>
                                        <span class="text-lg">{theme.name}</span>
                                        <div class="flex justify-center items-center -space-x-1">
                                            <div class="aspect-square w-4 bg-primary-500 border border-black/5 rounded-full"></div>
                                            <div class="aspect-square w-4 bg-secondary-500 border border-black/5 rounded-full"></div>
                                            <div class="aspect-square w-4 bg-tertiary-500 border border-black/5 rounded-full"></div>
                                        </div>
                                    </button>
                                {/each}
                            </div>
                        </label>
                    </fieldset>
                    <fieldset class="fieldset p-2">
                        <legend class="legend">Game</legend>
                        <div class="flex flex-row gap-2">
                            <label class="label">
                                <span class="label-text text-center">Grid size</span>
                                <div class="field-group grid-cols-[auto_1fr_auto]">
                                    <input bind:this={elements.sizeInput} value={size} max=10 min=3 class="input rounded-lg h-8" type="number" placeholder="Input" />
                                    <button onclick={() => {
                                        if (elements.sizeInput?.valueAsNumber == undefined || isNaN(elements.sizeInput.valueAsNumber) || elements.sizeInput.valueAsNumber > 10 || elements.sizeInput.valueAsNumber < 3) return toaster.error({
                                            title: `Invalid size`,
                                            description: `Grid size has to be a number between 3 and 10.`
                                        });

                                        size = elements.sizeInput?.valueAsNumber as number;
                                        localStorage.setItem(`lastFieldSize`, `${size}`);
                                        restartGame();
                                    }} class="btn preset-filled cursor-pointer rounded-lg">Start</button>
                                </div>
                            </label>
                            <label class="label">
                                <span class="label-text text-center">Reset Leaderboard</span>
                                <button onclick={resetScores} class="btn w-full rounded-lg preset-filled h-8 border-none cursor-pointer" placeholder="Input">Reset</button>
                            </label>
                        </div>
                    </fieldset>
                </Popover.Description>
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>

<!-- Game Over Message -->
<Dialog open={gameOver} onEscapeKeyDown={restartGame} onPointerDownOutside={restartGame}>
    <Portal>
        <Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50" />
        <Dialog.Positioner class="fixed inset-0 z-50 flex justify-center items-center p-4">
            <Dialog.Content class="card bg-surface-100-900 w-fit max-w-xl p-4 space-y-4 shadow-xl">
                <header class="flex justify-between items-center">
                    <Dialog.Title class="text-lg font-bold">Game Over</Dialog.Title>
                    <Dialog.CloseTrigger class="btn-icon hover:preset-tonal">
                        <XIcon onclick={restartGame} class="size-4" />
                    </Dialog.CloseTrigger>
                </header>
                <Dialog.Description class="flex flex-col gap-4">
                    <p>You scored {currentScore} points and placed {scorePlacement}{scorePlacement === 1 ? 'st' : scorePlacement === 2 ? 'nd' : scorePlacement === 3 ? 'rd' : 'th'}</p>

                    <table class="table table-auto rounded-lg bg-surface-50-950">
                        <thead>
                            <tr>
                                <th class="text-left">Player</th>
                                <th class="text-right">Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each scores as score (score)}
                                <tr>
                                    <td>{score.name}</td>
                                    <td class="text-right">{score.score}</td>
                                </tr>
                            {/each}

                            {#if scores.length === 0}
                                <tr>
                                    <td colspan="2" class="text-center">No scores yet</td>
                                </tr>
                            {/if}
                        </tbody>
                    </table>

                    {#if canSaveScore && scorePlacement <= 10}
                        <div class="field-group grid-cols-[auto_1fr_auto]">
                            <input bind:this={elements.name} class="input" type="text" name="username" id="username" placeholder="Enter name" maxlength="20" />
                            <button onclick={() => addScore(elements.name?.value as string, currentScore)} class="btn preset-filled" title="Username already in use.">
                                Add score
                            </button>
                        </div>
                    {/if}
                </Dialog.Description>
                <footer class="flex justify-end gap-2">
                    <button onclick={restartGame} type="button" class="btn preset-filled pointer w-full h-full">Restart</button>
                </footer>
            </Dialog.Content>
        </Dialog.Positioner>
    </Portal>
</Dialog>

<!-- Leaderboards -->
<Dialog>
    <Dialog.Trigger class="fixed w-10 h-10 rounded-lg top-4 right-4 bg-surface-500/50 drop-shadow-xl drop-shadow-secondary-500 flex flex-row justify-center items-center cursor-pointer hover:bg-secondary-500/50 transition-colors duration-400 ease-in-out">
        <TrophyIcon class="text-gray-300 opacity-80" />
    </Dialog.Trigger>
    <Portal>
        <Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50" />
        <Dialog.Positioner class="fixed inset-0 z-50 flex justify-center items-center p-4">
            <Dialog.Content class="card bg-surface-100-900 w-fit max-w-xl p-4 space-y-4 shadow-xl">
                <header class="flex justify-between items-center gap-12">
                    <Dialog.Title class="text-lg font-bold">Leaderboards per size</Dialog.Title>
                    <Dialog.CloseTrigger class="btn-icon hover:preset-tonal">
                        <XIcon class="size-4" />
                    </Dialog.CloseTrigger>
                </header>
                <Dialog.Description class="flex flex-col gap-4">
                    <Tabs value={leaderboardTab}>
                        <Tabs.List class="py-0">
                            {#each Array.from({ length: 8 }, (_, i) => `${i + 3}`) as i (i)}
                                <Tabs.Trigger 
                                    value={i}
                                    class="{leaderboardTab == i ? `bg-surface-100-900/50` : `text-surface-600-400`} rounded-b-none"
                                    onclick={() => leaderboardTab = i}
                                >{i}</Tabs.Trigger>
                            {/each}
                        </Tabs.List>

                        {#if browser}
                            {#each Array.from({ length: 8 }, (_, i) => `${i + 3}`) as i (i)}
                                {@const currentScores = loadScores(parseInt(i)) ?? []}

                                <Tabs.Content value={i}>
                                    <table class="table table-auto rounded-lg bg-surface-50-950">
                                        <thead>
                                            <tr>
                                                <th class="text-left">Player</th>
                                                <th class="text-right">Score</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each currentScores as score (score)}
                                                <tr>
                                                    <td>{score.name}</td>
                                                    <td class="text-right">{score.score}</td>
                                                </tr>
                                            {/each}
        
                                            {#if currentScores.length === 0}
                                                <tr>
                                                    <td colspan="2" class="text-center">No scores yet</td>
                                                </tr>
                                            {/if}
                                        </tbody>
                                    </table>
                                </Tabs.Content>
                            {/each}
                        {/if}
                    </Tabs>
                </Dialog.Description>
            </Dialog.Content>
        </Dialog.Positioner>
    </Portal>
</Dialog>

<style>
    :global([data-state="open"].card) {
        animation: dialog-pop 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes dialog-pop {
        from {
            opacity: 0;
            transform: scale(0.9);
        }
        to {
            opacity: 1;
            transform: scale(1);
        }
    }
</style>
