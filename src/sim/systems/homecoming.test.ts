import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { ArmyId, FactionId } from '../ids.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { landOwnerAt } from '../peace/home.ts';
import { expectConsistent } from '../references.ts';
import type { GameState } from '../state/game-state.ts';
import type { Day } from '../state/day.ts';
import type { MapPoint } from '../state/map-point.ts';
import type { PeaceTerms } from '../state/peace.ts';
import { tick } from '../tick.ts';
import { distance } from '../world/find-path.ts';

const world = fixtureWorld();
const f = FIXTURE;
const CARTHAGO = { x: 2224.9, y: 2870.1 };
const CAPUA = { x: 2638.8, y: 2448.3 };
/** Inland, between Capua and Roma, more than a siege distance from either. */
const BETWEEN = { x: 2575, y: 2392 };
const PEACE: Order = {
  kind: 'acceptPeace',
  faction: f.carthage,
  from: f.rome,
  terms: { kind: 'asThingsStand' },
};

function atWar(): GameState {
  const state = buildFixture();
  const declare: Order = { kind: 'declareWar', faction: f.rome, against: f.carthage };
  expect(executeOrder(state, declare, world)).toBeUndefined();
  const offer: Order = {
    kind: 'offerPeace',
    faction: f.rome,
    to: f.carthage,
    terms: { kind: 'asThingsStand' },
  };
  expect(executeOrder(state, offer, world)).toBeUndefined();
  return state;
}

function place(state: GameState, id: ArmyId, position: MapPoint) {
  const army = state.armies[id];
  if (!army) throw new Error(`no army ${id}`);
  army.activity = { kind: 'idle', position };
}

function menOf(state: GameState, owner: FactionId): number {
  return Object.values(state.formations)
    .filter((formation) => state.armies[formation.army]?.owner === owner)
    .reduce((sum, formation) => sum + formation.men, 0);
}

/** Where the army is bound: the end of its march, of its march on from the landing, or its convoy's harbour. */
/** Plays days until every army of the two stands idle on its own land, and returns the days it took. */
function untilHome(start: GameState): { state: GameState; days: number } {
  let state = start;
  for (let days = 1; days <= 120; days += 1) {
    const result = tick(state, [], world);
    expect(result.rejected).toEqual([]);
    state = result.state;
    const home = Object.values(state.armies).every(
      (army) =>
        army.activity.kind === 'idle' && landOwnerAt(state, army.activity.position) === army.owner,
    );
    if (home) return { state, days };
  }
  throw new Error('an army never came home');
}

function boundFor(state: GameState, id: ArmyId): MapPoint | undefined {
  const army = state.armies[id];
  const activity = army?.activity;
  if (!activity) return undefined;
  if (activity.kind === 'marching') return activity.waypoints.at(-1);
  if (activity.kind === 'embarked') {
    return activity.march?.at(-1) ?? state.convoys[activity.convoy]?.waypoints.at(-1);
  }
  return undefined;
}

