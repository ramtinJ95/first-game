import { expect, test } from 'vitest';
import { changeCityOwner, UNREST_DAYS } from './cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from './fixture.ts';
import { expectConsistent } from './references.ts';
import { dailyBalances, OUTPUT_PER_PERSON } from './systems/economy.ts';
import { executeOrder } from './orders/orders.ts';
import { tick } from './tick.ts';
import type { GameState } from './state/game-state.ts';

const world = fixtureWorld();

function play(state: GameState, days: number): GameState {
  for (let day = 0; day < days; day += 1) state = tick(state, [], world).state;
  return state;
}

test('a city that changes owner loses the old owner recruits and pays off as its unrest fades', () => {
  let state = tick(
    buildFixture(),
    [{ kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.capua, troop: 'spearmen' }],
    world,
  ).state;
  const romanGold = state.factions[FIXTURE.rome]?.stores.gold;

  changeCityOwner(state, FIXTURE.capua, FIXTURE.carthage);
  expect(state.cities[FIXTURE.capua]).toMatchObject({
    owner: FIXTURE.carthage,
    unrestDays: UNREST_DAYS,
    recruits: [],
  });
  expect(state.factions[FIXTURE.rome]?.stores.gold).toBe(romanGold);
  expectConsistent(state);

  const capua = state.cities[FIXTURE.capua]?.population ?? 0;
  const carthaginian = () => dailyBalances(state).get(FIXTURE.carthage)?.gold ?? 0;
  const withoutCapua =
    (state.cities[FIXTURE.carthago]?.population ?? 0) * OUTPUT_PER_PERSON.gold - 15;
  expect(carthaginian()).toBeCloseTo(withoutCapua + capua * OUTPUT_PER_PERSON.gold * 0.25, 9);

  state = play(state, UNREST_DAYS / 2);
  expect(state.cities[FIXTURE.capua]?.unrestDays).toBe(UNREST_DAYS / 2);
  state = play(state, UNREST_DAYS / 2);
  expect(state.cities[FIXTURE.capua]?.unrestDays).toBe(0);
  expect(play(state, 1).cities[FIXTURE.capua]?.unrestDays).toBe(0);

  const carthago = state.cities[FIXTURE.carthago]?.population ?? 0;
  const now = state.cities[FIXTURE.capua]?.population ?? 0;
  expect(carthaginian()).toBeCloseTo((carthago + now) * OUTPUT_PER_PERSON.gold - 15, 9);
  expect(
    tick(
      state,
      [{ kind: 'recruit', faction: FIXTURE.carthage, city: FIXTURE.capua, troop: 'spearmen' }],
      world,
    ).rejected,
  ).toEqual([]);
  expectConsistent(state);
});

test('an occupied city out-earns a sacked one in gold within 300 days, and a city lost after 90 days is worth more sacked', () => {
  const world = fixtureWorld();
  const fallen = (fate: 'occupy' | 'sack') => {
    const state = buildFixture();
    changeCityOwner(state, FIXTURE.syracusae, FIXTURE.rome);
    const city = state.cities[FIXTURE.syracusae];
    const army = state.armies[FIXTURE.romanArmy];
    if (!city || !army) throw new Error('the fixture has changed');
    city.fellOn = state.day;
    army.activity = { kind: 'idle', position: { ...city.position } };
    const before = state.factions[FIXTURE.rome]?.stores.gold ?? 0;
    if (fate === 'sack') {
      expect(
        executeOrder(state, { kind: 'sack', faction: FIXTURE.rome, city: city.id }, world),
      ).toBeUndefined();
    }
    return { state, lump: (state.factions[FIXTURE.rome]?.stores.gold ?? 0) - before };
  };
  const earned = (fate: 'occupy' | 'sack', days: number) => {
    let { state, lump: gold } = fallen(fate);
    for (let day = 0; day < days; day++) {
      gold += dailyBalances(state).get(FIXTURE.rome)?.gold ?? 0;
      state = tick(state, [], world).state;
    }
    expectConsistent(state);
    return gold;
  };
  expect(earned('occupy', 300)).toBeGreaterThan(earned('sack', 300));
  expect(earned('sack', 90)).toBeGreaterThan(earned('occupy', 90));
});
