import { describe, expect, test } from 'vitest';
import { LandOracle } from '../../../scripts/movement/land-oracle.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { ArmyId, BattleId, CityId, SiegeId } from '../ids.ts';
import { GATHER_DAYS } from '../orders/embark.ts';
import {
  CONVOY_KM_PER_DAY,
  landPath,
  MARCH_KM_PER_DAY,
  marchPath,
  REFUGEE_KM_PER_DAY,
} from '../march.ts';
import { newGame } from '../new-game.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import { loadGame, saveGame } from '../save.ts';
import type { Army } from '../state/army.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import type { RefugeeColumnId } from '../ids.ts';
import { SYSTEMS } from '../systems.ts';
import { tick } from '../tick.ts';
import { distance } from '../world/find-path.ts';
import { movement } from './movement.ts';

const world = fixtureWorld();
const oracle = new LandOracle(world.map);

function cityOnMap(id: string): MapPoint {
  const province = world.map.provinces.find((p) => p.id === id);
  if (!province) throw new Error(`the map has no city ${id}`);
  return { x: province.city[0], y: province.city[1] };
}

const ROMA = cityOnMap('roma');
const CAPUA = cityOnMap('capua');
const TARRACO = cityOnMap('tarraco');
const SYRACUSAE = cityOnMap('syracusae');
const TYRRHENIAN_SEA = { x: 2400, y: 2500 };

