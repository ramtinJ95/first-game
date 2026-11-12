<script lang="ts">
  import { factionName, STANCE_NAMES, whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { Army } from '../sim/state/army.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import { menOf } from '../sim/systems/economy.ts';
  import type { Actions } from './actions.ts';
  import { activityText, cssColour } from './describe.ts';

  let {
    game,
    armies,
    actions,
  }: { game: DeepReadonly<GameState>; armies: readonly DeepReadonly<Army>[]; actions: Actions } =
    $props();
</script>

{#if armies.length > 0}
  <h3>Armies here</h3>
  <ul class="pick-list" data-testid="armies-here">
    {#each armies as army (army.id)}
      <li>
        <button
          type="button"
          class="pick"
          onclick={() => actions.select({ kind: 'army', army: army.id })}
        >
          <span class="swatch" style:background={cssColour(game, army.owner)}></span>
          <span class="who"
            >{factionName(game, army.owner)} · {STANCE_NAMES[army.stance]} · {whole(
              menOf(game, army),
            )} men</span
          >
          <span class="what">{activityText(game, army)}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
