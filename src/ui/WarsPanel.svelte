<script lang="ts">
  import { whole } from '../app/names.ts';
  import { peaceAnswer, termsText, type PeaceAnswer } from '../sim/ai/peace.ts';
  import { GOLD_PER_POINT } from '../sim/peace/terms.ts';
  import type { DeepReadonly } from '../sim/deep-readonly.ts';
  import type { CityId, FactionId } from '../sim/ids.ts';
  import type { Order } from '../sim/orders/orders.ts';
  import type { GameState } from '../sim/state/game-state.ts';
  import type { PeaceTerms } from '../sim/state/peace.ts';
  import type { Actions } from './actions.ts';
  import { warRoomOf, type WarRow } from './war-room.ts';

  let {
    game,
    pending,
    actions,
    prompted,
    answered,
    close,
  }: {
    game: DeepReadonly<GameState>;
    pending: readonly Order[];
    actions: Actions;
    /** The enemy whose offer paused the game and waits for an answer. */
    prompted: FactionId | undefined;
    /** Closes the pause the offer opened, once the player has answered it. */
    answered: () => void;
    close: () => void;
  } = $props();

  type Payer = 'nobody' | 'us' | 'them';

  const room = $derived(warRoomOf(game, pending));
  let open = $state<FactionId | undefined>(undefined);
  let payer = $state<Payer>('nobody');
  let gold = $state(0);
  let cities = $state<CityId[]>([]);

  const shown = $derived(room.wars.find((war) => war.enemy === (prompted ?? open)) ?? room.wars[0]);

  function payerOf(war: WarRow, who: Payer): FactionId | undefined {
    return who === 'us' ? game.player : who === 'them' ? war.enemy : undefined;
  }

  function written(war: WarRow): PeaceTerms {
    const by = payerOf(war, payer);
    if (!by) return { kind: 'asThingsStand' };
    return { kind: 'payment', payer: by, gold: Math.max(0, Math.round(gold || 0)), cities };
  }

  const draft = $derived(shown && written(shown));
  const draftAnswer = $derived(
    shown && draft ? peaceAnswer(game, shown.enemy, game.player, draft) : undefined,
  );
  const payerCities = $derived.by(() => {
    const by = shown && payerOf(shown, payer);
    return by ? Object.values(game.cities).filter((city) => city.owner === by) : [];
  });

  function choose(war: WarRow) {
    open = war.enemy;
    payer = 'nobody';
    gold = 0;
    cities = [];
  }

  function fill(terms: PeaceTerms, war: WarRow) {
    if (terms.kind === 'asThingsStand') {
      payer = 'nobody';
      gold = 0;
      cities = [];
      return;
    }
    payer = terms.payer === war.enemy ? 'them' : 'us';
    gold = terms.gold;
    cities = [...terms.cities];
  }

  function offer(war: WarRow, terms: PeaceTerms) {
    actions.issue({ kind: 'offerPeace', faction: game.player, to: war.enemy, terms });
  }

  function answer(war: WarRow, accept: boolean) {
    actions.issue({
      kind: accept ? 'acceptPeace' : 'refusePeace',
      faction: game.player,
      from: war.enemy,
    });
    if (prompted === war.enemy) answered();
  }

  function points(value: number): string {
    return value > 0 ? `+${value}` : `${value}`;
  }
</script>