function inProvince(id: string, { x, y }: MapPoint): boolean {
  const province = world.map.provinces.find((p) => p.id === id);
  return !!province?.outline.some(([outer]) => {
    let inside = false;
    const ring = outer ?? [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}

function armyOf(state: GameState, id: ArmyId): Army {
  const army = state.armies[id];
  if (!army) throw new Error(`army ${id} is missing`);
  return army;
}

function positionOf(army: Army): MapPoint {
  if (army.activity.kind === 'embarked') throw new Error(`army ${army.id} is at sea`);
  return army.activity.position;
}

function moveRoman(to: MapPoint): Order {
  return { kind: 'moveArmy', faction: FIXTURE.rome, army: FIXTURE.romanArmy, to };
}

function lengthOf(from: MapPoint, path: readonly MapPoint[]): number {
  let total = 0;
  let at = from;
  for (const point of path) {
    total += distance(at, point);
    at = point;
  }
  return total;
}

/** Plays days until the army stops marching, and returns every position it passed. */
function marchToEnd(start: GameState, id: ArmyId, maxDays = 400) {
  let state = start;
  const trail = [positionOf(armyOf(state, id))];
  while (armyOf(state, id).activity.kind === 'marching' && trail.length <= maxDays) {
    state = tick(state, [], world).state;
    trail.push(positionOf(armyOf(state, id)));
    expectConsistent(state);
  }
  return { state, trail };
}

describe('a march on land', () => {
  test('Roma to Capua is a short direct march', () => {
    const state = buildFixture();
    expect(executeOrder(state, moveRoman(CAPUA), world)).toBeUndefined();
    const { activity } = armyOf(state, FIXTURE.romanArmy);
    if (activity.kind !== 'marching') throw new Error('the army is not marching');
    expect(activity.waypoints).toEqual([CAPUA]);
    expect(lengthOf(activity.position, activity.waypoints)).toBeLessThan(170);
    expectConsistent(state);
  });

  test('Roma to Tarraco goes around the coast through Gaul and never touches water', () => {
    const state = buildFixture();
    expect(executeOrder(state, moveRoman(TARRACO), world)).toBeUndefined();
    const { activity } = armyOf(state, FIXTURE.romanArmy);
    if (activity.kind !== 'marching') throw new Error('the army is not marching');
    const route = [activity.position, ...activity.waypoints];
    for (const [i, point] of route.slice(1).entries()) {
      expect(oracle.segmentOnLand(route[i] as MapPoint, point), `leg ${i} of the path`).toBe(true);
    }
    const length = lengthOf(activity.position, activity.waypoints);
    expect(length).toBeGreaterThan(1.2 * distance(ROMA, TARRACO));

    const { state: end, trail } = marchToEnd(state, FIXTURE.romanArmy);
    for (const [i, point] of trail.slice(1).entries()) {
      expect(oracle.pointOnLand(point), `day ${i + 1}`).toBe(true);
    }
    expect(trail.some((point) => inProvince('massalia', point))).toBe(true);
    expect(trail).toHaveLength(1 + Math.ceil(length / MARCH_KM_PER_DAY));
    expect(armyOf(end, FIXTURE.romanArmy).activity).toEqual({ kind: 'idle', position: TARRACO });
    expectConsistent(end);
  });

  test('a destination on an island is unreachable by land and the order is rejected', () => {
    const state = buildFixture();
    expect(executeOrder(state, moveRoman(SYRACUSAE), world)?.reason).toBe(
      `no land route reaches ${SYRACUSAE.x}, ${SYRACUSAE.y}`,
    );
    expect(state).toEqual(buildFixture());
    expectConsistent(state);
  });

  test('a destination in the sea is rejected', () => {
    expect(oracle.pointOnLand(TYRRHENIAN_SEA)).toBe(false);
    const state = buildFixture();
    expect(executeOrder(state, moveRoman(TYRRHENIAN_SEA), world)?.reason).toBe(
      'destination 2400, 2500 is in the sea',
    );
    expect(state).toEqual(buildFixture());
    expectConsistent(state);
  });

  test('a destination off the map is rejected', () => {
    const state = buildFixture();
    expect(executeOrder(state, moveRoman({ x: -50, y: 10 }), world)?.reason).toBe(
      'destination -50, 10 is off the map',
    );
    expectConsistent(state);
  });

  test('an army arrives and becomes idle on the day its path length gives', () => {
    let state = tick(buildFixture(), [moveRoman(CAPUA)], world).state;
    const start = buildFixture().armies[FIXTURE.romanArmy]?.activity;
    if (start?.kind !== 'idle') throw new Error('the fixture army is not idle');
    const days = Math.ceil(distance(start.position, CAPUA) / MARCH_KM_PER_DAY);
    for (let day = 1; day < days; day += 1) {
      expect(armyOf(state, FIXTURE.romanArmy).activity.kind).toBe('marching');
      state = tick(state, [], world).state;
    }
    expect(state.day).toBe(1 + days);
    expect(armyOf(state, FIXTURE.romanArmy).activity).toEqual({ kind: 'idle', position: CAPUA });
    expectConsistent(state);
  });

  test('a new order replaces the march', () => {
    let state = tick(buildFixture(), [moveRoman(CAPUA)], world).state;
    state = tick(state, [moveRoman(ROMA)], world).state;
    const { activity } = armyOf(state, FIXTURE.romanArmy);
    expect(activity.kind === 'marching' && activity.waypoints.at(-1)).toEqual(ROMA);
    const { state: end } = marchToEnd(state, FIXTURE.romanArmy);
    expect(armyOf(end, FIXTURE.romanArmy).activity).toEqual({ kind: 'idle', position: ROMA });
    expectConsistent(end);
  });

  test('halt stops the army where it stands', () => {
    let state = tick(buildFixture(), [moveRoman(TARRACO)], world).state;
    const halt: Order = { kind: 'halt', faction: FIXTURE.rome, army: FIXTURE.romanArmy };
    const there = positionOf(armyOf(state, FIXTURE.romanArmy));
    state = tick(state, [halt], world).state;
    expect(armyOf(state, FIXTURE.romanArmy).activity).toEqual({ kind: 'idle', position: there });
    state = tick(state, [], world).state;
    expect(armyOf(state, FIXTURE.romanArmy).activity).toEqual({ kind: 'idle', position: there });
    expect(executeOrder(state, halt, world)?.reason).toBe('army army-roman is not marching');
    expectConsistent(state);
  });

  test('an army in a battle cannot be moved or embarked', () => {
    const state = buildFixture();
    const battle = 'battle-1' as BattleId;
    state.nextSerial = 2;
    const roman = armyOf(state, FIXTURE.romanArmy);
    const punic = armyOf(state, FIXTURE.punicArmy);
    roman.activity = { kind: 'inBattle', position: positionOf(roman), battle, march: [] };
    punic.activity = { kind: 'inBattle', position: positionOf(roman), battle, march: [] };
    state.battles[battle] = {
      id: battle,
      position: positionOf(roman),
      attackers: [roman.id],
      defenders: [punic.id],
      startedOn: state.day,
      sides: { attackers: { factions: [], lost: 0 }, defenders: { factions: [], lost: 0 } },
    };
    const before = structuredClone(state);
    const reason = 'army army-roman is in battle battle-1 and must retreat first';
    expect(executeOrder(state, moveRoman(CAPUA), world)?.reason).toBe(reason);
    expect(
      executeOrder(
        state,
        { kind: 'embark', faction: FIXTURE.rome, army: roman.id, to: FIXTURE.carthago },
        world,
      )?.reason,
    ).toBe(reason);
    expect(state).toEqual(before);
    expectConsistent(state);
  });
});

describe('a crossing by convoy', () => {
  const embark = (to: CityId): Order => ({
    kind: 'embark',
    faction: FIXTURE.carthage,
    army: FIXTURE.punicArmy,
    to,
  });

  test('Carthago to Syracusae: the army boards, the convoy sails over water, and it lands idle at a harbour beside the city', () => {
    let state = buildFixture();
    expect(executeOrder(state, embark(FIXTURE.syracusae), world)).toBeUndefined();
    const [convoy] = Object.values(state.convoys);
    if (!convoy) throw new Error('no convoy set sail');
    expect(armyOf(state, FIXTURE.punicArmy).activity).toMatchObject({
      kind: 'embarked',
      convoy: convoy.id,
    });
    expect(convoy.departsOn).toBeUndefined();
    expect(convoy.armies).toEqual([FIXTURE.punicArmy]);
    const landing = world.harbours.get(FIXTURE.syracusae);
    expect(convoy.waypoints.at(-1)).toEqual(landing);
    const route = [convoy.position, ...convoy.waypoints];
    for (const [i, point] of route.slice(1).entries()) {
      expect(oracle.segmentAtSea(route[i] as MapPoint, point), `leg ${i} of the voyage`).toBe(true);
    }
    expectConsistent(state);

    const days = Math.ceil(lengthOf(convoy.position, convoy.waypoints) / CONVOY_KM_PER_DAY);
    for (let day = 1; day < days; day += 1) {
      state = tick(state, [], world).state;
      expect(armyOf(state, FIXTURE.punicArmy).activity.kind).toBe('embarked');
      expectConsistent(state);
    }
    state = tick(state, [], world).state;
    expect(state.convoys).toEqual({});
    expect(armyOf(state, FIXTURE.punicArmy).activity).toEqual({ kind: 'idle', position: landing });
    expect(distance(landing as MapPoint, SYRACUSAE)).toBeLessThan(5);
    expectConsistent(state);
  });

  test('an army that lands at a harbour far from its city marches into the city and can sail again from there', () => {
    let state = buildFixture();
    const roma = state.cities[FIXTURE.roma];
    if (!roma) throw new Error('the fixture lacks Roma');
    roma.owner = FIXTURE.carthage;
    const harbour = world.harbours.get(FIXTURE.roma) as MapPoint;
    expect(distance(harbour, ROMA)).toBeGreaterThan(20);
    expect(executeOrder(state, embark(FIXTURE.roma), world)).toBeUndefined();
    for (
      let day = 0;
      day < 200 && armyOf(state, FIXTURE.punicArmy).activity.kind !== 'idle';
      day += 1
    ) {
      state = tick(state, [], world).state;
    }
    expect(armyOf(state, FIXTURE.punicArmy).activity).toEqual({ kind: 'idle', position: ROMA });
    expect(executeOrder(state, embark(FIXTURE.carthago), world)).toBeUndefined();
    expect(armyOf(state, FIXTURE.punicArmy).activity.kind).toBe('embarked');
    expectConsistent(state);
  });

  test('is rejected away from a port of the faction and from the shore, and to a city that is not a port', () => {
    const state = buildFixture();
    expect(executeOrder(state, embark('capua' as CityId), world)?.reason).toBe(
      'Capua is not a port',
    );
    const punic = armyOf(state, FIXTURE.punicArmy);
    punic.activity = { kind: 'idle', position: { x: 2169.9, y: 2885.1 } };
    expect(executeOrder(state, embark(FIXTURE.syracusae), world)?.reason).toBe(
      'army army-punic stands at no port of carthage and on no shore of the sea to Syracusae',
    );
    expect(state.convoys).toEqual({});
    expectConsistent(state);
  });

  test('an army on a shore that is no port of its own gathers ships for GATHER_DAYS, then sails home and marches into its city', () => {
    let state = buildFixture();
    const shore = { x: 2225, y: 2960 };
    armyOf(state, FIXTURE.romanArmy).activity = { kind: 'idle', position: shore };
    const order: Order = {
      kind: 'embark',
      faction: FIXTURE.rome,
      army: FIXTURE.romanArmy,
      to: FIXTURE.roma,
    };
    expect(executeOrder(state, order, world)).toBeUndefined();
    const [convoy] = Object.values(state.convoys);
    expect(convoy?.departsOn).toBe(state.day + GATHER_DAYS);
    const waiting = convoy?.position;
    for (let day = 0; day < GATHER_DAYS; day += 1) {
      state = tick(state, [], world).state;
      expect(Object.values(state.convoys)[0]?.position).toEqual(waiting);
    }
    state = tick(state, [], world).state;
    expect(Object.values(state.convoys)[0]?.position).not.toEqual(waiting);
    for (
      let day = 0;
      day < 200 && armyOf(state, FIXTURE.romanArmy).activity.kind !== 'idle';
      day += 1
    ) {
      state = tick(state, [], world).state;
    }
    expect(armyOf(state, FIXTURE.romanArmy).activity).toEqual({ kind: 'idle', position: ROMA });
    expectConsistent(state);
  });

  test('a besieging army sails from the port it besieges and leaves the siege', () => {
    const state = buildFixture();
    executeOrder(
      state,
      { kind: 'declareWar', faction: FIXTURE.rome, against: FIXTURE.carthage },
      world,
    );
    const carthago = state.cities[FIXTURE.carthago];
    if (!carthago) throw new Error('the fixture lacks Carthago');
    armyOf(state, FIXTURE.punicArmy).activity = { kind: 'idle', position: { x: 0, y: 0 } };
    const siege = 'siege-1' as SiegeId;
    state.nextSerial = 2;
    state.sieges[siege] = {
      id: siege,
      city: FIXTURE.carthago,
      besiegers: [FIXTURE.romanArmy],
      startedOn: state.day,
    };
    armyOf(state, FIXTURE.romanArmy).activity = {
      kind: 'besieging',
      position: world.harbours.get(FIXTURE.carthago) as MapPoint,
      siege,
    };
    expect(
      executeOrder(
        state,
        { kind: 'embark', faction: FIXTURE.rome, army: FIXTURE.romanArmy, to: FIXTURE.roma },
        world,
      ),
    ).toBeUndefined();
    expect(armyOf(state, FIXTURE.romanArmy).activity.kind).toBe('embarked');
    expect(state.sieges[siege]?.besiegers).toEqual([]);
    expect(carthago.owner).toBe(FIXTURE.carthage);
  });

  test('Carthage sails to Roma and then marches on to Capua: the army marches on from its landing every day of the land leg', () => {
    let state = buildFixture();
    const order: Order = {
      kind: 'embark',
      faction: FIXTURE.carthage,
      army: FIXTURE.punicArmy,
      to: FIXTURE.roma,
      then: CAPUA,
    };
    expect(executeOrder(state, order, world)).toBeUndefined();
    for (
      let day = 0;
      day < 200 && armyOf(state, FIXTURE.punicArmy).activity.kind === 'embarked';
      day += 1
    ) {
      state = tick(state, [], world).state;
    }
    const landed = armyOf(state, FIXTURE.punicArmy).activity;
    expect(landed).toMatchObject({ kind: 'marching', position: world.harbours.get(FIXTURE.roma) });
    while (armyOf(state, FIXTURE.punicArmy).activity.kind === 'marching') {
      const activity = armyOf(state, FIXTURE.punicArmy).activity;
      expect(activity.kind === 'marching' && activity.waypoints.at(-1)).toEqual(CAPUA);
      state = tick(state, [], world).state;
    }
    expect(armyOf(state, FIXTURE.punicArmy).activity).toEqual({ kind: 'idle', position: CAPUA });
    expectConsistent(state);
  });

  test('a landing whose march on the rules refuse is refused before the army boards', () => {
    const state = buildFixture();
    const order: Order = {
      kind: 'embark',
      faction: FIXTURE.carthage,
      army: FIXTURE.punicArmy,
      to: FIXTURE.roma,
      then: TYRRHENIAN_SEA,
    };
    expect(executeOrder(state, order, world)?.reason).toMatch(/in the sea/);
    expect(state.convoys).toEqual({});
  });

  test('an army that lands at an enemy port whose harbour lies 23 km out marches in and besieges the city', () => {
    let state = buildFixture();
    expect(
      executeOrder(
        state,
        { kind: 'declareWar', faction: FIXTURE.carthage, against: FIXTURE.rome },
        world,
      ),
    ).toBeUndefined();
    armyOf(state, FIXTURE.romanArmy).activity = { kind: 'idle', position: CAPUA };
    expect(distance(world.harbours.get(FIXTURE.roma) as MapPoint, ROMA)).toBeGreaterThan(20);
    expect(executeOrder(state, embark(FIXTURE.roma), world)).toBeUndefined();
    for (
      let day = 0;
      day < 200 && armyOf(state, FIXTURE.punicArmy).activity.kind !== 'besieging';
      day += 1
    ) {
      state = tick(state, [], world).state;
    }
    const { activity } = armyOf(state, FIXTURE.punicArmy);
    expect(activity.kind).toBe('besieging');
    expect(activity.kind === 'besieging' && state.sieges[activity.siege]?.city).toBe(FIXTURE.roma);
    expectConsistent(state);
  });

  test('an embarked army cannot be ordered to march', () => {
    const state = buildFixture();
    executeOrder(state, embark(FIXTURE.syracusae), world);
    const [convoy] = Object.keys(state.convoys);
    expect(
      executeOrder(
        state,
        { kind: 'moveArmy', faction: FIXTURE.carthage, army: FIXTURE.punicArmy, to: CAPUA },
        world,
      )?.reason,
    ).toBe(`army army-punic is at sea in convoy ${convoy}`);
    expectConsistent(state);
  });
});

describe('a refugee column', () => {
  test('walks its land path at refugee speed, and the city takes it in on arrival', () => {
    let state = buildFixture();
    const path = landPath(world, ROMA, CAPUA);
    if (typeof path === 'string') throw new Error(path);
    const id = 'refugeeColumn-1' as RefugeeColumnId;
    state.nextSerial = 2;
    state.refugeeColumns[id] = {
      id,
      owner: FIXTURE.rome,
      people: 2_000,
      from: FIXTURE.roma,
      to: FIXTURE.capua,
      position: ROMA,
      waypoints: path,
    };
    const days = Math.ceil(lengthOf(ROMA, path) / REFUGEE_KM_PER_DAY);
    for (let day = 1; day < days; day += 1) {
      state = tick(state, [], world).state;
      const column = state.refugeeColumns[id];
      expect(column?.waypoints.length).toBeGreaterThan(0);
      expect(distance(column?.position ?? ROMA, ROMA)).toBeCloseTo(day * REFUGEE_KM_PER_DAY, 6);
    }
    const before = state.cities[FIXTURE.capua]?.population ?? 0;
    state = tick(state, [], world).state;
    expect(state.refugeeColumns).toEqual({});
    expect(state.cities[FIXTURE.capua]?.population).toBeGreaterThan(before + 1_999);
    expectConsistent(state);
  });
});

describe('the whole game', () => {
  const capitals = ['persepolis', 'memphis', 'roma', 'carthago', 'pella'];
  // Each army marches on the first capital in turn that lies within a march of it.
  const orders = (state: GameState): Order[] =>
    Object.values(state.armies).flatMap((army, i) => {
      const from = army.activity.kind === 'idle' ? army.activity.position : undefined;
      const turn = [
        ...capitals.slice(i % capitals.length),
        ...capitals.slice(0, i % capitals.length),
      ];
      const to = turn
        .map((id) => cityOnMap(id))
        .find(
          (to) =>
            from &&
            Math.hypot(to.x - from.x, to.y - from.y) > 100 &&
            typeof marchPath(world, from, to) !== 'string',
        );
      return to ? [{ kind: 'moveArmy', faction: army.owner, army: army.id, to }] : [];
    });
  const play = (from: GameState, days: number, first: (state: GameState) => Order[] = () => []) => {
    let state = from;
    for (let day = 0; day < days; day += 1) {
      state = tick(state, day === 0 ? first(state) : [], world).state;
    }
    return state;
  };

  test('the same seed and orders give the same result', () => {
    const a = play(newGame(world.map, { seed: 5, player: 'rome' }), 60, orders);
    const b = play(newGame(world.map, { seed: 5, player: 'rome' }), 60, orders);
    expect(Object.values(a.armies).some((army) => army.activity.kind === 'marching')).toBe(true);
    expect(saveGame(b)).toBe(saveGame(a));
    expectConsistent(a);
  });

  test('a save and load in the middle of a march continues it unchanged', () => {
    const halfway = play(newGame(world.map, { seed: 5, player: 'rome' }), 20, orders);
    const marching = Object.values(halfway.armies).filter((a) => a.activity.kind === 'marching');
    expect(marching.length).toBeGreaterThan(0);
    const loaded = loadGame(saveGame(halfway));
    if (!loaded.ok) throw new Error(loaded.error);
    const resumed = play(loaded.state, 80);
    expect(saveGame(resumed)).toBe(saveGame(play(halfway, 80)));
    expectConsistent(resumed);
  });

  test('movement is the first system of the day', () => {
    expect(SYSTEMS[0]).toBe(movement);
  });
});
