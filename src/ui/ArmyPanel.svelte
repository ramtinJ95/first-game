<script lang="ts">
  import { armyTitle, STANCE_NAMES, whole } from '../app/names.ts';
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
    joinChoices,
    weakSiegeText,
    whyNotBesieging,
    joinOrderedText,
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
  /** The battle panel below shows an army in battle with its men and stance, so this panel does not repeat them. */
  const fighting = $derived(army.activity.kind === 'inBattle');
  const base = $derived({ faction: game.player, army: army.id });
  const here = $derived.by(() => {
    const at = armyPosition(game, army);
    return at ? armiesAt(game, sight, at, army.id) : [];
  });
  const joins = $derived(joinChoices(game, sight, army));
  const joined = $derived(joinOrderedText(game, pending, army));
  const blocked = $derived(own ? whyNotBesieging(game, army, pending) : undefined);
  const weak = $derived.by(() => {
    const siege = army.activity.kind === 'besieging' ? game.sieges[army.activity.siege] : undefined;
    return siege && weakSiegeText(game, sight, siege);
  });
</script>

<section class="panel" data-testid="army-panel" aria-label="Army">
  <div class="head">
    <span class="swatch" style:background={cssColour(game, army.owner)}></span>
    <h2 data-testid="army-name">{armyTitle(game, army)}</h2>
    <span class="muted" data-testid="army-men">{whole(menOf(game, army))} men</span>
  </div>
  <p data-testid="army-activity">{activityText(game, army)}</p>
  {#if joined}<p data-testid="join-ordered">{joined}</p>{/if}
  {#if blocked}
    <p class="bad" data-testid="army-siege-block">{blocked.text}</p>
    {#if blocked.besiege}
      {@const besiege = blocked.besiege}
      <div class="row">
        <button type="button" data-testid="army-besiege" onclick={() => actions.issue(besiege)}>
          Besiege
        </button>
      </div>
    {/if}
  {/if}
  {#if weak}
    <p class="bad" data-testid="army-weak-siege">{weak}</p>
  {/if}
  <p class="muted" data-testid="army-general">
    General's skill {army.generalSkill} of 10 · {STANCE_NAMES[army.stance]}
  </p>
  {#if fighting}
    <p class="muted hint" data-testid="army-in-battle">
      Its men, stance, and retreat are in the battle below.
    </p>
  {:else}
    <Formations {game} ids={army.formations} />
  {/if}
  {#if own}
    {#if !fighting}
      <h3>Stance</h3>
      <StanceControls {game} {army} {pending} {actions} />
    {/if}
    {#if army.activity.kind === 'marching'}
      <div class="row">
        <button type="button" onclick={() => actions.issue({ kind: 'halt', ...base })}>Halt</button>
      </div>
    {/if}
    {#if joins.length > 0}
      <h3>Join</h3>
      <ul class="joins" data-testid="army-joins">
        {#each joins as join (join.into.id)}
          <li>
            <button
              type="button"
              disabled={join.refusal !== undefined}
              title={join.refusal}
              onclick={() => actions.issue(join.order)}
            >
              Join {armyTitle(game, join.into)}
            </button>
            {#if join.refusal}<span class="muted">{join.refusal}</span>{/if}
          </li>
        {/each}
      </ul>
      <p class="muted hint">Armies at one place stay apart until one joins the other.</p>
    {/if}
    {#if army.activity.kind !== 'inBattle' && army.activity.kind !== 'embarked'}
      <p class="muted hint">
        Right-click the land to march there, or a port to sail there from a port or the shore.
      </p>
    {/if}
  {:else}
    {#key army.owner}
      <WarStatus {game} owner={army.owner} {pending} {actions} />
    {/key}
  {/if}
  {#if !fighting}
    <ArmiesHere {game} armies={here} {actions} />
  {/if}
</section>

<style>
  .joins {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .hint {
    margin-top: 6px;
    font-size: 12px;
  }
</style>
