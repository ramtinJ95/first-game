<script lang="ts">
  import { dateText, factionName } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { FactionId } from '../sim/ids.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import { warKey } from '../sim/state/war.ts';
  import type { Actions } from './actions.ts';
  import { truceDaysLeft } from '../sim/peace/truce.ts';
  import { pendingOrder } from './describe.ts';

  let {
    game,
    owner,
    pending,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    owner: FactionId;
    pending: readonly Order[];
    actions: Actions;
  } = $props();

  let confirming = $state(false);

  const name = $derived(factionName(game, owner));
  const war = $derived(owner === game.player ? undefined : game.wars[warKey(game.player, owner)]);
  const declared = $derived(
    pendingOrder(pending, 'declareWar', (order) => order.against === owner) !== undefined,
  );
  const defeated = $derived(game.factions[owner]?.defeatedOn != null);
  const truce = $derived(owner === game.player ? 0 : truceDaysLeft(game, game.player, owner));
</script>

<div class="war" data-testid="war-status">
  {#if war}
    <p class="bad">At war with {name} since {dateText(war.since)}</p>
  {:else if declared}
    <p class="bad">War on {name} is declared and begins with the next day</p>
  {:else}
    <p>At peace with {name}</p>
    {#if defeated}
      <p class="muted">{name} is out of the game</p>
    {:else if truce > 0}
      <p class="muted" data-testid="truce">
        A truce with {name} holds for {truce} more days. Neither side may declare war until {dateText(
          game.day + truce,
        )}.
      </p>
    {:else if confirming}
      <div class="row">
        <span>Declare war on {name}?</span>
        <button
          type="button"
          class="danger"
          onclick={() => {
            actions.issue({ kind: 'declareWar', faction: game.player, against: owner });
            confirming = false;
          }}>Confirm war</button
        >
        <button type="button" onclick={() => (confirming = false)}>Cancel</button>
      </div>
    {:else}
      <div class="row">
        <button type="button" class="danger" onclick={() => (confirming = true)}
          >Declare war on {name}</button
        >
      </div>
    {/if}
  {/if}
</div>

<style>
  .war {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid rgb(122 75 42 / 30%);
  }
</style>
