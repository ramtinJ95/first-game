<script lang="ts">
  import type { Alert } from '../app/alerts.ts';
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
          <span class="day">Day {alert.day}</span>
          <span class="text">{alert.text}</span>
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

  .fresh .day {
    font-weight: bold;
    color: var(--ink);
  }
</style>
