<script lang="ts">
  import { dailyText, type FateChoice } from '../app/fates.ts';
  import { buildingList, whole } from '../app/names.ts';
  import type { ShownModal } from '../app/view.svelte.ts';
  import { UNREST_DAYS } from '../sim/cities.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import type { FrameActions } from './frame-actions.ts';
  import { unrestText } from './describe.ts';

  let {
    game,
    fate,
    pauseOnFate,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    fate: Extract<ShownModal, { kind: 'fate' }>;
    pauseOnFate: boolean;
    actions: FrameActions;
  } = $props();

  const NAMES = { occupy: 'Occupy', sack: 'Sack', enslave: 'Enslave' } as const;
  const city = $derived(game.cities[fate.city]);

  function now(choice: FateChoice): string {
    const lines: string[] = [];
    if (choice.gold > 0) lines.push(`+${whole(choice.gold)} gold`);
    if (choice.manpower > 0) lines.push(`+${whole(choice.manpower)} manpower`);
    if (choice.peopleMoved > 0) lines.push(`${whole(choice.peopleMoved)} captives to your capital`);
    if (choice.peopleLost > 0) lines.push(`−${whole(choice.peopleLost)} people`);
    if (choice.buildingsKept.length > 0)
      lines.push(`keeps its ${buildingList(choice.buildingsKept)}`);
    if (choice.buildingsLost.length > 0) {
      lines.push(`destroys its ${buildingList(choice.buildingsLost)}`);
    }
    return lines.length > 0 ? lines.join(', ') : 'Nothing, and the city keeps its people';
  }
</script>

{#if city}
  <div class="panel fate" data-testid="fate-prompt" role="dialog" aria-labelledby="fate-title">
    <h2 id="fate-title">{city.name} has fallen to you</h2>
    <p class="muted">
      The game is paused. Choose what becomes of its {whole(city.population)} people.
    </p>
    <div class="choices" role="group" aria-label="Fates">
      <div class="fate-row fate-head" aria-hidden="true">
        <span></span>
        <span>Now</span>
        <span>Unrest</span>
        <span>A day in unrest, at first</span>
        <span>A day once calm</span>
      </div>
      {#each fate.choices as choice (choice.kind)}
        <button
          type="button"
          class="fate-row"
          data-testid="fate-{choice.kind}"
          disabled={choice.refusal !== undefined}
          title={choice.refusal}
          onclick={() => actions.decideFate(choice.order)}
        >
          <span class="name">{NAMES[choice.kind]}</span>
          <span
            class:good={choice.gold > 0 || choice.manpower > 0}
            data-testid="fate-{choice.kind}-now">{now(choice)}</span
          >
          <span class="bad" data-testid="fate-{choice.kind}-unrest"
            >{unrestText(choice.unrestDays)}</span
          >
          <span data-testid="fate-{choice.kind}-in-unrest">{dailyText(choice.unrest)}</span>
          <span data-testid="fate-{choice.kind}-calm">{dailyText(choice.calm)}</span>
        </button>
      {/each}
    </div>
    <p class="muted small">
      A city's yield rises evenly from its first day's to its calm one over the last {UNREST_DAYS}
      days of unrest. Without a choice the city is occupied when its days to choose run out, and the city
      panel offers these choices until then.
    </p>
    <label class="row-check">
      <input
        type="checkbox"
        checked={pauseOnFate}
        onchange={(event) => actions.setPauseOnFate(event.currentTarget.checked)}
      />
      Pause and ask when a city falls to you
    </label>
  </div>
{/if}

<style>
  .fate {
    position: fixed;
    top: 50%;
    left: 50%;
    width: min(760px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: 14px 18px 12px;
    background: var(--paper-solid);
    transform: translate(-50%, -50%);
    outline: 1px solid var(--rule);
    outline-offset: 4px;
  }

  .fate h2 {
    font-size: 22px;
    font-weight: normal;
    font-variant: small-caps;
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 10px 0 6px;
  }

  .fate-row {
    display: grid;
    grid-template-columns: 5.5rem 1.4fr 0.8fr 1.3fr 1.3fr;
    gap: 10px;
    align-items: baseline;
    padding: 6px 8px;
    font-size: 13px;
    text-align: left;
  }

  .fate-head {
    padding-block: 0;
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .name {
    font-size: 16px;
    font-weight: bold;
  }

  .small {
    font-size: 12px;
  }

  .row-check {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 6px;
  }

  @media (max-width: 639px) {
    .fate-head {
      display: none;
    }

    .fate-row {
      grid-template-columns: 1fr;
      gap: 2px;
    }

    .fate-row > :nth-child(3)::before {
      content: 'Unrest: ';
    }

    .fate-row > :nth-child(4)::before {
      content: 'A day in unrest, at first: ';
    }

    .fate-row > :nth-child(5)::before {
      content: 'A day once calm: ';
    }
  }
</style>
