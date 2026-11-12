<script lang="ts">
  import type { Notice } from '../app/view.svelte.ts';

  let { notice }: { notice: Notice | undefined } = $props();
</script>

{#if notice}
  <p class="panel notice" role="status" data-testid="notice">{notice.text}</p>
{/if}

<style>
  .notice {
    position: fixed;
    bottom: 12px;
    left: 50%;
    max-width: 480px;
    margin: 0;
    color: var(--bad);
    transform: translateX(-50%);
    border-color: var(--bad);
  }
</style>
