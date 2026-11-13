<script lang="ts">
  import { factionName, STANCE_NAMES, whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import type { Sight } from '../sim/sight.ts';
  import type { Army } from '../sim/state/army.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import { menOf } from '../sim/systems/economy.ts';
  import type { Actions } from './actions.ts';
  import ArmiesHere from './ArmiesHere.svelte';
  import {
    activityText,
    armiesAt,
    armyPosition,
    cssColour,
    weakSiegeText,
    whyNotBesieging,
  } from './describe.ts';
  import Formations from './Formations.svelte';
  import StanceControls from './StanceControls.svelte';
  import WarStatus from './WarStatus.svelte';

  let {
    game,
    army,
    sight,
    pending,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    army: DeepReadonly<Army>;
    sight: Sight;
    pending: readonly Order[];
    actions: Actions;
  } = $props();

  const own = $derived(army.owner === game.player);
  const base = $derived({ faction: game.player, army: army.id });
  const here = $derived.by(() => {
    const at = armyPosition(game, army);
    return at ? armiesAt(game, sight, at, army.id) : [];
  });
  const blocked = $derived(own ? whyNotBesieging(game, army, pending) : undefined);
  const weak = $derived.by(() => {
    const siege = army.activity.kind === 'besieging' ? game.sieges[army.activity.siege] : undefined;
    return siege && weakSiegeText(game, sight, siege);
  });
</script>

<section class="panel" data-testid="army-panel" aria-label="Army">
  <div class="head">
    <span class="swatch" style:background={cssColour(game, army.owner)}></span>
    <h2>Army of {factionName(game, army.owner)}</h2>
    <span class="muted" data-testid="army-men">{whole(menOf(game, army))} men</span>
  </div>
  <p data-testid="army-activity">{activityText(game, army)}</p>
  {#if blocked}
    <p class="bad" data-testid="army-siege-block">{blocked}</p>
  {/if}
  {#if weak}
    <p class="bad" data-testid="army-weak-siege">{weak}</p>
  {/if}
  <p class="muted" data-testid="army-general">
    General's skill {army.generalSkill} of 10 · {STANCE_NAMES[army.stance]}
  </p>
  <Formations {game} ids={army.formations} />
  {#if own}
    <h3>Stance</h3>
    <StanceControls {game} {army} {pending} {actions} />
    {#if army.activity.kind === 'marching'}
      <div class="row">
        <button type="button" onclick={() => actions.issue({ kind: 'halt', ...base })}>Halt</button>
      </div>
    {/if}
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
  <ArmiesHere {game} armies={here} {actions} />
</section>

<style>
  .hint {
    margin-top: 6px;
    font-size: 12px;
  }
</style>
