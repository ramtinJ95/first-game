<script lang="ts">
  import { dateText, factionName } from '../app/names.ts';
  import { latestSaved } from '../app/saves.ts';
  import type { Frame, ShownModal } from '../app/view.svelte.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import type { FrameActions } from './frame-actions.ts';

  let {
    game,
    frame,
    ending,
    actions,
  }: {
    game: DeepReadonly<GameState>;
    frame: Frame;
    ending: Extract<ShownModal, { kind: 'lost' | 'won' }>;
    actions: FrameActions;
  } = $props();

  const realm = $derived(factionName(game, game.player));
  const latest = $derived(latestSaved(frame.saves));
  const standing = $derived(frame.standing);
  const capitals = $derived(standing.capitals.map((id) => game.cities[id]?.name ?? id));
  let picker = $state<HTMLInputElement>();
</script>

<div class="backdrop">
  <div
    class="panel ending {ending.kind}"
    data-testid={ending.kind === 'lost' ? 'defeat' : 'victory'}
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="ending-title"
  >
    {#if ending.kind === 'lost'}
      <p class="kicker">{dateText(ending.on)}</p>
      <h2 id="ending-title">{realm} has fallen</h2>
      <p data-testid="defeat-text">
        {#if ending.city && ending.by}
          {game.cities[ending.city]?.name ?? ending.city}, your last city, fell to
          {factionName(game, ending.by)}.
        {:else}
          Your last city has fallen.
        {/if}
        Your armies are gone and your people serve new masters.
      </p>
      <div class="row">
        <button type="button" onclick={() => actions.closeModal()}>Watch on</button>
        {#if latest}
          <button type="button" onclick={() => actions.loadFromBrowser(latest.slot)}
            >Load the save of {dateText(latest.day)}</button
          >
        {/if}
        <button type="button" onclick={() => picker?.click()}>Load a file</button>
        <button type="button" onclick={() => actions.showStart()}>Start again</button>
      </div>
      <input
        bind:this={picker}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="defeat-import"
        onchange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) actions.importFile(file);
        }}
      />
    {:else}
      <p class="kicker">{dateText(ending.on)}</p>
      <h2 id="ending-title">{realm} is victorious</h2>
      <p data-testid="victory-text">
        You hold {standing.provinces} of the {Object.keys(game.provinces).length} provinces and the great
        capitals {capitals.join(', ')}. You have won.
      </p>
      <div class="row">
        <button type="button" onclick={() => actions.closeModal()}>Play on</button>
        <button type="button" onclick={() => actions.showStart()}>Start again</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(59 42 26 / 30%);
  }

  .ending {
    width: min(520px, calc(100vw - 32px));
    padding: 18px 24px 16px;
    text-align: center;
    background: var(--paper-solid);
    outline: 1px solid var(--rule);
    outline-offset: 4px;
  }

  .ending h2 {
    margin: 2px 0 8px;
    font-size: 28px;
    font-weight: normal;
    font-variant: small-caps;
    letter-spacing: 0.05em;
  }

  .lost h2 {
    color: var(--bad);
  }

  .won h2 {
    color: var(--good);
  }

  .kicker {
    font-style: italic;
    color: var(--muted);
  }

  .row {
    justify-content: center;
  }
</style>
