import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../cities.ts';
import { buildFixture, FIXTURE } from '../fixture.ts';
import type { CityId } from '../ids.ts';
import { expectConsistent } from '../references.ts';
import type { Troop } from '../troops.ts';
import { executeOrder, type Order } from './orders.ts';

const order = (changes: Partial<Extract<Order, { kind: 'recruit' }>> = {}): Order => ({
  kind: 'recruit',
  faction: FIXTURE.rome,
  city: FIXTURE.roma,
  troop: 'spearmen',
  ...changes,
});

describe('recruit is rejected and changes nothing', () => {
  test.each([
    {
      name: 'when gold is short',
      setup: (state: ReturnType<typeof buildFixture>) => {
        const rome = state.factions[FIXTURE.rome];
        if (rome) rome.stores.gold = 2399.5;
      },
      order: order(),
      reason: 'spearmen cost 2400 gold, but rome has 2399',
    },
    {
      name: 'when manpower is short',
      setup: (state: ReturnType<typeof buildFixture>) => {
        const rome = state.factions[FIXTURE.rome];
        if (rome) rome.stores.manpower = 399;
      },
      order: order({ troop: 'lightCavalry' }),
      reason: 'lightCavalry need 400 manpower, but rome has 399',
    },
    {
      name: 'at a city of another faction',
      setup: () => {},
      order: order({ city: FIXTURE.carthago }),
      reason: 'city carthago belongs to carthage, not rome',
    },
    {
      name: 'at a city in unrest',
      setup: (state: ReturnType<typeof buildFixture>) =>
        changeCityOwner(state, FIXTURE.carthago, FIXTURE.rome),
      order: order({ city: FIXTURE.carthago }),
      reason: 'city carthago is in unrest for 90 more days',
    },
    {
      name: 'at a city that does not exist',
      setup: () => {},
      order: order({ city: 'atlantis' as CityId }),
      reason: 'city atlantis does not exist',
    },
    {
      name: 'for a troop that does not exist',
      setup: () => {},
      order: order({ troop: 'elephants' as Troop }),
      reason: 'troop elephants does not exist',
    },
  ])('$name', ({ setup, order, reason }) => {
    const state = buildFixture();
    setup(state);
    const before = structuredClone(state);
    expect(executeOrder(state, order)).toEqual({ order, reason });
    expect(state).toEqual(before);
    expectConsistent(state);
  });
});

test('recruit takes gold and manpower at once and queues the formation', () => {
  const state = buildFixture();
  expect(executeOrder(state, order({ troop: 'swordsmen' }))).toBeUndefined();
  expect(state.factions[FIXTURE.rome]?.stores).toEqual({ gold: 1800, food: 1000, manpower: 1000 });
  expect(state.cities[FIXTURE.roma]?.recruits).toEqual([{ troop: 'swordsmen', readyOn: 21 }]);
  expectConsistent(state);
});
