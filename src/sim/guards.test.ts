import { describe, expect, test } from 'vitest';
import { leaveSiege } from './armies.ts';
import { changeCityOwner } from './cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from './fixture.ts';
import { dismissRefusal, GUARD_BAND, GUARD_GOLD, GUARD_UPKEEP, guardRefusal } from './guards.ts';
import type { CityId } from './ids.ts';
import { executeOrder, type Order } from './orders/orders.ts';
import { expectConsistent } from './references.ts';
import { loadGame, SAVE_FORMAT, saveGame } from './save.ts';
import type { GameState } from './state/game-state.ts';
import { dailyBalances, DESERTION } from './systems/economy.ts';
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
const dismiss = (city: CityId = FIXTURE.roma): Order => ({
  kind: 'dismissGuards',
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
  test('pays the gold and raises the garrison and the full garrison at once, and they hold', () => {
    let state = withGold(5000);
    expect(executeOrder(state, hire(), world)).toBeUndefined();
    const full = CITY_DEFENCES.capital.garrison;
    expect(gold(state)).toBe(5000 - GUARD_GOLD);
    expect(city(state)).toMatchObject({ guards: GUARD_BAND, garrison: full + GUARD_BAND });
    expect(fullDefences(city(state)).garrison).toBe(full + GUARD_BAND);
    state = tick(state, [], world).state;
    expect(city(state).garrison).toBe(full + GUARD_BAND);
    expectConsistent(state);
  });

  test('a capital holds at most its full garrison of guards, and a great power city half that', () => {
    const state = withGold(50_000);
    city(state).guards = CITY_DEFENCES.capital.garrison - GUARD_BAND;
    expect(executeOrder(state, hire(), world)).toBeUndefined();
    expect(executeOrder(state, hire(), world)?.reason).toBe(
      'roma holds 3000 guards, and 3000 is the most it can',
    );
    city(state, FIXTURE.capua).guards = 1000;
    expect(executeOrder(state, hire(FIXTURE.capua), world)).toBeUndefined();
    expect(guardRefusal(state, city(state, FIXTURE.capua), FIXTURE.rome)).toBe(
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
    expect(city(state, FIXTURE.capua).guards).toBe(0);
    expectConsistent(state);
  });

  test('is refused with less gold than a band costs', () => {
    const state = withGold(GUARD_GOLD - 1);
    expect(executeOrder(state, hire(), world)?.reason).toBe(
      '500 guards cost 1500 gold, but rome has 1499',
    );
    expect(city(state).guards).toBe(0);
    expectConsistent(state);
  });
});

describe('dismissing guards', () => {
  test('lets a band go with no gold back, and the garrison falls to the new full garrison', () => {
    const state = withGold(5000);
    executeOrder(state, hire(), world);
    executeOrder(state, hire(), world);
    expect(executeOrder(state, dismiss(), world)).toBeUndefined();
    expect(gold(state)).toBe(5000 - 2 * GUARD_GOLD);
    expect(city(state)).toMatchObject({
      guards: GUARD_BAND,
      garrison: CITY_DEFENCES.capital.garrison + GUARD_BAND,
    });
    expectConsistent(state);
  });

  test('is refused in a city with no guards or not its own', () => {
    const state = withGold(5000);
    expect(executeOrder(state, dismiss(), world)?.reason).toBe('roma holds no guards');
    expect(dismissRefusal(city(state, FIXTURE.carthago), FIXTURE.rome)).toBe(
      'carthago belongs to carthage, not rome',
    );
    expectConsistent(state);
  });
});

describe('the cost of guards', () => {
  test('their upkeep shows in the daily balance', () => {
    const state = withGold(5000);
    const before = need(dailyBalances(state).get(FIXTURE.rome));
    executeOrder(state, hire(), world);
    executeOrder(state, hire(FIXTURE.capua), world);
    const after = need(dailyBalances(state).get(FIXTURE.rome));
    expect(before.gold - after.gold).toBeCloseTo(2 * GUARD_BAND * GUARD_UPKEEP);
    expect(after.food).toBe(before.food);
    expectConsistent(state);
  });

  test('unpaid guards leave while the gold is below zero, and the garrison with them', () => {
    let state = withGold(0);
    city(state).guards = 1000;
    city(state).garrison = CITY_DEFENCES.capital.garrison + 1000;
    need(state.factions[FIXTURE.rome]).stores.gold = -1000;
    state = tick(state, [], world).state;
    const left = 1000 - Math.ceil(1000 * DESERTION);
    expect(city(state).guards).toBe(left);
    expect(city(state).garrison).toBe(CITY_DEFENCES.capital.garrison + left);
    expectConsistent(state);
  });
});

describe('guards and war', () => {
  test('a city that changes owner keeps none of its guards', () => {
    const state = withGold(5000);
    executeOrder(state, hire(FIXTURE.capua), world);
    changeCityOwner(state, FIXTURE.capua, FIXTURE.carthage);
    expect(city(state, FIXTURE.capua).guards).toBe(0);
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
      guards: 0,
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
    expect(city(state, FIXTURE.capua)).toMatchObject({ guards: GUARD_BAND, garrison: full });
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