{#snippet reckoning(answer: PeaceAnswer)}
  <ul class="factors">
    {#each [...answer.wish.factors, answer.terms] as factor (factor.kind)}
      <li class={factor.points > 0 ? 'good' : factor.points < 0 ? 'bad' : ''}>
        {factor.text} <span class="points">{points(factor.points)}</span>
      </li>
    {/each}
  </ul>
{/snippet}

<section class="panel wars" data-testid="wars-panel" aria-label="Wars and peace">
  <div class="head">
    <h2>Wars and peace</h2>
    <button type="button" class="close" aria-label="Close" onclick={close}>×</button>
  </div>
  {#if prompted && shown?.enemy === prompted}
    <p class="muted" data-testid="peace-paused">The game is paused for your answer.</p>
  {/if}

  {#if room.wars.length === 0}
    <p>You are at war with no one.</p>
  {:else}
    <div class="tabs">
      {#each room.wars as war (war.enemy)}
        <button
          type="button"
          data-testid="war-tab"
          aria-pressed={war.enemy === shown?.enemy}
          onclick={() => choose(war)}>{war.name}</button
        >
      {/each}
    </div>
  {/if}

  {#if shown}
    {@const war = shown}
    <div class="war" data-testid="war-row" data-enemy={war.enemy}>
      <p class={war.standing.score > 0 ? 'good' : war.standing.score < 0 ? 'bad' : ''}>
        <strong>At war with {war.name}.</strong>
        <span data-testid="war-summary">{war.summary}</span>
      </p>
      <ul class="facts">
        {#each war.facts as fact (fact)}<li>{fact}</li>{/each}
      </ul>

      {#if war.theirOffer}
        <div class="offer" data-testid="their-offer">
          <p><strong>{war.theirOffer.text}</strong></p>
          <p class="muted">{war.theirOffer.refusing}</p>
          <div class="row">
            <button type="button" data-testid="accept-peace" onclick={() => answer(war, true)}
              >Accept peace</button
            >
            <button
              type="button"
              class="danger"
              data-testid="refuse-peace"
              onclick={() => answer(war, false)}>Refuse</button
            >
          </div>
        </div>
      {/if}

      {#if war.ourOffer}
        <p class="muted" data-testid="our-offer">{war.ourOffer}</p>
      {/if}

      <h3>Offer peace</h3>
      <ul class="choices">
        {#each war.choices as choice (choice.label)}
          <li data-testid="peace-choice">
            <button type="button" onclick={() => fill(choice.terms, war)}>
              {choice.label}{choice.terms.kind === 'payment'
                ? `: ${termsText(game, choice.terms, game.player)}`
                : ''}
            </button>
            <span class={choice.answer.accepts ? 'good' : 'bad'}>{choice.answer.verdict}</span>
          </li>
        {/each}
      </ul>

      <fieldset class="terms">
        <legend>Your terms</legend>
        <label><input type="radio" bind:group={payer} value="nobody" /> Nothing changes hands</label
        >
        <label><input type="radio" bind:group={payer} value="us" /> You pay {war.name}</label>
        <label><input type="radio" bind:group={payer} value="them" /> {war.name} pays you</label>
        {#if payer !== 'nobody'}
          <label class="gold"
            >Gold <input
              type="number"
              min="0"
              step="50"
              data-testid="peace-gold"
              bind:value={gold}
            /></label
          >
          {#if payerCities.length > 1}
            <div class="cities">
              {#each payerCities as city (city.id)}
                <label
                  ><input
                    type="checkbox"
                    value={city.id}
                    bind:group={cities}
                    data-testid="peace-city"
                  />
                  {city.name}</label
                >
              {/each}
            </div>
          {/if}
        {/if}
      </fieldset>

      {#if draftAnswer && draft}
        <p class={draftAnswer.accepts ? 'good' : 'bad'} data-testid="peace-verdict">
          {draftAnswer.verdict}
        </p>
        {@render reckoning(draftAnswer)}
        <div class="row">
          <button
            type="button"
            data-testid="offer-peace"
            disabled={draftAnswer.problem !== undefined}
            onclick={() => offer(war, draft)}>Offer these terms</button
          >
        </div>
        <p class="muted">
          {war.name} answers with the next day by this same reckoning. A refused offer costs nothing.
        </p>
      {/if}
    </div>
  {/if}

  {#if room.truces.length > 0}
    <h3>Truces</h3>
    <ul class="facts" data-testid="truces">
      {#each room.truces as truce (truce.enemy)}
        <li data-testid="truce-row">{truce.text}</li>
      {/each}
    </ul>
  {/if}
  <p class="muted small">A point of the reckoning is {whole(GOLD_PER_POINT)} gold.</p>
</section>

<style>
  .wars {
    width: 360px;
    max-width: 100%;
    min-height: 0;
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .head {
    justify-content: space-between;
  }

  .close {
    padding: 0 8px;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 6px 0;
  }

  .facts,
  .factors,
  .choices {
    margin: 2px 0;
    padding-left: 1.1em;
  }

  .choices {
    padding-left: 0;
    list-style: none;
  }

  .choices li {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    margin-bottom: 4px;
  }

  .choices button {
    text-align: left;
  }

  .points {
    font-variant-numeric: tabular-nums;
  }

  .offer {
    margin: 6px 0;
    padding: 6px 8px;
    border: 1px solid var(--rule);
    border-radius: 3px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 4px 0;
  }

  .terms {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 6px 0;
    padding: 4px 8px 6px;
    border: 1px solid rgb(122 75 42 / 40%);
    border-radius: 3px;
  }

  .gold input {
    width: 7em;
  }

  .cities {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
  }

  .small {
    font-size: 12px;
  }
</style>
