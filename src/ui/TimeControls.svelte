<script lang="ts">
  import { DAYS_PER_SECOND, type Speed } from '../app/clock.ts';
  import type { View } from '../app/view.svelte.ts';

  interface Controls {
    togglePause(): void;
    setSpeed(speed: Speed): void;
  }

  let { view, controls }: { view: View; controls: Controls } = $props();

  const speeds = Object.keys(DAYS_PER_SECOND).map(Number) as Speed[];

  function typesText(target: EventTarget | null) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  // A focused button turns Space into a click of its own. Cancelling the default of
  // both keydown and keyup stops that in every engine, so Space only toggles pause.
  function onkeydown(event: KeyboardEvent) {
    if (event.key !== ' ' || typesText(event.target)) return;
    event.preventDefault();
    if (!event.repeat) controls.togglePause();
  }

  function onkeyup(event: KeyboardEvent) {
    if (event.key !== ' ' || typesText(event.target)) return;
    event.preventDefault();
  }
</script>

<svelte:window {onkeydown} {onkeyup} />

<div class="panel" data-testid="time-controls">
  <span data-testid="time-controls-realm">
    {view.current.state.factions[view.current.state.player]?.name} ·
    {Object.keys(view.current.state.provinces).length} provinces
  </span>
  <span data-testid="time-controls-day">Day {view.current.state.day}</span>
  <span data-testid="time-controls-speed">
    Speed {view.current.speed}{view.current.paused ? ' · paused' : ''}
  </span>
  <button type="button" onclick={() => controls.togglePause()}>
    {view.current.paused ? 'Resume' : 'Pause'}
  </button>
  {#each speeds as speed (speed)}
    <button
      type="button"
      aria-label="Speed {speed}"
      aria-pressed={view.current.speed === speed}
      onclick={() => controls.setSpeed(speed)}>{speed}</button
    >
  {/each}
</div>

<style>
  .panel {
    position: fixed;
    top: 16px;
    left: 16px;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    font:
      14px/1.4 Georgia,
      serif;
    color: #3b2a1a;
    background: rgb(250 243 228 / 90%);
    border: 1px solid #7a4b2a;
    border-radius: 4px;
  }

  [data-testid='time-controls-day'] {
    min-width: 5em;
    font-weight: bold;
  }

  button {
    min-width: 2em;
    padding: 2px 8px;
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: transparent;
    border: 1px solid #7a4b2a;
    border-radius: 3px;
  }

  button[aria-pressed='true'] {
    color: rgb(250 243 228);
    background: #7a4b2a;
  }
</style>
