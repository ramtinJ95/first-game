<script lang="ts">
  import { dateText } from '../app/names.ts';
  import { latestSaved } from '../app/saves.ts';
  import type { Frame } from '../app/view.svelte.ts';
  import type { FrameActions } from './frame-actions.ts';

  let { frame, actions }: { frame: Frame; actions: FrameActions } = $props();

  const own = $derived(frame.saves.manual);
  const latest = $derived(latestSaved(frame.saves));
  let stay = $state<HTMLButtonElement>();

  $effect(() => stay?.focus());

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') actions.closeModal();
  }
</script>

<svelte:window {onkeydown} />

<div class="backdrop">
  <div
    class="panel leave"
    data-testid="leave-confirm"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="leave-title"
  >
    <h2 id="leave-title">Leave for the start screen?</h2>
    <p>The game is paused while you choose.</p>
    <ul>
      <li>
        <strong>Save and leave</strong>
        {own
          ? `writes today over your save of ${dateText(own.day)}.`
          : 'writes today to your save in this browser.'}
        Continue on the start screen loads it.
      </li>
      <li>
        <strong>Leave without saving</strong>
        {latest
          ? `loses the days since ${dateText(latest.day)}, your last save.`
          : 'loses this game, which has no save.'}
      </li>
      <li><strong>Stay</strong> goes back to the game as it was.</li>
    </ul>
    <div class="row">
      <button type="button" onclick={() => actions.leave(true)}>Save and leave</button>
      <button type="button" onclick={() => actions.leave(false)}>Leave without saving</button>
      <button type="button" bind:this={stay} onclick={() => actions.closeModal()}>Stay</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(59 42 26 / 30%);
  }

  .leave {
    width: min(440px, calc(100vw - 32px));
    padding: 14px 18px 14px;
    background: var(--paper-solid);
  }

  ul {
    padding-left: 18px;
    margin: 8px 0 12px;
  }

  li {
    margin: 3px 0;
  }

  .row {
    justify-content: flex-end;
  }
</style>
