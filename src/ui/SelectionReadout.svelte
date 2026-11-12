<script lang="ts">
  import type { View } from '../app/view.svelte.ts';

  let { view }: { view: View } = $props();

  const rows = $derived.by((): [string, string][] | undefined => {
    const { state, selection } = view.current;
    if (selection?.kind === 'province') {
      const province = state.provinces[selection.province];
      const city = province && state.cities[province.city];
      if (!province || !city) return undefined;
      return [
        ['Province', province.name],
        ['City', city.name],
        ['Owner', state.factions[city.owner]?.name ?? city.owner],
        ['Population', Math.round(city.population).toLocaleString('en')],
      ];
    }
    if (selection?.kind === 'army') {
      const army = state.armies[selection.army];
      if (!army) return undefined;
      const men = army.formations.reduce((sum, id) => sum + (state.formations[id]?.men ?? 0), 0);
      return [
        ['Army of', state.factions[army.owner]?.name ?? army.owner],
        ['Men', men.toLocaleString('en')],
      ];
    }
    return undefined;
  });
</script>

{#if rows}
  <dl class="readout" data-testid="selection-readout">
    {#each rows as [term, value] (term)}
      <dt>{term}</dt>
      <dd data-testid="readout-{term.toLowerCase().replace(' ', '-')}">{value}</dd>
    {/each}
  </dl>
{/if}

<style>
  .readout {
    position: fixed;
    bottom: 16px;
    left: 16px;
    display: grid;
    grid-template-columns: auto auto;
    gap: 2px 12px;
    min-width: 12em;
    margin: 0;
    padding: 8px 12px;
    font:
      14px/1.4 Georgia,
      serif;
    color: #3b2a1a;
    background: rgb(250 243 228 / 90%);
    border: 1px solid #7a4b2a;
    border-radius: 4px;
  }

  dt {
    color: #7a4b2a;
  }

  dd {
    margin: 0;
    font-weight: bold;
  }
</style>
