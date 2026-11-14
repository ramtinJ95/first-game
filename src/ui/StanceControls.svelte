<script lang="ts">
  import { STANCE_NAMES } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import { STANCES, type Army } from '../sim/state/army.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import { RETREAT_LOSS } from '../sim/systems/battles.ts';
  import type { Actions } from './actions.ts';
  import {
    enemyInBattle,
    pendingOrder,
    reformCostText,
    reformingText,
    stanceChoiceText,
    stanceEffectText,
    stanceMatchShort,
    standingText,
  } from './describe.ts';

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

  const uid = $props.id();
  const base = $derived({ faction: game.player, army: army.id });
  const stance = $derived(
    pendingOrder(pending, 'setStance', (order) => order.army === army.id)?.stance ?? army.stance,
  );
  const retreating = $derived(
    pendingOrder(pending, 'retreat', (order) => order.army === army.id) !== undefined,
  );
  const enemy = $derived(enemyInBattle(game, army));
  const reformingNow = $derived(reformingText(game, army));
</script>

{#if enemy}
  <p class="standing" data-testid="stance-standing">{standingText(game, army, enemy)}</p>
{/if}
{#if reformingNow}
  <p class="bad" data-testid="stance-reforming">{reformingNow}</p>
{/if}
<div class="stances" role="group" aria-label="Stance">
  {#each STANCES as option (option)}
    {@const choice = stanceChoiceText(game, army, option, army.stance, enemy)}
    <button
      type="button"
      class:answers={choice.answers && option !== army.stance}
      aria-pressed={stance === option}
      aria-describedby="{uid}-{option}"
      data-testid="stance-{option}"
      onclick={() => actions.issue({ kind: 'setStance', ...base, stance: option })}
    >
      <span>{STANCE_NAMES[option]}</span>
      {#if choice.answers && option !== army.stance}<span class="mark"
          >Beats it after re-forming</span
        >{/if}
      {#if choice.cost}<span class="cost">{choice.cost}</span>{/if}
    </button>
    <span class="effect" id="{uid}-{option}"
      >{stanceMatchShort(option)} {stanceEffectText(option)}</span
    >
  {/each}
</div>
<p class="muted small" data-testid="stance-cost">{reformCostText()}</p>
{#if enemy}<p class="muted small" data-testid="stance-ai-rule">
    The enemy chooses freely once, then changes only when beaten and neither side re-forms. Matching
    skirmish stances is not a counter. It may answer your change after you re-form.
  </p>{/if}
{#if army.activity.kind === 'inBattle'}
  <div class="row">
    {#if retreating}
      <p class="bad" data-testid="retreat-ordered">Retreats with the next day</p>
    {:else}
      <button
        type="button"
        class="danger"
        onclick={() => actions.issue({ kind: 'retreat', ...base })}
        >Retreat, losing {Math.round(RETREAT_LOSS * 100)}% of the men</button
      >
    {/if}
  </div>
{/if}

<style>
  .standing {
    font-weight: bold;
  }

  .stances {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 3px 8px;
    align-items: center;
    margin-top: 4px;
  }

  .stances button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
  }

  .stances button.answers {
    outline: 2px solid var(--good);
  }

  .mark {
    font-size: 11px;
    color: var(--good);
  }

  .cost {
    font-size: 11px;
    color: var(--muted);
  }

  .effect {
    font-size: 12px;
    line-height: 1.25;
    color: var(--muted);
  }

  .small {
    font-size: 12px;
  }
</style>
