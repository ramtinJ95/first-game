<script lang="ts">
  import { TROOP_NAMES, whole } from '../app/names.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { FormationId } from '../sim/ids.ts';
  import type { GameState } from '../sim/state/game-state.ts';

  let { game, ids }: { game: DeepReadonly<GameState>; ids: readonly FormationId[] } = $props();

  const rows = $derived(ids.flatMap((id) => game.formations[id] ?? []));
</script>

<table data-testid="formations">
  <thead>
    <tr><th>Troop</th><th class="number">Men</th><th class="morale">Morale</th></tr>
  </thead>
  <tbody>
    {#each rows as formation (formation.id)}
      <tr data-testid="formation">
        <td>{TROOP_NAMES[formation.troop]}</td>
        <td class="number">{whole(formation.men)}</td>
        <td class="morale">
          <span class="bar" class:broken={formation.morale === 0}>
            <span style:width="{formation.morale * 100}%"></span>
          </span>
          <span class="percent">{Math.round(formation.morale * 100)}%</span>
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .morale {
    width: 7em;
    padding-left: 8px;
    white-space: nowrap;
  }

  .bar {
    display: inline-block;
    width: 3.6em;
    height: 6px;
    vertical-align: middle;
    border: 1px solid var(--rule);
    border-radius: 2px;
  }

  .bar > span {
    display: block;
    height: 100%;
    background: var(--rule);
  }

  .bar.broken {
    border-color: var(--bad);
  }

  .percent {
    display: inline-block;
    width: 2.6em;
    text-align: right;
  }
</style>
