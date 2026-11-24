<script lang="ts">
  import type { Alert } from '../app/alerts.ts';
  import { dateText } from '../app/names.ts';
  import type { Actions } from './actions.ts';

  let { alerts, day, actions }: { alerts: readonly Alert[]; day: number; actions: Actions } =
    $props();

  /** The day of an alert at most this many days old stands out, so fresh news shows. */
  const FRESH_DAYS = 10;

  let list: HTMLOListElement | undefined = $state();
  let shown: Alert | undefined;

  // A line that stopped the game is read to its last word: news told the same day can stand
  // above it, so the corner scrolls to it once, when it comes, and leaves the scroll to the player after.
  $effect(() => {
    const stopped = alerts.find((alert) => alert.paused);
    if (!list || !stopped || stopped === shown) return;
    shown = stopped;
    const item = list.children.item(alerts.indexOf(stopped));
    if (!item) return;
    const room = list.getBoundingClientRect();
    const line = item.getBoundingClientRect();
    if (line.bottom > room.bottom)
      list.scrollTop += Math.min(line.top - room.top, line.bottom - room.bottom);
  });
</script>

{#if alerts.length > 0}
  <ol class="alerts" data-testid="alerts" aria-label="Alerts" bind:this={list}>
    {#each alerts as alert (alert)}
      <li>
        <button
          type="button"
          class="panel {alert.tone}"
          class:world={alert.world !== undefined}
          class:fresh={day - alert.day <= FRESH_DAYS}
          disabled={!alert.focus}
          onclick={() => actions.openAlert(alert)}
        >
          <span class="day">{dateText(alert.day)}</span>
          <span class="text"
            >{#if alert.paused}<span class="paused" data-testid="alert-paused">Paused</span
              >{/if}{alert.paused ? ` ${alert.text}` : alert.text}</span
          >
          {#if alert.count && alert.count > 1}
            <span class="count" data-testid="alert-count">×{alert.count}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .alerts {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 300px;
    max-width: 100%;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
    pointer-events: auto;
  }

  button.panel {
    display: flex;
    gap: 8px;
    align-items: baseline;
    width: 100%;
    padding: 4px 10px;
    text-align: left;
    cursor: pointer;
    border-left-width: 4px;
  }

  button.panel:disabled {
    color: var(--ink);
    cursor: default;
  }

  .good {
    border-left-color: var(--good);
  }

  .bad {
    border-left-color: var(--bad);
  }

  .day {
    flex: none;
    font-size: 12px;
    color: var(--muted);
  }

  .count {
    flex: none;
    margin-left: auto;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
  }

  .paused {
    margin-right: 6px;
    padding: 0 4px;
    font-size: 11px;
    color: var(--paper-solid);
    text-transform: uppercase;
    background: var(--bad);
  }

  .fresh .day {
    font-weight: bold;
    color: var(--ink);
  }

  .world .text {
    font-style: italic;
    color: var(--muted);
  }
</style>
