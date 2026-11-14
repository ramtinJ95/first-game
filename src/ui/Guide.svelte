<script lang="ts">
  import { factionName } from '../app/names.ts';
  import type { Frame } from '../app/view.svelte.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import { STANCES } from '../sim/state/army.ts';
  import { reformCostText, stanceMatchText } from './describe.ts';
  import type { FrameActions } from './frame-actions.ts';

  let {
    game,
    frame,
    actions,
  }: { game: DeepReadonly<GameState>; frame: Frame; actions: FrameActions } = $props();

  const standing = $derived(frame.standing);
  const home = $derived(standing.home ? game.cities[standing.home]?.name : undefined);
  const others = $derived(standing.capitalsNeeded - 1);
  const total = $derived(Object.keys(game.provinces).length);

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' && event.key !== 'Enter') return;
    event.preventDefault();
    actions.closeModal();
  }
</script>

<svelte:window {onkeydown} />

<div
  class="backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) actions.closeModal();
  }}
>
  <div
    class="panel guide"
    data-testid="guide"
    role="dialog"
    aria-modal="true"
    aria-labelledby="guide-title"
  >
    <h2 id="guide-title">You rule {factionName(game, game.player)}</h2>
    <p class="goal" data-testid="guide-goal">
      Hold {standing.provincesNeeded} of the {total} provinces, with {home ?? 'your capital'} and
      {others} other great {others === 1 ? 'capital' : 'capitals'} among them, and you win. Lose your
      last city and you lose.
    </p>
    <p class="muted" data-testid="guide-standing">
      Today you hold {standing.provinces} provinces and {standing.capitals.length}
      {standing.capitals.length === 1 ? 'great capital' : 'great capitals'}.
    </p>
    <dl>
      <dt>Select and march</dt>
      <dd>
        Click an army's banner or figures; a city symbol opens its city, with Armies here below.
        Right-click to march. Right-click a port to see ways by land or sea; ships also gather on a
        shore.
      </dd>
      <dt>War and sieges</dt>
      <dd>
        A foreign city or army opens Declare war. March to its city to besiege it. Bring enough men
        to cut the food: a weaker force suffers sallies. The city panel offers Storm and, after a
        capture, Occupy, Sack, or Enslave.
      </dd>
      <dt>Buildings and stores</dt>
      <dd>
        Select your city to recruit or build. Buildings cost gold now and finish later; unrest and
        enemies at the walls stop work. Full stores waste further gains. Watch the daily balances:
        short gold or food costs men.
      </dd>
      <dt>Wars and peace</dt>
      <dd>
        Wars in the top bar lists your wars and waiting offers. Offer peace as things stand, or with
        gold or cities; it shows what the enemy would accept. Peace sends armies home and starts a
        truce.
      </dd>
      <dt>Pause and speed</dt>
      <dd>
        Space pauses and resumes. The buttons 1, 2, and 3 in the top bar set the speed. Orders given
        while paused wait for the next day. Battles, weak sieges, and the first approaching enemy in
        a war can pause for you; the Game menu changes these stops. An offer of peace pauses for
        your answer.
      </dd>
      <dt>Overview and Chronicle</dt>
      <dd>
        Overview finds your cities and armies. Chronicle, above the news, keeps earlier events;
        click a report to go there. Only forces in sight appear on the map.
      </dd>
      <dt>Stances</dt>
      <dd data-testid="guide-stances">
        An army's panel sets how it fights, and each stance beats one other.
        <ul>
          {#each STANCES as stance (stance)}<li>{stanceMatchText(stance)}</li>{/each}
        </ul>
        {reformCostText()} In a battle the panel says whose stance beats whose, and marks the stance that
        would beat the enemy's.
      </dd>
      <dt>Saving</dt>
      <dd>
        The Game menu in the top bar saves to this browser, loads, and exports or imports a file.
        The game also saves itself each month, and Continue on the start screen loads the latest
        save.
      </dd>
    </dl>
    <label class="fate">
      <input
        type="checkbox"
        checked={frame.pauseOnFate}
        onchange={(event) => actions.setPauseOnFate(event.currentTarget.checked)}
      />
      Pause and ask when a city falls to you
    </label>
    <div class="row end">
      <span class="muted">Enter or Escape closes this. The Guide button opens it again.</span>
      <button type="button" onclick={() => actions.closeModal()}>Close</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(59 42 26 / 18%);
  }

  .guide {
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: 16px 22px 14px;
    background: var(--paper-solid);
  }

  .guide h2 {
    font-size: 22px;
    font-weight: normal;
    font-variant: small-caps;
  }

  .goal {
    margin: 8px 0 2px;
    font-size: 15px;
  }

  dl {
    margin: 10px 0 8px;
  }

  dt {
    margin-top: 8px;
    font-weight: bold;
  }

  dd {
    margin: 1px 0 0;
  }

  .fate {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 6px;
  }

  .end {
    justify-content: space-between;
  }
</style>
