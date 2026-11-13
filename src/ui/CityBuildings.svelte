<script lang="ts">
  import { whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import type { City } from '../sim/state/city.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import type { Actions } from './actions.ts';
  import { cityBuildings } from './buildings-text.ts';

  let {
    game,
    city,
    pending,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    city: DeepReadonly<City>;
    pending: readonly Order[];
    actions: Actions;
  } = $props();

  const shown = $derived(cityBuildings(game, pending, city));
</script>

<section data-testid="city-buildings" aria-label="Buildings">
  <h3>Buildings</h3>
  {#if shown.built.length === 0 && !shown.work}
    <p class="muted">None yet. A city builds one at a time.</p>
  {/if}
  {#if shown.built.length > 0}
    <ul data-testid="city-built">
      {#each shown.built as line (line.kind)}
        <li><span class="name">{line.name}</span> · {line.effect}</li>
      {/each}
    </ul>
  {/if}
  {#if shown.work?.kind === 'ordered'}
    <p data-testid="city-construction">{shown.work.name} · ordered for the next day</p>
  {:else if shown.work}
    <div class="work">
      <p data-testid="city-construction">
        {shown.work.name} · {shown.work.daysLeft} days left{#if shown.work.paused}<span class="bad">
            · {shown.work.paused}</span
          >{/if}
      </p>
      <button
        type="button"
        disabled={shown.work.cancelOrdered}
        onclick={() =>
          actions.issue({ kind: 'cancelBuilding', faction: game.player, city: city.id })}
        >{shown.work.cancelOrdered
          ? 'Cancel ordered'
          : `Cancel · ${whole(shown.work.refund)} gold back`}</button
      >
    </div>
  {/if}
  {#if shown.options.length > 0}
    {#if shown.blocked}<p class="muted" data-testid="build-blocked">{shown.blocked}</p>{/if}
    <div class="options">
      {#each shown.options as option (option.kind)}
        <button
          type="button"
          data-testid="build-{option.kind}"
          disabled={shown.blocked !== undefined || option.why !== undefined}
          title={option.why ?? shown.blocked}
          onclick={() =>
            actions.issue({
              kind: 'build',
              faction: game.player,
              city: city.id,
              building: option.kind,
            })}
        >
          <span class="top"
            ><span class="name">{option.name}</span><span class="cost"
              >{whole(option.gold)} gold · {option.days} days</span
            ></span
          >
          <span class="effect">{option.effect}</span>
          {#if option.why}<span class="why">{option.why}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  ul {
    margin: 0;
    padding-left: 1.1em;
  }

  .name {
    font-weight: bold;
  }

  .work {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    align-items: baseline;
    justify-content: space-between;
  }

  .options {
    display: grid;
    gap: 4px;
    margin-top: 4px;
  }

  .options button {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 3px 6px;
    text-align: left;
  }

  .top {
    display: flex;
    gap: 8px;
    justify-content: space-between;
  }

  .cost,
  .effect,
  .why {
    font-size: 11px;
  }

  .cost {
    white-space: nowrap;
  }

  .why {
    color: var(--bad);
  }
</style>
