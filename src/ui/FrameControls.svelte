<script lang="ts">
  import { dateText } from '../app/names.ts';
  import { SLOTS, type Slot } from '../app/saves.ts';
  import type { Frame } from '../app/view.svelte.ts';
  import type { FrameActions } from './frame-actions.ts';

  let { frame, actions }: { frame: Frame; actions: FrameActions } = $props();

  const SLOT_NAMES: Record<Slot, string> = { manual: 'your save', auto: 'the autosave' };

  let open = $state(false);
  let picker = $state<HTMLInputElement>();
  let root = $state<HTMLElement>();

  function act(run: () => void) {
    run();
    open = false;
  }

  function onpointerdown(event: PointerEvent) {
    if (open && root && event.target instanceof Node && !root.contains(event.target)) open = false;
  }

  function onkeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') open = false;
  }
</script>

<svelte:window {onpointerdown} {onkeydown} />

<span class="frame" bind:this={root}>
  <button type="button" onclick={() => actions.openGuide()}>Guide</button>
  <button type="button" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}
    >Game</button
  >
  {#if open}
    <div class="panel menu" role="menu" data-testid="save-menu">
      <button type="button" role="menuitem" onclick={() => act(() => actions.saveToBrowser())}
        >Save in this browser</button
      >
      {#each SLOTS as slot (slot)}
        {@const saved = frame.saves[slot]}
        <button
          type="button"
          role="menuitem"
          disabled={!saved}
          onclick={() => act(() => actions.loadFromBrowser(slot))}
        >
          Load {SLOT_NAMES[slot]}
          <span class="muted">{saved ? `${saved.realm}, ${dateText(saved.day)}` : 'none yet'}</span>
        </button>
      {/each}
      <hr />
      <button type="button" role="menuitem" onclick={() => act(() => actions.exportFile())}
        >Export to a file</button
      >
      <button type="button" role="menuitem" onclick={() => picker?.click()}
        >Import from a file</button
      >
      <hr />
      <button type="button" role="menuitem" onclick={() => act(() => actions.showStart())}
        >Start screen</button
      >
      <p class="muted hint">Dropping a save file on the page also loads it.</p>
    </div>
  {/if}
  <input
    bind:this={picker}
    type="file"
    accept=".json,application/json"
    hidden
    data-testid="import-file"
    onchange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      open = false;
      if (file) actions.importFile(file);
    }}
  />
</span>

<style>
  .frame {
    position: relative;
    display: flex;
    gap: 6px;
  }

  [aria-haspopup]::after {
    display: inline-block;
    margin-left: 6px;
    vertical-align: middle;
    content: '';
    border-top: 5px solid currentcolor;
    border-right: 4px solid transparent;
    border-left: 4px solid transparent;
  }

  .menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 250px;
    padding: 6px;
    background: var(--paper-solid);
  }

  .menu button {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    text-align: left;
  }

  .menu .muted {
    font-size: 12px;
  }

  hr {
    width: 100%;
    margin: 3px 0;
    border: 0;
    border-top: 1px solid rgb(122 75 42 / 40%);
  }

  .hint {
    max-width: 240px;
    font-size: 12px;
    font-style: italic;
  }
</style>