describe('homecoming', () => {
  test('on peace the sieges between the two end and each besieger sails or marches home, none lost', () => {
    let state = atWar();
    place(state, f.romanArmy, CARTHAGO);
    place(state, f.punicArmy, { x: 2516.3, y: 2340.8 });
    state = tick(state, [], world).state;
    expect(Object.keys(state.sieges)).toHaveLength(2);
    const men = { rome: menOf(state, f.rome), carthage: menOf(state, f.carthage) };
    const result = tick(state, [PEACE], world);
    expect(result.rejected).toEqual([]);
    state = result.state;
    expect(Object.keys(state.sieges)).toHaveLength(0);
    expect(menOf(state, f.rome)).toBe(men.rome);
    expect(menOf(state, f.carthage)).toBe(men.carthage);
    const roman = boundFor(state, f.romanArmy);
    expect(roman && landOwnerAt(state, roman)).toBe(f.rome);
    expect(result.events.filter((event) => event.kind === 'armyDestroyed')).toEqual([]);
    expectConsistent(state);
    const home = untilHome(state);
    expect(home.days).toBeLessThan(90);
    expect(menOf(home.state, f.rome)).toBe(men.rome);
    expectConsistent(home.state);
  });

  test("on peace a battle between the two ends with no loss, and the army on the other side's land turns home", () => {
    let state = atWar();
    place(state, f.punicArmy, BETWEEN);
    place(state, f.romanArmy, { x: BETWEEN.x + 5, y: BETWEEN.y });
    state = tick(state, [], world).state;
    expect(Object.keys(state.battles)).toHaveLength(1);
    const men = { rome: menOf(state, f.rome), carthage: menOf(state, f.carthage) };
    const result = tick(state, [PEACE], world);
    state = result.state;
    expect(state.battles).toEqual({});
    expect(menOf(state, f.rome)).toBe(men.rome);
    expect(menOf(state, f.carthage)).toBe(men.carthage);
    expect(result.events.map((event) => event.kind)).toEqual(['peaceMade']);
    const roman = state.armies[f.romanArmy]?.activity;
    expect(roman?.kind === 'idle' && landOwnerAt(state, roman.position)).toBe(f.rome);
    expectConsistent(state);
    expect(untilHome(state).days).toBeLessThan(90);
  });

  test('on peace an army marching on the other side turns home, and a third side is left alone', () => {
    let state = atWar();
    const march: Order = { kind: 'moveArmy', faction: f.carthage, army: f.punicArmy, to: CAPUA };
    place(state, f.punicArmy, BETWEEN);
    expect(executeOrder(state, march, world)).toBeUndefined();
    state = tick(state, [PEACE], world).state;
    const punic = state.armies[f.punicArmy]?.activity;
    const at =
      punic?.kind === 'marching'
        ? punic.waypoints.at(-1)
        : punic?.kind === 'idle'
          ? punic.position
          : undefined;
    expect(distance(at ?? CAPUA, CAPUA)).toBeGreaterThan(50);
    expect(state.armies[f.romanArmy]?.activity.kind).toBe('idle');
    expectConsistent(state);
    expect(untilHome(state).days).toBeLessThan(90);
  });

  test('a march ordered on the day of the peace is turned home after it', () => {
    let state = atWar();
    const march: Order = { kind: 'moveArmy', faction: f.rome, army: f.romanArmy, to: CAPUA };
    place(state, f.romanArmy, { x: 2516.3, y: 2340.8 });
    place(state, f.punicArmy, BETWEEN);
    state = tick(state, [PEACE, march], world).state;
    expect(untilHome(structuredClone(state)).days).toBeLessThan(90);
    expect(distance(boundFor(state, f.romanArmy) ?? CAPUA, CAPUA)).toBeLessThan(1);
    expectConsistent(state);
  });

  test('an army overseas whose owner cedes its last port lands at a foreign port and marches home', () => {
    let state = atWar();
    state.day = (state.day + 1) as Day;
    place(state, f.romanArmy, CARTHAGO);
    place(state, f.punicArmy, { x: 2229.9, y: 2865.1 + 60 });
    const terms: PeaceTerms = { kind: 'payment', payer: f.rome, gold: 0, cities: [f.roma] };
    expect(
      executeOrder(state, { kind: 'offerPeace', faction: f.rome, to: f.carthage, terms }, world),
    ).toBeUndefined();
    state = tick(
      state,
      [{ kind: 'acceptPeace', faction: f.carthage, from: f.rome, terms }],
      world,
    ).state;
    expect(state.cities[f.roma]?.owner).toBe(f.carthage);
    const home = untilHome(state);
    const at = home.state.armies[f.romanArmy]?.activity;
    expect(at?.kind === 'idle' && distance(at.position, CAPUA)).toBeLessThan(15);
    expectConsistent(home.state);
  });
});
