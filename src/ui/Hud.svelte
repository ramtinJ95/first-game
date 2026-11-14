<script lang="ts">
  import type { View } from '../app/view.svelte.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { GameMap } from '../sim/map.ts';
  import type { Actions } from './actions.ts';
  import AlertList from './AlertList.svelte';
  import ArmyPanel from './ArmyPanel.svelte';
  import BattlePanel from './BattlePanel.svelte';
  import ChroniclePanel from './ChroniclePanel.svelte';
  import CityPanel from './CityPanel.svelte';
  import CommandMenu from './CommandMenu.svelte';
  import { shownBattles } from './describe.ts';
  import Ending from './Ending.svelte';
  import FatePrompt from './FatePrompt.svelte';
  import type { FrameActions } from './frame-actions.ts';
  import Guide from './Guide.svelte';
  import LeaveConfirm from './LeaveConfirm.svelte';
  import NoticeToast from './NoticeToast.svelte';
  import OverviewPanel from './OverviewPanel.svelte';
  import StartScreen from './StartScreen.svelte';
  import TopBar from './TopBar.svelte';

  let {
    view,
    map,
    actions,
    frame,
  }: { view: View; map: DeepReadonly<GameMap>; actions: Actions; frame: FrameActions } = $props();

  /** The latest alerts the corner shows. The chronicle keeps them all. */
  const ALERTS_SHOWN = 5;
  const modal = $derived(view.current.frame.modal);

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

{#if modal?.kind === 'start'}
  <StartScreen frame={view.current.frame} actions={frame} />
{:else}
  <!-- The grid spans the map, so it lets clicks through and only the panels take them. -->
  <div class="hud">
    <div class="slot top">
      <TopBar {view} {actions} {frame} />
    </div>
    <div class="slot main">
      {#if view.current.panel === 'overview'}
        <OverviewPanel {game} {sight} {actions} />
      {:else if view.current.panel === 'chronicle'}
        <ChroniclePanel alerts={view.current.alerts} {actions} />
      {/if}
    </div>
    <aside class="side" aria-label="Selection">
      {#if army}
        <ArmyPanel {game} {army} {sight} pending={view.current.pending} {actions} />
      {/if}
      {#if city}
        {#key city.id}
          <CityPanel
            {game}
            {map}
            {city}
            {sight}
            pending={view.current.pending}
            occupied={view.current.occupied}
            {actions}
          />
        {/key}
      {/if}
      {#each battles as battle (battle.id)}
        <BattlePanel {game} {battle} pending={view.current.pending} {actions} />
      {/each}
    </aside>
    <div class="slot alerts">
      <button
        type="button"
        class="panel chronicle-toggle"
        aria-expanded={view.current.panel === 'chronicle'}
        aria-controls="chronicle"
        onclick={() => actions.togglePanel('chronicle')}>Chronicle</button
      >
      <div class="latest">
        <AlertList alerts={view.current.alerts.slice(0, ALERTS_SHOWN)} day={game.day} {actions} />
      </div>
    </div>
  </div>
  {#if !modal}
    <CommandMenu menu={view.current.menu} {actions} />
  {/if}

  {#if modal?.kind === 'leave'}
    <LeaveConfirm frame={view.current.frame} actions={frame} />
  {:else if modal?.kind === 'guide'}
    <Guide {game} frame={view.current.frame} actions={frame} />
  {:else if modal?.kind === 'fate'}
    <FatePrompt {game} fate={modal} pauseOnFate={view.current.frame.pauseOnFate} actions={frame} />
  {:else if modal?.kind === 'lost' || modal?.kind === 'won'}
    <Ending {game} frame={view.current.frame} ending={modal} actions={frame} />
  {/if}
{/if}
<NoticeToast notice={view.current.notice} />

<style>
  .hud {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-areas:
      'top top'
      'main side'
      'alerts side';
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 8px;
    padding: 12px;
    pointer-events: none;
  }

  .slot {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    min-height: 0;
  }

  /* The bar spans the page, so the buttons at its right end stand still as the numbers change. */
  .top {
    grid-area: top;
  }

  .top > :global(*) {
    align-self: stretch;
  }

  .main {
    grid-area: main;
  }

  .alerts {
    grid-area: alerts;
    gap: 4px;
    max-height: min(30vh, 11.5rem);
  }

  .latest {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .chronicle-toggle {
    padding: 2px 10px;
    font-size: 13px;
    pointer-events: auto;
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
      padding: 8px;
      grid-template-areas:
        'top'
        'main'
        'alerts'
        'side';
      grid-template-rows: auto minmax(0, 1fr) auto auto;
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
    }

    .alerts {
      max-height: 5.2rem;
    }

    .side {
      align-self: end;
      max-height: 42vh;
    }

    /* The open sheet takes the bottom of a phone. The latest news waits in the chronicle. */
    .hud:has(.side > :global(*)) .latest {
      display: none;
    }
  }
</style>
