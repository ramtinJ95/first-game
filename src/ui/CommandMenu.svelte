<script lang="ts">
  import type { MenuOption } from '../app/command.ts';
  import type { CommandMenu } from '../app/view.svelte.ts';
  import type { Actions } from './actions.ts';

  let { menu, actions }: { menu: CommandMenu | undefined; actions: Actions } = $props();

  const GROUPS: { group: MenuOption['group']; heading: string }[] = [
    { group: 'sea', heading: 'By sea' },
    { group: 'land', heading: 'By land' },
  ];
  /** Space between the click and the menu, and between the menu and the window's edge. */
  const GAP = 6;
  const EDGE = 8;

  let element: HTMLElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);
  let innerWidth = $state(0);
  let innerHeight = $state(0);

  /** Beside the click, flipped to its other side when that runs past the window. */
  function place(at: number, size: number, room: number): number {
    const after = at + GAP;
    const start = after + size > room - EDGE ? at - GAP - size : after;
    return Math.max(EDGE, Math.min(start, room - size - EDGE));
  }

  const groups = $derived(
    GROUPS.map(({ group, heading }) => ({
      group,
      heading,
      options: menu?.options.filter((option) => option.group === group) ?? [],
    })).filter(({ options }) => options.length > 0),
  );

  let focusedFor: CommandMenu | undefined;
  $effect(() => {
    // The view republishes the same menu ten times a second, and focus moves only for a new one.
    if (!menu || menu === focusedFor || !element) return;
    focusedFor = menu;
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  });

  function onkeydown(event: KeyboardEvent) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || !element) return;
    event.preventDefault();
    const items = [...element.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.findIndex((item) => item === document.activeElement);
    items.at((at + step) % items.length)?.focus();
  }

  function choose(option: MenuOption) {
    actions.issue(option.order);
    actions.closeMenu();
  }
</script>

<svelte:window bind:innerWidth bind:innerHeight />

{#if menu}
  <div
    class="panel menu"
    role="menu"
    tabindex="-1"
    aria-labelledby="command-menu-title"
    data-testid="command-menu"
    bind:this={element}
    bind:offsetWidth={width}
    bind:offsetHeight={height}
    style:left="{place(menu.screen.x, width, innerWidth)}px"
    style:top="{place(menu.screen.y, height, innerHeight)}px"
    {onkeydown}
  >
    <p class="title" id="command-menu-title" role="presentation">{menu.title}</p>
    {#each groups as { group, heading, options } (group)}
      <div class="group" role="group" aria-labelledby="command-menu-{group}">
        <p class="heading" id="command-menu-{group}" role="presentation">{heading}</p>
        {#each options as option (option.label)}
          <button type="button" role="menuitem" onclick={() => choose(option)}>
            <span class="way"
              ><span>{option.label}</span>{' '}<span class="days">{option.detail}</span></span
            >
            {#if option.notice}<span class="warning">{option.notice}</span>{/if}
          </button>
        {/each}
      </div>
    {/each}
    <button type="button" role="menuitem" class="cancel" onclick={() => actions.closeMenu()}
      >Cancel</button
    >
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 240px;
    padding: 8px 10px 10px;
    max-width: min(560px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    background: var(--paper-solid);
    border: 2px solid var(--ink);
    box-shadow:
      0 0 0 3px rgb(250 243 228 / 85%),
      0 10px 28px rgb(59 42 26 / 50%);
  }

  .title {
    margin: 0 0 2px;
    font-size: 16px;
    font-weight: bold;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .heading {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .menu button {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
  }

  .way {
    display: flex;
    gap: 16px;
    justify-content: space-between;
  }

  .warning {
    font-size: 12px;
    color: var(--bad);
  }

  .menu button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
    background: rgb(122 75 42 / 14%);
  }

  .days {
    color: var(--muted);
    white-space: nowrap;
  }

  .cancel {
    margin-top: 4px;
    color: var(--muted);
  }
</style>
