<script lang="ts">
  import { dailyText, forgoneText } from '../app/fates.ts';
  import { whole } from '../app/names.ts';
  import type { ShownModal } from '../app/view.svelte.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import type { FrameActions } from './frame-actions.ts';

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
  const occupy = $derived(fate.choices.find((choice) => choice.kind === 'occupy'));

  function gives(choice: (typeof fate.choices)[number]): string[] {
    const lines: string[] = [];
    if (choice.gold > 0) lines.push(`+${whole(choice.gold)} gold`);
    if (choice.manpower > 0) lines.push(`+${whole(choice.manpower)} manpower`);
    if (choice.peopleMoved > 0) lines.push(`${whole(choice.peopleMoved)} captives settle at home`);
    if (lines.length === 0) lines.push('The city keeps all its people');
    return lines;
  }

  function costs(choice: (typeof fate.choices)[number]): string[] {
    const lines: string[] = [];
    if (choice.peopleLost > 0) lines.push(`−${whole(choice.peopleLost)} people in the city`);
    lines.push(`Unrest for ${choice.unrestDays} days`);
    return lines;
  }
</script>

{#if city}
  <div class="panel fate" data-testid="fate-prompt" role="dialog" aria-labelledby="fate-title">
    <h2 id="fate-title">{city.name} has fallen to you</h2>
    <p class="muted">
      The game is paused. Choose what becomes of its {whole(city.population)} people.
    </p>
    <div class="choices">
      {#each fate.choices as choice (choice.kind)}
        <button
          type="button"
          data-testid="fate-{choice.kind}"
          disabled={choice.refusal !== undefined}
          title={choice.refusal}
          onclick={() => actions.decideFate(choice.order)}
        >
          <span class="name">{NAMES[choice.kind]}</span>
          {#each gives(choice) as line (line)}<span class="good">{line}</span>{/each}
          {#each costs(choice) as line (line)}<span class="bad">{line}</span>{/each}
          <span data-testid="fate-{choice.kind}-daily">Then {dailyText(choice.daily)}</span>
          {#if occupy && forgoneText(choice, occupy)}
            <span class="bad" data-testid="fate-{choice.kind}-forgone"
              >{forgoneText(choice, occupy)}</span
            >
          {/if}
        </button>
      {/each}
    </div>
    <label class="row">
      <input
        type="checkbox"
        checked={pauseOnFate}
        onchange={(event) => actions.setPauseOnFate(event.currentTarget.checked)}
      />
      Pause and ask when a city falls to you
    </label>
    <p class="muted small">
      Without a choice the city is occupied when its days to choose run out. The city panel offers
      these choices until then.
    </p>
  </div>
{/if}

<style>
  .fate {
    position: fixed;
    top: 50%;
    left: 50%;
    width: min(560px, calc(100vw - 32px));
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
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin: 10px 0 6px;
  }

  .choices button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
    padding: 6px 8px;
    text-align: left;
  }

  .name {
    font-size: 16px;
    font-weight: bold;
  }

  .choices span:not(.name) {
    font-size: 12px;
  }

  .small {
    font-size: 12px;
  }
</style>
