<script lang="ts">
  import { whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import type { City } from '../sim/state/city.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import type { Actions } from './actions.ts';
  import { cityBuildings, paybackText, type OptionTier } from './buildings-text.ts';
  import type { World } from '../sim/world/world.ts';

  let {
    game,
    world,
    city,
    pending,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    world: World;
    city: DeepReadonly<City>;
    pending: readonly Order[];
    actions: Actions;
  } = $props();

  const shown = $derived(cityBuildings(game, pending, city, world));
  const GROUPS: readonly { tier: OptionTier; title: string | undefined }[] = [
    { tier: 'first', title: undefined },
    { tier: 'second', title: 'Second levels' },
    { tier: 'work', title: 'Great works · a city holds one' },
  ];
</script>

<section data-testid="city-buildings" aria-label="Buildings">
  <h3>Buildings</h3>
  {#if shown.built.length === 0 && !shown.work}
    <p class="muted">None yet. A city builds one at a time.</p>
  {/if}
  {#if shown.built.length > 0}
    <ul data-testid="city-built">
      {#each shown.built as line (line.kind)}
        <li>
          <span class="name">{line.name}</span>{#if line.level}
            · level {line.level}{:else}
            · great work{/if} · {line.effect}
        </li>
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
    {#each GROUPS as group (group.tier)}
      {@const options = shown.options.filter((option) => option.tier === group.tier)}
      {#if options.length > 0}
        {#if group.title}<h4>{group.title}</h4>{/if}
        <div class="options" data-testid="build-{group.tier}">
          {#each options as option (option.kind)}
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
                ><span class="name"
                  >{option.name}{#if option.raises}<span class="raises">
                      · {option.raises} level 2</span
                    >{/if}</span
                ><span class="cost">{whole(option.gold)} gold · {option.days} days</span></span
              >
              <span class="effect">{option.effect}</span>
              <span class="payback">{paybackText(option.payback)}</span>
              {#if option.caution}<span class="caution">{option.caution} You may still build.</span
                >{/if}
              {#if option.why}<span class="why">{option.why}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    {/each}
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

  h4 {
    margin: 6px 0 0;
    font-size: 11px;
    font-weight: bold;
  }

  .cost,
  .effect,
  .payback,
  .why {
    font-size: 11px;
  }

  .raises {
    font-weight: normal;
    font-size: 11px;
  }

  .caution {
    font-size: 11px;
    font-style: italic;
  }

  .cost {
    white-space: nowrap;
  }

  .why {
    color: var(--bad);
  }
</style>
