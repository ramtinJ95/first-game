<script lang="ts">
  import type { View } from '../app/view.svelte.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { GameMap } from '../sim/map.ts';
  import type { Actions } from './actions.ts';
  import AlertList from './AlertList.svelte';
  import ArmyPanel from './ArmyPanel.svelte';
  import BattlePanel from './BattlePanel.svelte';
  import CityPanel from './CityPanel.svelte';
  import CommandMenu from './CommandMenu.svelte';
  import { shownBattles } from './describe.ts';
  import NoticeToast from './NoticeToast.svelte';
  import OverviewPanel from './OverviewPanel.svelte';
  import TopBar from './TopBar.svelte';

  let { view, map, actions }: { view: View; map: DeepReadonly<GameMap>; actions: Actions } =
    $props();

  let overview = $state(false);

  const game = $derived(view.current.state);
  const selection = $derived(view.current.selection);
  const sight = $derived(view.current.sight);
  const army = $derived(
    selection?.kind === 'army' && sight.armies.has(selection.army)
      ? game.armies[selection.army]
      : undefined,
  );
  const city = $derived.by(() => {
    if (selection?.kind !== 'province') return undefined;
    const id = game.provinces[selection.province]?.city;
    return id && game.cities[id];
  });

  const battles = $derived(
    shownBattles(game, selection).filter((battle) => sight.battles.has(battle.id)),
  );

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (view.current.menu) actions.closeMenu();
    else actions.select(undefined);
  }
</script>

<svelte:window {onkeydown} />

<!--
  One grid holds the top bar, the overview, the alerts, and the side column, so none
  covers another. The grid lets clicks through to the map; only the panels take them.
-->
<div class="hud">
  <div class="slot top">
    <TopBar {view} {actions} {overview} toggleOverview={() => (overview = !overview)} />
  </div>
  <div class="slot main">
    {#if overview}
      <OverviewPanel {game} {sight} {actions} />
    {/if}
  </div>
  <aside class="side" aria-label="Selection">
    {#if army}
      <ArmyPanel {game} {army} {sight} pending={view.current.pending} {actions} />
    {/if}
    {#if city}
      {#key city.id}
        <CityPanel {game} {map} {city} {sight} pending={view.current.pending} {actions} />
      {/key}
    {/if}
    {#each battles as battle (battle.id)}
      <BattlePanel {game} {battle} pending={view.current.pending} {actions} />
    {/each}
  </aside>
  <div class="slot alerts">
    <AlertList alerts={view.current.alerts} day={game.day} {actions} />
  </div>
</div>
<NoticeToast notice={view.current.notice} />
<CommandMenu menu={view.current.menu} {actions} />

<style>
  .hud {
    --gutter: 12px;
    --side-width: 320px;

    position: fixed;
    inset: 0;
    display: grid;
    grid-template-areas:
      'top side'
      'main side'
      'alerts side';
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr) var(--side-width);
    gap: 8px;
    padding: var(--gutter);
    pointer-events: none;
  }

  .slot {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    min-height: 0;
  }

  .top {
    grid-area: top;
  }

  .main {
    grid-area: main;
  }

  .alerts {
    grid-area: alerts;
    max-height: min(30vh, 11.5rem);
  }

  .side {
    display: flex;
    flex-direction: column;
    grid-area: side;
    gap: 8px;
    align-self: start;
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    pointer-events: auto;
  }

  @media (max-width: 719px) {
    .hud {
      --gutter: 8px;

      grid-template-areas:
        'top'
        'main'
        'alerts'
        'side';
      grid-template-rows: auto minmax(0, 1fr) auto auto;
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
    }

    .top > :global(*) {
      align-self: stretch;
    }

    .alerts {
      max-height: 5.2rem;
    }

    .side {
      align-self: end;
      max-height: 42vh;
    }
  }
</style>
