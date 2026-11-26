<script lang="ts">
  import { factionName } from '../app/names.ts';
  import type { View } from '../app/view.svelte.ts';
  import type { Stores } from '../sim/state/faction.ts';
  import { dailyBalances, limitsOf } from '../sim/systems/economy.ts';
  import { warsOf } from './describe.ts';
  import { studyLine } from './advances-text.ts';
  import { standingOffer } from '../sim/peace/offer.ts';
  import type { Actions } from './actions.ts';
  import { cssColour, ordersWaitingText, signed, storeAmount, storeNote } from './describe.ts';
  import type { FrameActions } from './frame-actions.ts';
  import FrameControls from './FrameControls.svelte';
  import TimeControls from './TimeControls.svelte';
  import { desertionLine } from '../app/desertion.ts';
  import { powersNearWar } from '../app/threat-news.ts';
  import type { World } from '../sim/world/world.ts';

  let {
    view,
    world,
    actions,
    frame,
  }: {
    view: View;
    world: World;
    actions: Actions;
    frame: FrameActions;
  } = $props();

  const threatText = (count: number) => `${count} ${count === 1 ? 'threat' : 'threats'}`;

  const STORES: { key: keyof Stores; name: string }[] = [
    { key: 'gold', name: 'Gold' },
    { key: 'food', name: 'Food' },
    { key: 'manpower', name: 'Manpower' },
  ];

  const game = $derived(view.current.state);
  const fallen = $derived((game.factions[game.player]?.defeatedOn ?? null) !== null);
  const stores = $derived(game.factions[game.player]?.stores);
  const granaries = $derived(
    Object.values(game.cities).filter(
      (city) => city.owner === game.player && city.buildings.includes('greatGranary'),
    ).length,
  );
  const deserting = $derived(!fallen && desertionLine(game));
  const balance = $derived(dailyBalances(game).get(game.player));
  const limits = $derived(limitsOf(game).get(game.player));
  const wars = $derived(warsOf(game, game.player));
  const threats = $derived(fallen ? 0 : powersNearWar(game, world));
  const offers = $derived(
    wars.filter((war) => {
      const offer = standingOffer(game, game.player, war.against);
      return offer && offer.from !== game.player;
    }).length,
  );
  const study = $derived(studyLine(game, game.player));
  const studying = $derived((game.factions[game.player]?.study ?? null) !== null);
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
        {@const note = storeNote(key, stores[key], balance[key], limits?.[key], granaries)}
        <span class="store" class:falling={note?.bad} data-testid="store-{key}" title={note?.why}>
          <span class="line">
            <span class="muted">{name}</span>
            {#if note}<span class="note" data-testid="store-{key}-note">{note.text}</span>{/if}
          </span>
          <span class="line">
            <strong data-testid="store-{key}-amount">{storeAmount(stores[key])}</strong>
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
      aria-label={`Wars ${wars.length}${threats > 0 ? `, ${threatText(threats)}` : ''}${offers > 0 ? `, ${offers} ${offers === 1 ? 'offer' : 'offers'} waiting` : ''}`}
      title={threats > 0
        ? 'A great power at peace with you is near the strength it needs to declare war on you. The Wars panel says which and how near.'
        : undefined}
      onclick={() => actions.togglePanel('wars')}
      >Wars {wars.length}{#if threats > 0}<span class="threat-note" data-testid="wars-threat"
          >· {threatText(threats)}</span
        >{/if}{#if offers > 0}<span class="offer-note">Offer waiting</span>{/if}</button
    >
    <button
      type="button"
      class="study"
      data-testid="advances-button"
      class:idle={!studying}
      aria-expanded={view.current.panel === 'advances'}
      aria-controls="advances"
      title={study.full}
      onclick={() => actions.togglePanel('advances')}
      ><span>Advances</span><span class="study-note wide" data-testid="study-line"
        >{study.short}</span
      ><span class="study-note narrow" data-testid="study-days">{study.days}</span></button
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

  .study {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.15;
  }

  .study-note {
    font-size: 12px;
  }

  .study.idle .study-note {
    color: var(--bad);
  }

  /* The open panel's button is drawn dark, where the warning colour cannot be read. */
  .study.idle[aria-expanded='true'] .study-note {
    color: inherit;
  }

  /* Below 1280 px only the days fit beside the other buttons; the tooltip names the advance. */
  .study-note.narrow {
    display: none;
  }

  @media (max-width: 1279px) {
    .study-note.wide {
      display: none;
    }
    .study-note.narrow {
      display: inline;
    }
  }

  .threat-note {
    margin-left: 0.3em;
    color: var(--bad);
  }

  /* The open panel's button is drawn dark, where the warning colour cannot be read. */
  [aria-expanded='true'] .threat-note {
    color: inherit;
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

  /*
   * On a phone the buttons take a second row of their own rather than shorter words, as the bar
   * already wraps into rows there. The bar holds the Game menu, which opens across its width.
   */
  @media (max-width: 1023px) {
    .bar {
      position: relative;
    }
    .end {
      flex-wrap: wrap;
      flex-shrink: 1;
      justify-content: flex-end;
      row-gap: 4px;
      min-width: 0;
    }
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
