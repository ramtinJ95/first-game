import { describe, expect, test } from 'vitest';
import { leaveSiege } from './armies.ts';
import { changeCityOwner } from './cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from './fixture.ts';
import {
  GUARD_BAND,
  GUARD_DAYS,
  GUARD_DETER_DAYS,
  GUARD_GOLD,
  guardMen,
  guardRefusal,
  weighedGarrison,
} from './guards.ts';
import type { CityId } from './ids.ts';
import { executeOrder, type Order } from './orders/orders.ts';
import { expectConsistent } from './references.ts';
import { loadGame, SAVE_FORMAT, saveGame } from './save.ts';
import type { GameState } from './state/game-state.ts';
import type { Day } from './state/day.ts';
import {
  CITY_DEFENCES,
  fullDefences,
  HUNGER_SHARE,
  OCCUPATION_SHARE,
  RECOVERY_DAYS,
} from './systems/sieges.ts';
import { tick } from './tick.ts';

const world = fixtureWorld();
const NEAR_CAPUA = { x: 2641.8, y: 2448.3 };

function need<T>(value: T | undefined, what = 'a record'): T {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const hire = (city: CityId = FIXTURE.roma): Order => ({
  kind: 'hireGuards',
  faction: FIXTURE.rome,
  city,
});

function withGold(gold: number): GameState {
  const state = buildFixture();
  need(state.factions[FIXTURE.rome]).stores.gold = gold;
  return state;
}

const gold = (state: GameState) => need(state.factions[FIXTURE.rome]).stores.gold;
const city = (state: GameState, id: CityId = FIXTURE.roma) => need(state.cities[id]);
/** `men` of guards in bands that serve long past the test. */
const bands = (men: number) =>
  Array.from({ length: men / GUARD_BAND }, () => ({ until: 1000 as Day }));

/** Carthage at war with Rome and its army, of 5,000 men, idle beside Capua, so it besieges Capua tomorrow. */
function capuaBeleaguered(state: GameState): GameState {
  expect(
    executeOrder(
      state,
      { kind: 'declareWar', faction: FIXTURE.carthage, against: FIXTURE.rome },
      world,
    ),
  ).toBeUndefined();
  need(state.armies[FIXTURE.punicArmy]).activity = { kind: 'idle', position: NEAR_CAPUA };
  need(state.armies[FIXTURE.romanArmy]).activity = { kind: 'idle', position: { x: 0, y: 0 } };
  need(state.formations[FIXTURE.citizenSpears]).men = 5000;
  return state;
}

describe('hiring guards', () => {
  test('pays the gold and raises the garrison and the full garrison at once, for a year', () => {
    let state = withGold(5000);
    expect(executeOrder(state, hire(), world)).toBeUndefined();
    const full = CITY_DEFENCES.capital.garrison;
    expect(gold(state)).toBe(5000 - GUARD_GOLD);
    expect(city(state).guards).toEqual([{ until: state.day + GUARD_DAYS }]);
    expect(guardMen(city(state))).toBe(GUARD_BAND);
    expect(city(state).garrison).toBe(full + GUARD_BAND);
    expect(fullDefences(city(state)).garrison).toBe(full + GUARD_BAND);
    state = tick(state, [], world).state;
    expect(city(state).garrison).toBe(full + GUARD_BAND);
    expectConsistent(state);
  });

  test('a capital holds at most its full garrison of guards, and a great power city half that', () => {
    const state = withGold(50_000);
    city(state).guards = bands(CITY_DEFENCES.capital.garrison - GUARD_BAND);
    expect(executeOrder(state, hire(), world)).toBeUndefined();
    expect(executeOrder(state, hire(), world)?.reason).toBe(
      'roma holds 3000 guards, and 3000 is the most it can',
    );
    city(state, FIXTURE.capua).guards = bands(1000);
    expect(executeOrder(state, hire(FIXTURE.capua), world)).toBeUndefined();
    expect(guardRefusal(state, city(state, FIXTURE.capua), FIXTURE.rome)).toBe(
      'capua holds 1500 guards, and 1500 is the most it can',
    );
    expectConsistent(state);
  });

  test('a full city takes a new band in the place of its oldest band that no great power still counts', () => {
    const state = withGold(50_000);
    const capua = city(state, FIXTURE.capua);
    const hiredOn = (day: number) => ({ until: (day + GUARD_DAYS) as Day });
    const stale = hiredOn(state.day - GUARD_DETER_DAYS - 10);
    const older = hiredOn(state.day - GUARD_DETER_DAYS - 20);
    const counted = hiredOn(state.day - 10);
    capua.guards = [stale, older, counted];
    const garrison = capua.garrison;
    expect(weighedGarrison(capua, state.day)).toBe(garrison - 2 * GUARD_BAND);
    expect(executeOrder(state, hire(FIXTURE.capua), world)).toBeUndefined();
    expect(gold(state)).toBe(50_000 - GUARD_GOLD);
    expect(capua.guards).toEqual([stale, counted, hiredOn(state.day)]);
    expect(capua.garrison).toBe(garrison);
    expect(weighedGarrison(capua, state.day)).toBe(garrison - GUARD_BAND);
    expect(executeOrder(state, hire(FIXTURE.capua), world)).toBeUndefined();
    expect(weighedGarrison(capua, state.day)).toBe(garrison);
    expect(guardRefusal(state, capua, FIXTURE.rome)).toBe(
      'capua holds 1500 guards, and 1500 is the most it can',
    );
    expectConsistent(state);
  });

  test('is refused in a city the faction does not own, in unrest, or with an enemy at its walls', () => {
    const state = withGold(50_000);
    expect(guardRefusal(state, city(state, FIXTURE.carthago), FIXTURE.rome)).toBe(
      'carthago belongs to carthage, not rome',
    );
    expect(executeOrder(state, hire(FIXTURE.carthago), world)?.reason).toBe(
      'city carthago belongs to carthage, not rome',
    );
    city(state).unrestDays = 12;
    expect(executeOrder(state, hire(), world)?.reason).toBe('roma is in unrest for 12 more days');
    capuaBeleaguered(state);
    expect(executeOrder(state, hire(FIXTURE.capua), world)?.reason).toBe(
      'an enemy stands at the walls of capua',
    );
    expect(gold(state)).toBe(50_000);
    expect(city(state, FIXTURE.capua).guards).toEqual([]);
    expectConsistent(state);
  });

  test('is refused with less gold than a band costs', () => {
    const state = withGold(GUARD_GOLD - 1);
    expect(executeOrder(state, hire(), world)?.reason).toBe(
      '500 guards cost 2000 gold, but rome has 1999',
    );
    expect(city(state).guards).toEqual([]);
    expectConsistent(state);
  });
});

describe('the term of guards', () => {
  test('a band serves its year and leaves on its day, and the garrison falls with it', () => {
    let state = withGold(5000);
    executeOrder(state, hire(), world);
    const full = CITY_DEFENCES.capital.garrison;
    const leaves = state.day + GUARD_DAYS;
    while (state.day < leaves) state = tick(state, [], world).state;
    expect(city(state).garrison).toBe(full + GUARD_BAND);
    state = tick(state, [], world).state;
    expect(city(state).guards).toEqual([]);
    expect(city(state).garrison).toBe(full);
    expect(fullDefences(city(state)).garrison).toBe(full);
    expectConsistent(state);
  });
});

describe('guards and war', () => {
  test('a city that changes owner keeps none of its guards', () => {
    const state = withGold(5000);
    executeOrder(state, hire(FIXTURE.capua), world);
    changeCityOwner(state, FIXTURE.capua, FIXTURE.carthage);
    expect(city(state, FIXTURE.capua).guards).toEqual([]);
    expect(fullDefences(city(state, FIXTURE.capua)).garrison).toBe(
      CITY_DEFENCES.greatPowerCity.garrison,
    );
    expectConsistent(state);
  });

  test('a city taken by siege keeps no guards, and its conquerors leave a share of the garrison without them', () => {
    let state = withGold(5000);
    executeOrder(state, hire(FIXTURE.capua), world);
    capuaBeleaguered(state);
    city(state, FIXTURE.capua).foodDays = 0;
    city(state, FIXTURE.capua).garrison = 1;
    state = tick(state, [], world).state;
    expect(city(state, FIXTURE.capua)).toMatchObject({
      owner: FIXTURE.carthage,
      guards: [],
      garrison:
        Math.round(CITY_DEFENCES.greatPowerCity.garrison * OCCUPATION_SHARE) +
        Math.ceil(CITY_DEFENCES.greatPowerCity.garrison / RECOVERY_DAYS),
    });
    expectConsistent(state);
  });

  test('a siege wears the guards down with the garrison, and the city regains them once it ends', () => {
    let state = withGold(5000);
    executeOrder(state, hire(FIXTURE.capua), world);
    capuaBeleaguered(state);
    city(state, FIXTURE.capua).foodDays = 0;
    const full = CITY_DEFENCES.greatPowerCity.garrison + GUARD_BAND;
    const hunger = Math.ceil(full * HUNGER_SHARE);
    for (let day = 0; day < 3; day++) state = tick(state, [], world).state;
    expect(city(state, FIXTURE.capua).garrison).toBe(full - 3 * hunger);

    leaveSiege(state, need(state.armies[FIXTURE.punicArmy]));
    need(state.armies[FIXTURE.punicArmy]).activity = { kind: 'idle', position: { x: 0, y: 0 } };
    const days = Math.ceil((3 * hunger) / Math.ceil(full / RECOVERY_DAYS));
    for (let day = 0; day < days + 1; day++) state = tick(state, [], world).state;
    expect(state.sieges).toEqual({});
    expect(guardMen(city(state, FIXTURE.capua))).toBe(GUARD_BAND);
    expect(city(state, FIXTURE.capua).garrison).toBe(full);
    expectConsistent(state);
  });
});

test('a city with guards survives save and load, under the registered save change', () => {
  expect(SAVE_FORMAT).toContain('city-guards');
  const state = withGold(5000);
  executeOrder(state, hire(), world);
  expect(loadGame(saveGame(state))).toEqual({ ok: true, state });
  expectConsistent(state);
});

describe('guards and a city handed over', () => {
  test('a city ceded with guards keeps only the garrison its new owner can hold', () => {
    const state = buildFixture();
    const romans = state.factions[FIXTURE.rome];
    if (!romans) throw new Error('no Rome');
    romans.stores.gold = 10_000;
    for (let i = 0; i < 2; i++)
      expect(
        executeOrder(
          state,
          { kind: 'hireGuards', faction: FIXTURE.rome, city: FIXTURE.capua },
          world,
        ),
      ).toBeUndefined();
    const capua = state.cities[FIXTURE.capua];
    if (!capua) throw new Error('no Capua');
    const full = fullDefences({ ...capua, guards: [] }).garrison;
    expect(capua.garrison).toBe(full + 2 * GUARD_BAND);
    changeCityOwner(state, FIXTURE.capua, FIXTURE.carthage);
    expect(capua.guards).toEqual([]);
    expect(capua.garrison).toBe(full);
    expectConsistent(state);
  });
});
