<script lang="ts">
  import { factionName, whole } from '../app/names.ts';
  import type { View } from '../app/view.svelte.ts';
  import type { Stores } from '../sim/state/faction.ts';
  import { dailyBalances, limitsOf } from '../sim/systems/economy.ts';
  import { warsOf } from './describe.ts';
  import { standingOffer } from '../sim/peace/offer.ts';
  import type { Actions } from './actions.ts';
  import { cssColour, ordersWaitingText, signed, storeNote } from './describe.ts';
  import type { FrameActions } from './frame-actions.ts';
  import FrameControls from './FrameControls.svelte';
  import TimeControls from './TimeControls.svelte';
  import { desertionLine } from '../app/desertion.ts';

  let {
    view,
    actions,
    frame,
  }: {
    view: View;
    actions: Actions;
    frame: FrameActions;
  } = $props();

  const STORES: { key: keyof Stores; name: string }[] = [
    { key: 'gold', name: 'Gold' },
    { key: 'food', name: 'Food' },
    { key: 'manpower', name: 'Manpower' },
  ];

  const game = $derived(view.current.state);
  const fallen = $derived((game.factions[game.player]?.defeatedOn ?? null) !== null);
  const stores = $derived(game.factions[game.player]?.stores);
  const deserting = $derived(!fallen && desertionLine(game));
  const balance = $derived(dailyBalances(game).get(game.player));
  const limits = $derived(limitsOf(game).get(game.player));
  const wars = $derived(warsOf(game, game.player));
  const offers = $derived(
    wars.filter((war) => {
      const offer = standingOffer(game, game.player, war.against);
      return offer && offer.from !== game.player;
    }).length,
  );
  const waiting = $derived(
    view.current.paused ? ordersWaitingText(view.current.pending, game.player) : undefined,
  );
</script>

<header class="panel bar" data-testid="top-bar">
  <span class="realm">
    <span class="swatch" style:background={cssColour(game, game.player)}></span>
    <strong>{factionName(game, game.player)}</strong>
  </span>
  {#if fallen}
    <span class="fallen" data-testid="realm-fallen">Your realm has fallen</span>
  {:else if stores && balance}
    <span class="stores">
      {#each STORES as { key, name } (key)}
        {@const note = storeNote(key, stores[key], balance[key], limits?.[key])}
        <span class="store" class:falling={note?.bad} data-testid="store-{key}" title={note?.why}>
          <span class="line">
            <span class="muted">{name}</span>
            {#if note}<span class="note" data-testid="store-{key}-note">{note.text}</span>{/if}
          </span>
          <span class="line">
            <strong data-testid="store-{key}-amount">{whole(stores[key])}</strong>
            <span class="change" data-testid="store-{key}-change">{signed(balance[key])}/day</span>
          </span>
        </span>
      {/each}
    </span>
  {/if}
  <TimeControls {view} controls={actions} />
  {#if waiting}
    <span class="waiting" data-testid="orders-waiting" title={waiting.full}>
      <span class="muted">Orders for</span>
      <span>{waiting.short}</span>
    </span>
  {/if}
  <span class="end">
    <button
      type="button"
      data-testid="wars-button"
      class:offer={offers > 0}
      aria-expanded={view.current.panel === 'wars'}
      aria-label={`Wars ${wars.length}${offers > 0 ? `, ${offers} ${offers === 1 ? 'offer' : 'offers'} waiting` : ''}`}
      onclick={() => actions.togglePanel('wars')}
      >Wars {wars.length}{#if offers > 0}<span class="offer-note">Offer waiting</span>{/if}</button
    >
    <button
      type="button"
      aria-expanded={view.current.panel === 'overview'}
      aria-controls="overview"
      onclick={() => actions.togglePanel('overview')}>Overview</button
    >
    <FrameControls frame={view.current.frame} actions={frame} />
  </span>
</header>
{#if deserting}
  <div class="panel desertion" role="status" data-testid="desertion-standing">{deserting}</div>
{/if}

<style>
  .desertion {
    color: var(--bad);
    padding-block: 3px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    align-items: center;
    padding: 5px 12px;
  }

  .offer-note {
    display: block;
    font-size: 11px;
    line-height: 1;
  }

  .offer {
    font-weight: bold;
  }

  .waiting {
    display: flex;
    flex-direction: column;
    font-size: 12px;
    line-height: 1.2;
    white-space: nowrap;
  }

  /* The Game menu opens leftward from the bar's right edge, so it stays on the page. */
  .end {
    display: flex;
    gap: 6px;
    margin-left: auto;
    flex-shrink: 0;
    white-space: nowrap;
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
    flex-direction: column;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }

  .line {
    display: flex;
    gap: 5px;
    align-items: baseline;
    white-space: nowrap;
  }

  .line .muted {
    font-size: 12px;
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

  .fallen {
    font-style: italic;
    color: var(--muted);
  }

  .falling strong,
  .falling .change,
  .falling .note {
    color: var(--bad);
  }

  @media (min-width: 1024px) {
    .bar,
    .stores {
      flex-wrap: nowrap;
      gap: 6px;
    }
    .bar {
      padding-inline: 6px;
    }
    .end {
      gap: 4px;
    }
    .end button {
      padding-inline: 5px;
    }
    .realm {
      font-size: 14px;
      gap: 4px;
    }
  }

  @media (min-width: 1024px) and (max-width: 1150px) {
    /* Long store notes keep their own line, leaving room for orders and every button. */
    .store .line:first-child {
      display: contents;
    }
    .note {
      order: 1;
    }
  }
</style>
