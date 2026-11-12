<script lang="ts">
  let { day }: { day: string } = $props();
</script>

<div class="panel" data-testid="panel">Skeleton running · {day}</div>

<style>
  .panel {
    position: fixed;
    top: 16px;
    left: 16px;
    padding: 8px 12px;
    font:
      14px/1.4 Georgia,
      serif;
    color: #3b2a1a;
    background: rgb(250 243 228 / 90%);
    border: 1px solid #7a4b2a;
    border-radius: 4px;
  }
</style>
