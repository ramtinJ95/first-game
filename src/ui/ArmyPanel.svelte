<script lang="ts">
  import { factionName, STANCE_NAMES, whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import { STANCES, type Army } from '../sim/state/army.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import { RETREAT_LOSS } from '../sim/systems/battles.ts';
  import { menOf } from '../sim/systems/economy.ts';
  import type { Actions } from './actions.ts';
  import { activityText, cssColour, pendingOrder } from './describe.ts';
  import Formations from './Formations.svelte';
  import WarStatus from './WarStatus.svelte';

  let {
    game,
    army,
    pending,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    army: DeepReadonly<Army>;
    pending: readonly Order[];
    actions: Actions;
  } = $props();

  const own = $derived(army.owner === game.player);
  const stance = $derived(
    pendingOrder(pending, 'setStance', (order) => order.army === army.id)?.stance ?? army.stance,
  );
  const base = $derived({ faction: game.player, army: army.id });
</script>

<section class="panel" data-testid="army-panel" aria-label="Army">
  <div class="head">
    <span class="swatch" style:background={cssColour(game, army.owner)}></span>
    <h2>Army of {factionName(game, army.owner)}</h2>
    <span class="muted" data-testid="army-men">{whole(menOf(game, army))} men</span>
  </div>
  <p data-testid="army-activity">{activityText(game, army)}</p>
  <p class="muted" data-testid="army-general">
    General's skill {army.generalSkill} of 10 · {STANCE_NAMES[army.stance]}
  </p>
  <Formations {game} ids={army.formations} />
  {#if own}
    <h3>Stance</h3>
    <div class="row" role="group" aria-label="Stance">
      {#each STANCES as option (option)}
        <button
          type="button"
          aria-pressed={stance === option}
          onclick={() => actions.issue({ kind: 'setStance', ...base, stance: option })}
          >{STANCE_NAMES[option]}</button
        >
      {/each}
    </div>
    <div class="row">
      {#if army.activity.kind === 'marching'}
        <button type="button" onclick={() => actions.issue({ kind: 'halt', ...base })}>Halt</button>
      {/if}
      {#if army.activity.kind === 'inBattle'}
        <button
          type="button"
          class="danger"
          onclick={() => actions.issue({ kind: 'retreat', ...base })}
          >Retreat, losing {Math.round(RETREAT_LOSS * 100)}% of the men</button
        >
      {/if}
    </div>
    {#if army.activity.kind !== 'inBattle' && army.activity.kind !== 'embarked'}
      <p class="muted hint">
        Right-click the land to march there, or a port to sail from your port.
      </p>
    {/if}
  {:else}
    {#key army.owner}
      <WarStatus {game} owner={army.owner} {pending} {actions} />
    {/key}
  {/if}
</section>

<style>
  .hint {
    margin-top: 6px;
    font-size: 12px;
  }
</style>
