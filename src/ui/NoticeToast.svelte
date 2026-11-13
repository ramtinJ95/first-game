<script lang="ts">
  import type { Notice } from '../app/view.svelte.ts';

  let { notice }: { notice: Notice | undefined } = $props();
</script>

{#if notice}
  <p
    class="panel notice"
    class:info={notice.tone === 'info'}
    role="status"
    data-testid="notice"
    data-tone={notice.tone}
  >
    {notice.text}
  </p>
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
  .notice.info {
    color: var(--ink);
    border-color: var(--ink);
  }
</style>
