import { expect, test } from 'vitest';
import { changeCityOwner, UNREST_DAYS } from './cities.ts';
import { buildFixture, FIXTURE } from './fixture.ts';
import { expectConsistent } from './references.ts';
import { dailyBalances } from './systems/economy.ts';
import { tick } from './tick.ts';
import type { GameState } from './state/game-state.ts';

function play(state: GameState, days: number): GameState {
  for (let day = 0; day < days; day += 1) state = tick(state, []).state;
  return state;
}

test('a city that changes owner loses the old owner recruits and pays off as its unrest fades', () => {
  let state = tick(buildFixture(), [
    { kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.capua, troop: 'spearmen' },
  ]).state;
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
  const withoutCapua = (state.cities[FIXTURE.carthago]?.population ?? 0) * 0.00035 - 15;
  expect(carthaginian()).toBeCloseTo(withoutCapua + capua * 0.00035 * 0.25, 9);

  state = play(state, UNREST_DAYS / 2);
  expect(state.cities[FIXTURE.capua]?.unrestDays).toBe(UNREST_DAYS / 2);
  state = play(state, UNREST_DAYS / 2);
  expect(state.cities[FIXTURE.capua]?.unrestDays).toBe(0);
  expect(play(state, 1).cities[FIXTURE.capua]?.unrestDays).toBe(0);

  const carthago = state.cities[FIXTURE.carthago]?.population ?? 0;
  const now = state.cities[FIXTURE.capua]?.population ?? 0;
  expect(carthaginian()).toBeCloseTo((carthago + now) * 0.00035 - 15, 9);
  expect(
    tick(state, [
      { kind: 'recruit', faction: FIXTURE.carthage, city: FIXTURE.capua, troop: 'spearmen' },
    ]).rejected,
  ).toEqual([]);
  expectConsistent(state);
});
