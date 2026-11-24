import { describe, expect, test } from 'vitest';
import { ADVANCES, ADVANCE_KINDS, GROWING_ADVANCES } from '../advances/advances.ts';
import { buildFixture, FIXTURE, growRome } from '../fixture.ts';
import type { GameState } from '../state/game-state.ts';
import { BUILDINGS } from '../buildings/buildings.ts';
import { nextBuilding } from './build.ts';
import { reserveOf } from './situation.ts';
import { advanceWorth, studies, studyPayback, STUDY_PAYBACK_YEARS } from './study.ts';

function rome(state: GameState) {
  const record = state.factions[FIXTURE.rome];
  if (!record) throw new Error('expected Rome');
  return record;
}

/** Every city of Rome's has a building at work, so it would start none. */
function busy(state: GameState): GameState {
  for (const city of Object.values(state.cities))
    if (city.owner === FIXTURE.rome) city.construction = { building: 'temple', daysLeft: 300 };
  return state;
}

function rich(): GameState {
  const state = buildFixture();
  rome(state).stores.gold = 50_000;
  return state;
}

describe('the AI studies', () => {
  test('the advance that pays back soonest in its realm, within the years it allows, when no building would start', () => {
    const state = busy(rich());
    const [order] = studies(state, FIXTURE.rome, false);
    if (order?.kind !== 'study') throw new Error('expected a study');
    const paybacks = ADVANCE_KINDS.flatMap((kind) => studyPayback(state, FIXTURE.rome, kind) ?? []);
    expect(studyPayback(state, FIXTURE.rome, order.advance)).toBe(Math.min(...paybacks));
    expect(studyPayback(state, FIXTURE.rome, order.advance)).toBeLessThanOrEqual(
      STUDY_PAYBACK_YEARS,
    );
  });

  test('no advance slower than the building it would start next, whether or not it can pay for that building', () => {
    for (const gold of [50_000, BUILDINGS.forum.gold - 1]) {
      const state = buildFixture();
      rome(state).stores.gold = gold + reserveOf(state, FIXTURE.rome, 'gold') + 2_000;
      const building = nextBuilding(state, FIXTURE.rome);
      if (!building) throw new Error('expected a building');
      const soonest = Math.min(
        ...ADVANCE_KINDS.flatMap((kind) => studyPayback(state, FIXTURE.rome, kind) ?? []),
      );
      expect(building.payback).toBeLessThan(soonest);
      expect(studies(state, FIXTURE.rome, false)).toEqual([]);
      expect(studies(busy(state), FIXTURE.rome, false)).toHaveLength(1);
    }
  });

  test('nothing that pays nothing: no route, no Market weights; no band, no Long contracts', () => {
    const state = rich();
    expect(studyPayback(state, FIXTURE.rome, 'marketWeights')).toBeUndefined();
    expect(studyPayback(state, FIXTURE.rome, 'longContracts')).toBeUndefined();
  });

  test('nothing while it studies, on a day it recruits or builds, or without the gold', () => {
    const studying = rich();
    rome(studying).study = { advance: 'clemency', daysLeft: 9, paid: 1500 };
    expect(studies(studying, FIXTURE.rome, false)).toEqual([]);
    expect(studies(rich(), FIXTURE.rome, true)).toEqual([]);
    const poor = buildFixture();
    rome(poor).stores.gold = Math.min(...ADVANCE_KINDS.map((k) => ADVANCES[k].gold)) - 1;
    expect(studies(poor, FIXTURE.rome, false)).toEqual([]);
  });

  test('a minor city studies nothing', () => {
    const state = rich();
    const minor = state.factions[FIXTURE.syracusaeFaction];
    if (!minor) throw new Error('expected the minor');
    minor.stores.gold = 50_000;
    expect(studies(state, FIXTURE.syracusaeFaction, false)).toEqual([]);
  });

  test('its payback counts the price its realm pays: twice the listed gold at 16 cities', () => {
    const small = rich();
    const large = rich();
    growRome(large, 16);
    for (const kind of ['standardCoin', 'citizenRolls'] as const) {
      const years = (state: GameState) => studyPayback(state, FIXTURE.rome, kind) ?? Infinity;
      const worth = (state: GameState) => advanceWorth(state, FIXTURE.rome, kind);
      expect(years(small) * worth(small) * 365).toBeCloseTo(ADVANCES[kind].gold, 6);
      expect(years(large) * worth(large) * 365).toBeCloseTo(2 * ADVANCES[kind].gold, 6);
    }
  });

  test('a large realm whose gold covers the listed price but not its own studies none of the four', () => {
    const state = buildFixture();
    growRome(state, 16);
    rome(state).stores.gold = 9_000;
    const [order] = studies(state, FIXTURE.rome, false);
    if (order?.kind === 'study') expect(GROWING_ADVANCES).not.toContain(order.advance);
  });
});
