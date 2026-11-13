<script lang="ts">
  import { factionName, whole } from '../app/names.ts';
  import type { View } from '../app/view.svelte.ts';
  import type { Stores } from '../sim/state/faction.ts';
  import { dailyBalances, limitsOf } from '../sim/systems/economy.ts';
  import type { Actions } from './actions.ts';
  import { cssColour, ordersWaitingText, signed, storeNote } from './describe.ts';
  import type { FrameActions } from './frame-actions.ts';
  import FrameControls from './FrameControls.svelte';
  import TimeControls from './TimeControls.svelte';

  let {
    view,
    actions,
    frame,
    overview,
    toggleOverview,
  }: {
    view: View;
    actions: Actions;
    frame: FrameActions;
    overview: boolean;
    toggleOverview: () => void;
  } = $props();

  const STORES: { key: keyof Stores; name: string }[] = [
    { key: 'gold', name: 'Gold' },
    { key: 'food', name: 'Food' },
    { key: 'manpower', name: 'Manpower' },
  ];

  const game = $derived(view.current.state);
  const stores = $derived(game.factions[game.player]?.stores);
  const balance = $derived(dailyBalances(game).get(game.player));
  const limits = $derived(limitsOf(game).get(game.player));
  const waiting = $derived(
    view.current.paused ? ordersWaitingText(view.current.pending, game.player) : undefined,
  );
</script>

<header class="panel bar" data-testid="top-bar">
  <span class="realm">
    <span class="swatch" style:background={cssColour(game, game.player)}></span>
    <strong>{factionName(game, game.player)}</strong>
  </span>
  {#if stores && balance}
    <span class="stores">
      {#each STORES as { key, name } (key)}
        {@const note = storeNote(
          key,
          stores[key],
          balance[key],
          key === 'gold' ? undefined : limits?.[key],
        )}
        <span class="store" class:falling={note?.bad} data-testid="store-{key}" title={note?.why}>
          <span class="muted">{name}</span>
          <strong data-testid="store-{key}-amount">{whole(stores[key])}</strong>
          <span class="change" data-testid="store-{key}-change">{signed(balance[key])}/day</span>
          {#if note}<span class="note" data-testid="store-{key}-note">{note.text}</span>{/if}
        </span>
      {/each}
    </span>
  {/if}
  <TimeControls {view} controls={actions} />
  <button type="button" aria-expanded={overview} aria-controls="overview" onclick={toggleOverview}
    >Overview</button
  >
  <FrameControls frame={view.current.frame} actions={frame} />
  {#if waiting}
    <span class="muted" data-testid="orders-waiting">{waiting}</span>
  {/if}
</header>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    align-items: center;
    padding: 6px 12px;
  }

  .realm {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 16px;
  }

  .stores {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }

  .store {
    display: flex;
    gap: 5px;
    align-items: baseline;
    font-variant-numeric: tabular-nums;
  }

  .change {
    font-size: 12px;
    color: var(--muted);
  }

  .note {
    font-size: 12px;
    font-style: italic;
    color: var(--muted);
  }

  .falling strong,
  .falling .change,
  .falling .note {
    color: var(--bad);
  }
</style>
