<script lang="ts">
  import { PAUSE_KINDS } from '../app/alerts.ts';
  import { factionName } from '../app/names.ts';
  import { FATE_PAUSE_LABEL, OFFER_PAUSE_TEXT, PAUSE_LABELS } from '../app/pauses.ts';
  import type { Frame } from '../app/view.svelte.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import { STANCES } from '../sim/state/army.ts';
  import { reformCostText, stanceMatchText } from './describe.ts';
  import type { FrameActions } from './frame-actions.ts';
  import { PEACE_TEXT } from './war-room.ts';
  import { STAYING_TEXT } from '../app/threat-news.ts';
  import type { FactionId } from '../sim/ids.ts';
  import { POWERS } from '../sim/map.ts';
  import { bonusText, ownBuildingText } from './signature-text.ts';

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
        shore. Your army panel's Join section combines nearby idle armies of yours; they stay
        separate until you join them.
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
      <dt>The great powers</dt>
      <dd data-testid="guide-signatures">
        Each great power has one building of its own and one standing bonus. A conqueror keeps
        another power's building where it stands, but cannot build it or gain the bonus.
        <ul>
          {#each POWERS as power (power)}
            <li>
              <strong>{factionName(game, power as string as FactionId)}</strong>. {ownBuildingText(
                power,
              )}
              {bonusText(power)}
            </li>
          {/each}
        </ul>
      </dd>
      <dt>Trade</dt>
      <dd data-testid="guide-trade">
        Your city's Trade section opens routes. A city has one route slot; 25,000 people, a Forum
        and a port each add one. A route costs gold once, and each arrival pays both ends, more for
        unlike goods. The other city must agree: at peace, with a free slot. War between the two
        ends closes a route, and so does the fall of either city, unless the other end is yours and
        the taker is at peace with you. A siege of either end stops deliveries, and an army at war
        with either end takes a road's cargo, even one at peace with you. Select a city to trace its
        routes on the map; zoom in to see each city's good and the merchants on the road and at sea.
      </dd>
      <dt>Wars and peace</dt>
      <dd data-testid="guide-wars">
        {PEACE_TEXT.start} Wars in the top bar lists your wars and waiting offers. Offer peace as things
        stand, or with gold or cities; it shows what the enemy would accept, and when it would take less
        than it asks. {PEACE_TEXT.end} Peace sends armies home. While you hold no more cities than at
        the start, each great power needs less of the strength to declare war on you: {STAYING_TEXT}.
        Holding more cities than at the start ends it.
      </dd>
      <dt>Pause and speed</dt>
      <dd data-testid="guide-pauses">
        Space pauses and resumes. The buttons 1, 2, and 3 in the top bar set the speed. Orders given
        while paused wait for the next day. The game pauses for you when:
        <ul>
          {#each PAUSE_KINDS as kind (kind)}<li>{PAUSE_LABELS[kind]}</li>{/each}
          <li>{FATE_PAUSE_LABEL}</li>
        </ul>
        The Game menu turns each of these on or off under Pause the game when. {OFFER_PAUSE_TEXT}
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
        {reformCostText(game.player)} In a battle the panel says whose stance beats whose, and marks the
        stance that would beat the enemy's.
      </dd>
      <dt>Saving</dt>
      <dd>
        The Game menu in the top bar saves to this browser, loads, and exports or imports a file.
        The game also saves itself each month, and Continue on the start screen loads the latest
        save.
      </dd>
    </dl>
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

  .end {
    justify-content: space-between;
  }
</style>
