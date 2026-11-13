<script lang="ts">
  import { DAYS_PER_SECOND, type Speed } from '../app/clock.ts';
  import { dateText } from '../app/names.ts';
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

<div class="controls" data-testid="time-controls">
  <span class="clock">
    <span data-testid="time-controls-day" data-day={view.current.state.day}
      >{dateText(view.current.state.day)}</span
    >
    <span data-testid="time-controls-speed" class:paused={view.current.paused}>
      {view.current.paused ? 'Paused' : `Speed ${view.current.speed}`}
    </span>
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
  .controls {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  [data-testid='time-controls-day'] {
    min-width: 8.5em;
    font-weight: bold;
  }

  .clock {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }

  [data-testid='time-controls-speed'] {
    font-size: 12px;
  }

  .paused {
    color: var(--bad);
  }

  button {
    min-width: 2em;
  }
</style>
