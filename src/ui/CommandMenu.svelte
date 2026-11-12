<script lang="ts">
  import type { CommandMenu } from '../app/view.svelte.ts';
  import type { Actions } from './actions.ts';

  let { menu, actions }: { menu: CommandMenu | undefined; actions: Actions } = $props();
</script>

{#if menu}
  <div
    class="panel menu"
    role="menu"
    data-testid="command-menu"
    style:left="{menu.screen.x + 6}px"
    style:top="{menu.screen.y + 6}px"
  >
    {#each menu.options as option (option.label)}
      <button
        type="button"
        role="menuitem"
        onclick={() => {
          actions.issue(option.order);
          actions.closeMenu();
        }}>{option.label}</button
      >
    {/each}
    <button type="button" role="menuitem" class="muted" onclick={() => actions.closeMenu()}
      >Cancel</button
    >
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px;
  }

  .menu button {
    text-align: left;
  }
</style>
