<script lang="ts">
  import type { Alert } from '../app/alerts.ts';
  import { dateText } from '../app/names.ts';
  import type { Actions } from './actions.ts';

  let { alerts, day, actions }: { alerts: readonly Alert[]; day: number; actions: Actions } =
    $props();

  /** The day of an alert at most this many days old stands out, so fresh news shows. */
  const FRESH_DAYS = 10;
</script>

{#if alerts.length > 0}
  <ol class="alerts" data-testid="alerts" aria-label="Alerts">
    {#each alerts as alert, i (i)}
      <li>
        <button
          type="button"
          class="panel {alert.tone}"
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
</style>
