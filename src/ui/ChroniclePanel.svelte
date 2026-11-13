<script lang="ts">
  import type { Alert } from '../app/alerts.ts';
  import { dateText } from '../app/names.ts';
  import type { Actions } from './actions.ts';

  let { alerts, actions }: { alerts: readonly Alert[]; actions: Actions } = $props();
</script>

<section class="panel chronicle" id="chronicle" data-testid="chronicle" aria-label="Chronicle">
  <h2>Chronicle</h2>
  {#if alerts.length === 0}
    <p class="muted">Nothing has happened yet.</p>
  {/if}
  <ol class="entries">
    {#each alerts as alert, i (i)}
      <li>
        <button
          type="button"
          class="entry {alert.tone}"
          disabled={!alert.focus}
          onclick={() => actions.openAlert(alert)}
        >
          <span class="day">{dateText(alert.day)}</span>
          <span class="text"
            >{#if alert.paused}<span class="paused">Paused</span>{/if}{alert.text}</span
          >
          {#if alert.count && alert.count > 1}<span class="count">×{alert.count}</span>{/if}
        </button>
      </li>
    {/each}
  </ol>
</section>

<style>
  .chronicle {
    display: flex;
    flex-direction: column;
    width: 360px;
    max-width: 100%;
    min-height: 0;
    max-height: 100%;
  }

  .entries {
    min-height: 0;
    margin: 4px 0 0;
    padding: 0 0 4px;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
  }

  .entry {
    display: grid;
    grid-template-columns: 7.5rem 1fr auto;
    gap: 8px;
    align-items: baseline;
    width: 100%;
    padding: 3px 4px 3px 8px;
    text-align: left;
    background: none;
    border: none;
    border-left: 3px solid transparent;
  }

  .entry:disabled {
    color: var(--ink);
  }

  .entry.good {
    border-left-color: var(--good);
  }

  .entry.bad {
    border-left-color: var(--bad);
  }

  .day {
    font-size: 12px;
    color: var(--muted);
  }

  .count {
    font-weight: bold;
  }

  .paused {
    margin-right: 6px;
    padding: 0 4px;
    font-size: 11px;
    color: var(--paper-solid);
    text-transform: uppercase;
    background: var(--bad);
  }
</style>
