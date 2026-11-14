import { describe, expect, it } from 'vitest';
import type { CityId, FactionId } from '../sim/ids.ts';
import type { Day } from '../sim/state/day.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import { expectConsistent } from '../sim/references.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { enqueue, keepOpen, unansweredOffer, type Modal } from './modals.ts';

const fate = (city: string): Modal => ({ kind: 'fate', city: city as CityId });
const won: Modal = { kind: 'won', on: 5 as Day };
const guide: Modal = { kind: 'guide' };
const lost: Modal = {
  kind: 'lost',
  on: 9 as Day,
  city: 'roma' as CityId,
  by: 'carthage' as FactionId,
};

describe('the modal queue', () => {
  it('puts the win before the fates and the fates before the guide, each once', () => {
    let queue: Modal[] = [guide];
    for (const modal of [fate('capua'), won, fate('capua'), fate('roma'), guide]) {
      queue = enqueue(queue, modal);
    }
    expect(queue).toEqual([won, fate('capua'), fate('roma'), guide]);
  });

  it('lets a loss or the start screen replace everything that waits', () => {
    expect(enqueue([won, fate('capua'), guide], lost)).toEqual([lost]);
    expect(enqueue([lost], { kind: 'start' })).toEqual([{ kind: 'start' }]);
  });

  it('drops a fate whose city is no longer open', () => {
    const open = (city: CityId) => city === 'roma';
    expect(keepOpen([won, fate('capua'), fate('roma')], open)).toEqual([won, fate('roma')]);
  });
});

describe('an offer that waits for the player', () => {
  function offered() {
    const state = buildFixture();
    state.day = 100 as Day;
    state.wars[warKey(f.rome, f.carthage)] = newWar(f.carthage, f.rome, 0 as Day);
    const order: Order = {
      kind: 'offerPeace',
      faction: f.carthage,
      to: f.rome,
      terms: { kind: 'asThingsStand' },
    };
    expect(executeOrder(state, order, fixtureWorld())).toBeUndefined();
    expectConsistent(state);
    return state;
  }

  it('names the enemy until the player queues an answer or a counter-offer', () => {
    const state = offered();
    expect(unansweredOffer(state, [])).toBe(f.carthage);
    const answers: Order[] = [
      { kind: 'refusePeace', faction: f.rome, from: f.carthage },
      { kind: 'acceptPeace', faction: f.rome, from: f.carthage, terms: { kind: 'asThingsStand' } },
      {
        kind: 'offerPeace',
        faction: f.rome,
        to: f.carthage,
        terms: { kind: 'payment', payer: f.rome, gold: 100, cities: [] },
      },
    ];
    for (const answer of answers) expect(unansweredOffer(state, [answer])).toBeUndefined();
  });

  it("names no one when the only offer is the player's own", () => {
    const state = buildFixture();
    state.day = 100 as Day;
    state.wars[warKey(f.rome, f.carthage)] = newWar(f.carthage, f.rome, 0 as Day);
    const order: Order = {
      kind: 'offerPeace',
      faction: f.rome,
      to: f.carthage,
      terms: { kind: 'asThingsStand' },
    };
    expect(executeOrder(state, order, fixtureWorld())).toBeUndefined();
    expect(unansweredOffer(state, [])).toBeUndefined();
    expectConsistent(state);
  });
});
