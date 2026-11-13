import { describe, expect, test } from 'vitest';
import { BUILDINGS } from '../buildings/buildings.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import { executeOrder } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import type { GameState } from '../state/game-state.ts';
import { buildingWorth, construction } from './build.ts';
import { decideOrders } from './decide.ts';
import { TROOPS } from '../troops.ts';
import { mostNeeded } from './budget.ts';
import { reserveOf } from './situation.ts';

/** The value, or a thrown error naming what the test expected to exist. */
function need<T>(value: T | undefined, what = 'a record'): T {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const world = fixtureWorld();
const f = FIXTURE;

/** Rome with gold to spare and no manpower, so it cannot recruit. */
function idleAndRich(gold = 40_000): GameState {
  const state = buildFixture();
  need(state.factions[f.rome]).stores = { gold, food: 1000, manpower: 0 };
  return state;
}

describe('the AI builds', () => {
  test('what pays back soonest when it cannot recruit', () => {
    const state = idleAndRich();
    const roma = need(state.cities[f.roma]);
    const paybacks = (['forum', 'barracks', 'canals'] as const).map(
      (kind) => BUILDINGS[kind].gold / buildingWorth(state, roma, kind),
    );
    expect(paybacks[0]).toBeLessThan(Math.min(...paybacks.slice(1)));
    expect(decideOrders(state, world, f.rome)).toContainEqual({
      kind: 'build',
      faction: f.rome,
      city: f.roma,
      building: 'forum',
    });
    expectConsistent(state);
  });

  test('in another city while its best city is at work', () => {
    const state = idleAndRich();
    expect(executeOrder(state, need(construction(state, f.rome, false)[0]), world)).toBeUndefined();
    const [next] = construction(state, f.rome, false);
    expect(next).toMatchObject({ kind: 'build', city: f.capua });
    expectConsistent(state);
  });

  test('nothing on a day it recruits', () => {
    expect(construction(idleAndRich(), f.rome, true)).toEqual([]);
  });

  test('nothing with the gold that keeps its men and pays for the recruit it would raise next', () => {
    const tight = buildFixture();
    const reserve = reserveOf(tight, f.rome, 'gold');
    need(tight.factions[f.rome]).stores.gold =
      reserve + TROOPS[mostNeeded(tight, f.rome)].recruit.gold + BUILDINGS.temple.gold - 1;
    expect(construction(tight, f.rome, false)).toEqual([]);
    need(tight.factions[f.rome]).stores.gold += 1 + BUILDINGS.canals.gold;
    expect(construction(tight, f.rome, false)).toHaveLength(1);
  });

  test('nothing while its gold is falling', () => {
    const state = idleAndRich();
    need(state.formations[f.hastati]).men = 5000;
    expect(construction(state, f.rome, false)).toEqual([]);
  });

  test('no temple where another of its temples already reaches the city it would take', () => {
    const state = idleAndRich();
    const capua = need(state.cities[f.capua]);
    const covered = need(state.cities[f.roma]);
    need(state.cities[f.syracusae]).position = { x: 2838, y: 2448 };
    const before = buildingWorth(state, capua, 'temple');
    covered.buildings.push('temple');
    expect(buildingWorth(state, capua, 'temple')).toBeLessThan(before);
    expect(buildingWorth(state, capua, 'temple')).toBe(0);
  });
});
