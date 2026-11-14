<script lang="ts">
  import { armyTitle, placeName, STANCE_NAMES, whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import type { Battle } from '../sim/state/battle.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import { menOf } from '../sim/systems/economy.ts';
  import type { Actions } from './actions.ts';
  import { cssColour, reformingText } from './describe.ts';
  import Formations from './Formations.svelte';
  import StanceControls from './StanceControls.svelte';

  let {
    game,
    battle,
    pending,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    battle: DeepReadonly<Battle>;
    pending: readonly Order[];
    actions: Actions;
  } = $props();

  const sides = $derived(
    (['attackers', 'defenders'] as const).map((side) => {
      const armies = battle[side].flatMap((id) => game.armies[id] ?? []);
      return {
        side,
        title: side === 'attackers' ? 'Attackers' : 'Defenders',
        armies,
        men: armies.reduce((sum, army) => sum + menOf(game, army), 0),
        ours: armies.some((army) => army.owner === game.player),
      };
    }),
  );
</script>

<section class="panel" data-testid="battle-panel" aria-label="Battle">
  <div class="head">
    <h2>Battle {placeName(game, battle.position)}</h2>
    <span class="muted" data-testid="battle-day">day {game.day - battle.startedOn + 1}</span>
  </div>
  {#each sides as { side, title, armies, men, ours } (side)}
    <h3 data-testid="battle-{side}">
      {title}{ours ? ' (you)' : ''} · {whole(men)} men
    </h3>
    {#each armies as army (army.id)}
      <div class="army" data-testid="battle-army">
        <button
          type="button"
          class="pick"
          onclick={() => actions.select({ kind: 'army', army: army.id })}
        >
          <span class="swatch" style:background={cssColour(game, army.owner)}></span>
          <span class="who"
            >{armyTitle(game, army)} · {STANCE_NAMES[army.stance]}{reformingText(game, army)
              ? ` · ${reformingText(game, army)?.toLowerCase()}`
              : ''} · {whole(menOf(game, army))} men</span
          >
        </button>
        <Formations {game} ids={army.formations} />
        {#if army.owner === game.player}
          <StanceControls {game} {army} {pending} {actions} />
        {/if}
      </div>
    {/each}
  {/each}
</section>

<style>
  .army + .army {
    margin-top: 6px;
  }
</style>
