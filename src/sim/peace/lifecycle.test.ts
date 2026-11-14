import { describe, expect, test } from 'vitest';
import { decideOrders } from '../ai/decide.ts';
import { changeCityOwner } from '../cities.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../fixture.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import { loadGame, saveGame } from '../save.ts';
import type { Day } from '../state/day.ts';
import { warKey } from '../state/war.ts';
import { advanceDay } from '../systems/advance-day.ts';
import { tick } from '../tick.ts';
import { areAtWar } from '../wars.ts';
import { OFFER_DAYS } from './offer.ts';
import { AS_THINGS_STAND } from './terms.ts';

const world = fixtureWorld();
const key = warKey(f.rome, f.carthage);

function warOn(day = 226) {
  const state = buildFixture();
  expect(
    executeOrder(state, { kind: 'declareWar', faction: f.rome, against: f.carthage }, world),
  ).toBeUndefined();
  state.day = day as Day;
  return state;
}

const offer: Order = {
  kind: 'offerPeace',
  faction: f.rome,
  to: f.carthage,
  terms: AS_THINGS_STAND,
};

describe('a peace follows the war, not an old forecast', () => {
  test('a city taken the day of the offer changes the next-day answer, with a durable reason', () => {
    const state = warOn();
    const sent = tick(state, [offer], world, [
      (next) => changeCityOwner(next, f.capua, f.carthage),
      advanceDay,
    ]);
    expect(sent.state.peaceOffers[key]?.forecast?.accepts).toBe(true);
    const loaded = loadGame(saveGame(sent.state));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state.peaceOffers).toEqual(sent.state.peaceOffers);
    const result = tick(
      loaded.state,
      decideOrders(loaded.state, world, f.carthage).slice(0, 1),
      world,
      [advanceDay],
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'peaceRefused',
        reason: expect.stringContaining('1,500 gold more'),
      }),
    );
    const refusal = result.events.find((event) => event.kind === 'peaceRefused');
    expect(refusal?.reason).toContain('The forecast changed: it took Capua');
    expect(refusal?.reason).toContain('its war standing changed from 0 to 15');
    expect(areAtWar(result.state, f.rome, f.carthage)).toBe(true);
    expect(result.state.peaceOffers[key]).toBeUndefined();
    expectConsistent(result.state);
  });

  test('losses in a battle change the forecast and the refusal says what changed', () => {
    const state = warOn();
    const sent = tick(state, [offer], world, [
      (next) => {
        const side = next.wars[key]?.sides[f.rome];
        if (!side) throw new Error('fixture');
        side.lost += 1000;
      },
      advanceDay,
    ]);
    const result = tick(
      sent.state,
      decideOrders(sent.state, world, f.carthage).slice(0, 1),
      world,
      [advanceDay],
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'peaceRefused',
        reason: expect.stringContaining(
          'battle losses changed (it lost 0 more men; you lost 1000 more)',
        ),
      }),
    );
    expectConsistent(result.state);
  });

  test('an AI acceptance is rechecked after earlier orders of its day', () => {
    const state = tick(warOn(), [offer], world, [advanceDay]).state;
    const planned = decideOrders(state, world, f.carthage)[0];
    expect(planned?.kind).toBe('acceptPeace');
    if (!planned) throw new Error('no answer');
    const changed = structuredClone(state);
    changeCityOwner(changed, f.capua, f.carthage);
    const result = tick(changed, [planned], world, [advanceDay]);
    expect(result.rejected).toEqual([]);
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'peaceRefused',
        reason: expect.stringContaining('it took Capua'),
      }),
    );
    expect(areAtWar(result.state, f.rome, f.carthage)).toBe(true);
    expectConsistent(result.state);
  });

  test('an AI refusal is rechecked too: a city won back can turn it into peace', () => {
    const state = warOn();
    changeCityOwner(state, f.capua, f.carthage);
    const sent = tick(state, [offer], world, [advanceDay]).state;
    const planned = decideOrders(sent, world, f.carthage)[0];
    expect(planned?.kind).toBe('refusePeace');
    if (!planned) throw new Error('no answer');
    const changed = structuredClone(sent);
    changeCityOwner(changed, f.capua, f.rome);
    const result = tick(changed, [planned], world, [advanceDay]);
    expect(result.events.some((event) => event.kind === 'peaceMade')).toBe(true);
    expect(areAtWar(result.state, f.rome, f.carthage)).toBe(false);
    expectConsistent(result.state);
  });

  test('an offered city taken the same day is not handed over or charged again', () => {
    const state = warOn();
    const sent = tick(
      state,
      [{ ...offer, terms: { kind: 'payment', payer: f.rome, gold: 500, cities: [f.capua] } }],
      world,
      [(next) => changeCityOwner(next, f.capua, f.carthage), advanceDay],
    );
    const gold = sent.state.factions[f.rome]?.stores.gold;
    const result = tick(
      sent.state,
      decideOrders(sent.state, world, f.carthage).slice(0, 1),
      world,
      [advanceDay],
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'peaceRefused',
        reason: expect.stringContaining('does not hold'),
      }),
    );
    expect(result.state.cities[f.capua]?.owner).toBe(f.carthage);
    expect(result.state.factions[f.rome]?.stores.gold).toBe(gold);
    expectConsistent(result.state);
  });

  test('two offers to one enemy on one day keep the first and explicitly reject the second', () => {
    const result = tick(
      warOn(),
      [offer, { ...offer, terms: { kind: 'payment', payer: f.rome, gold: 500, cities: [] } }],
      world,
      [advanceDay],
    );
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('already made today');
    expect(result.state.peaceOffers[key]?.terms).toEqual(AS_THINGS_STAND);
    expect(result.events.filter((event) => event.kind === 'peaceOffered')).toHaveLength(1);
    expectConsistent(result.state);
  });

  test('the destruction of the recipient ends its pending offer visibly, without payment', () => {
    const state = buildFixture();
    expect(
      executeOrder(
        state,
        { kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction },
        world,
      ),
    ).toBeUndefined();
    const result = tick(state, [{ ...offer, to: f.syracusaeFaction }], world, [
      (next) => changeCityOwner(next, f.syracusae, f.rome),
      advanceDay,
    ]);
    expect(result.state.peaceOffers[warKey(f.rome, f.syracusaeFaction)]).toBeUndefined();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'peaceOfferEnded',
        reason: expect.stringContaining('has fallen; its wars and offers end without a payment'),
      }),
    );
    expectConsistent(result.state);
  });

  test('an unanswered offer expires with news rather than silently disappearing', () => {
    const state = warOn();
    expect(executeOrder(state, offer, world)).toBeUndefined();
    state.day = (state.day + OFFER_DAYS - 1) as Day;
    const result = tick(state, [], world, [advanceDay]);
    expect(result.state.peaceOffers[key]).toBeUndefined();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: 'peaceOfferEnded',
        reason: expect.stringContaining('expired after 30 days'),
      }),
    );
    expectConsistent(result.state);
  });
});
