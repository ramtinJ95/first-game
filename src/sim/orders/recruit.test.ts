import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { CityId, FactionId } from '../ids.ts';
import { POWERS } from '../map.ts';
import { expectConsistent } from '../references.ts';
import { troopsFor, type Troop } from '../troops.ts';
import { executeOrder, type Order } from './orders.ts';

const world = fixtureWorld();

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
      name: "for another power's own troop",
      setup: () => {},
      order: order({ troop: 'warElephants' }),
      reason: 'only carthage raises warElephants',
    },
    {
      name: "for a conquered city's power's own troop",
      setup: (state: ReturnType<typeof buildFixture>) => {
        changeCityOwner(state, FIXTURE.carthago, FIXTURE.rome);
        const carthago = state.cities[FIXTURE.carthago];
        if (carthago) carthago.unrestDays = 0;
      },
      order: order({ city: FIXTURE.carthago, troop: 'numidianHorse' }),
      reason: 'only carthage raises numidianHorse',
    },
    {
      name: 'for a troop that does not exist',
      setup: () => {},
      order: order({ troop: 'oliphaunts' as Troop }),
      reason: 'troop oliphaunts does not exist',
    },
  ])('$name', ({ setup, order, reason }) => {
    const state = buildFixture();
    setup(state);
    const before = structuredClone(state);
    expect(executeOrder(state, order, world)).toEqual({ order, reason });
    expect(state).toEqual(before);
    expectConsistent(state);
  });
});

test('recruit takes gold and manpower at once and queues the formation', () => {
  const state = buildFixture();
  expect(executeOrder(state, order({ troop: 'swordsmen' }), world)).toBeUndefined();
  expect(state.factions[FIXTURE.rome]?.stores).toEqual({ gold: 1800, food: 1000, manpower: 1000 });
  expect(state.cities[FIXTURE.roma]?.recruits).toEqual([{ troop: 'swordsmen', readyOn: 21 }]);
  expectConsistent(state);
});

test.each([
  { faction: FIXTURE.rome, city: FIXTURE.roma, troop: 'legionaries' },
  { faction: FIXTURE.rome, city: FIXTURE.roma, troop: 'triarii' },
  { faction: FIXTURE.carthage, city: FIXTURE.carthago, troop: 'warElephants' },
  { faction: FIXTURE.carthage, city: FIXTURE.carthago, troop: 'numidianHorse' },
] as const)('$faction raises its own $troop', ({ faction, city, troop }) => {
  const state = buildFixture();
  const stores = state.factions[faction]?.stores;
  if (stores) stores.gold = 10_000;
  expect(executeOrder(state, order({ faction, city, troop }), world)).toBeUndefined();
  expect(state.cities[city]?.recruits.map((r) => r.troop)).toEqual([troop]);
  expectConsistent(state);
});

test('each great power may raise the six shared troops and its own two, and no other', () => {
  const raised = Object.fromEntries(POWERS.map((power) => [power, troopsFor(power as FactionId)]));
  const shared = [
    'spearmen',
    'swordsmen',
    'skirmishers',
    'archers',
    'lightCavalry',
    'heavyCavalry',
  ];
  expect(raised).toEqual({
    rome: [...shared, 'legionaries', 'triarii'],
    carthage: [...shared, 'warElephants', 'numidianHorse'],
    macedon: [...shared, 'phalangites', 'companionCavalry'],
    egypt: [...shared, 'nileArchers', 'chariots'],
    persia: [...shared, 'cataphracts', 'horseArchers'],
  });
  expect(troopsFor(FIXTURE.syracusaeFaction)).toEqual(shared);
});
