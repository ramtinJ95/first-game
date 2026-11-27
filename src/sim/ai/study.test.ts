import { describe, expect, test } from 'vitest';
import { ADVANCES, ADVANCE_KINDS, GROWING_ADVANCES } from '../advances/advances.ts';
import { buildRefusal } from '../buildings/build.ts';
import { buildFixture, FIXTURE, fixtureWorld, growRome } from '../fixture.ts';
import { afterSpending, heldByFood } from './budget.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import { nextBuilding } from './build.ts';
import {
  advanceWorth,
  savingForFood,
  studies,
  studyPayback,
  STUDY_PAYBACK_YEARS,
} from './study.ts';

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
  test('a realm held by food saves for food up to eight cities, and past them spends as before', () => {
    const held = (cities: number) => {
      const state = buildFixture();
      growRome(state, cities);
      const hastati = state.formations[FIXTURE.hastati];
      if (!hastati) throw new Error('expected the hastati');
      hastati.men = 4750;
      expect(heldByFood(state, FIXTURE.rome)).toBe(true);
      return savingForFood(state, FIXTURE.rome);
    };
    expect(held(8)).toBeGreaterThan(0);
    expect(held(9)).toBeUndefined();
  });

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

  test('no advance slower than the building it would start next, which it reckons whether or not it can pay for it', () => {
    const broke = buildFixture();
    rome(broke).stores.gold = 0;
    const roma = broke.cities[FIXTURE.roma];
    if (!roma) throw new Error('expected Roma');
    expect(buildRefusal(broke, roma, 'forum')).toMatch(/costs/);
    expect(nextBuilding(broke, FIXTURE.rome)?.kind).toBe('forum');

    const state = rich();
    const building = nextBuilding(state, FIXTURE.rome);
    const soonest = Math.min(
      ...ADVANCE_KINDS.flatMap((kind) => studyPayback(state, FIXTURE.rome, kind) ?? []),
    );
    expect(building?.payback).toBeLessThan(soonest);
    expect(studies(state, FIXTURE.rome, false)).toEqual([]);
    expect(studies(busy(state), FIXTURE.rome, false)).toHaveLength(1);
  });

  test("the gold of a study it orders is spent before the day's trade is weighed", () => {
    const state = busy(rich());
    const [order] = studies(state, FIXTURE.rome, false);
    if (order?.kind !== 'study') throw new Error('expected a study');
    const after = afterSpending(state, [order], fixtureWorld());
    expect(rome(state).stores.gold - (after.factions[FIXTURE.rome]?.stores.gold ?? 0)).toBe(
      ADVANCES[order.advance].gold,
    );
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

  test('Long contracts is worth nothing to a Rome whose guards were hired to answer warnings, and it never studies it', () => {
    const state = busy(rich());
    for (const city of Object.values(state.cities))
      if (city.owner === FIXTURE.rome)
        city.guards = [{ until: (state.day + 300) as Day }, { until: (state.day + 320) as Day }];
    expect(advanceWorth(state, FIXTURE.rome, 'longContracts')).toBe(0);
    expect(studyPayback(state, FIXTURE.rome, 'longContracts')).toBeUndefined();
    for (const advance of ADVANCE_KINDS.filter((kind) => kind !== 'longContracts'))
      rome(state).advances.push(advance);
    expect(studies(state, FIXTURE.rome, false)).toEqual([]);
  });
});
