<script lang="ts">
  import { dateText, factionName, whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { Sight } from '../sim/sight.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import type { Actions } from './actions.ts';
  import { cssColour, overviewOf } from './describe.ts';

  let {
    game,
    sight,
    actions,
    openWars,
  }: {
    game: DeepReadonly<GameState>;
    sight: Sight;
    actions: Actions;
    /** Opens the wars panel, where peace is made. */
    openWars: () => void;
  } = $props();

  const overview = $derived(overviewOf(game, sight));
  const colour = $derived(cssColour(game, game.player));
</script>

<section class="panel overview" id="overview" data-testid="overview" aria-label="Overview">
  <h2>Overview</h2>

  {#if overview.kind === 'fallen'}
    <p data-testid="overview-fallen">
      Your realm has fallen. {factionName(game, game.player)} lost its last city on {dateText(
        overview.on,
      )}, and nothing is left to command.
    </p>
  {:else}
    <h3>Cities</h3>
    <ul class="pick-list" data-testid="overview-cities">
      {#each overview.cities as row (row.city)}
        <li>
          <button type="button" class="pick" onclick={() => actions.show(row.pick, row.at)}>
            <span class="swatch" style:background={colour}></span>
            <span class="who"
              >{row.name} <span class="count">{whole(row.population)} people</span></span
            >
            <span class="what">{row.status}</span>
          </button>
        </li>
      {/each}
    </ul>

    <h3>Armies</h3>
    {#if overview.armies.length === 0}
      <p class="muted">You have no army. Raise troops in a city.</p>
    {/if}
    <ul class="pick-list" data-testid="overview-armies">
      {#each overview.armies as row (row.army)}
        <li>
          <button type="button" class="pick" onclick={() => actions.show(row.pick, row.at)}>
            <span class="swatch" style:background={colour}></span>
            <span class="who">{row.name} <span class="count">{whole(row.men)} men</span></span>
            <span class="what">{row.activity}</span>
          </button>
        </li>
      {/each}
    </ul>

    {#if overview.columns.length > 0}
      <h3>On the road</h3>
      <ul class="pick-list" data-testid="overview-columns">
        {#each overview.columns as row (row.column)}
          <li>
            <button type="button" class="pick" onclick={() => actions.show(row.pick, row.at)}>
              <span class="swatch" style:background={colour}></span>
              <span class="who">{row.route}</span>
              <span class="what">{whole(row.people)} people</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <h3>Wars</h3>
    <ul class="pick-list" data-testid="overview-wars">
      {#each overview.wars as war (war.against)}
        <li>
          <button type="button" class="pick bad" onclick={openWars}
            >At war with {war.name} since day {war.since}</button
          >
        </li>
      {:else}
        <li>At peace with everyone</li>
      {/each}
    </ul>
    <button type="button" data-testid="open-wars" onclick={openWars}>Wars and peace</button>
  {/if}
</section>

<style>
  .overview {
    width: 320px;
    max-width: 100%;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .count {
    font-weight: normal;
    color: var(--muted);
  }
</style>
