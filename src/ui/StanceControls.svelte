<script lang="ts">
  import { STANCE_NAMES } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { FactionId } from '../sim/ids.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import { STANCES, type Army } from '../sim/state/army.ts';
  import { RETREAT_LOSS } from '../sim/systems/battles.ts';
  import type { Actions } from './actions.ts';
  import { pendingOrder, stanceEffectText } from './describe.ts';

  let {
    player,
    army,
    pending,
    actions,
  }: {
    player: FactionId;
    army: DeepReadonly<Army>;
    pending: readonly Order[];
    actions: Actions;
  } = $props();

  const uid = $props.id();
  const base = $derived({ faction: player, army: army.id });
  const stance = $derived(
    pendingOrder(pending, 'setStance', (order) => order.army === army.id)?.stance ?? army.stance,
  );
  const retreating = $derived(
    pendingOrder(pending, 'retreat', (order) => order.army === army.id) !== undefined,
  );
</script>

<div class="stances" role="group" aria-label="Stance">
  {#each STANCES as option (option)}
    <button
      type="button"
      aria-pressed={stance === option}
      aria-describedby="{uid}-{option}"
      onclick={() => actions.issue({ kind: 'setStance', ...base, stance: option })}
      >{STANCE_NAMES[option]}</button
    >
    <span class="effect" id="{uid}-{option}">{stanceEffectText(option)}</span>
  {/each}
</div>
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
  .stances {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 3px 8px;
    align-items: center;
    margin-top: 4px;
  }

  .stances button {
    text-align: left;
  }

  .effect {
    font-size: 12px;
    line-height: 1.25;
    color: var(--muted);
  }
</style>
