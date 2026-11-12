import { describe, expect, test } from 'vitest';
import { fixtureWorld } from './fixture.ts';
import { allocateId, type ArmyId, type CityId, type FactionId } from './ids.ts';
import { startMarch } from './march.ts';
import { newGame } from './new-game.ts';
import { expectConsistent } from './references.ts';
import { SIGHT_KM, sightOf } from './sight.ts';
import type { Army } from './state/army.ts';
import type { GameState } from './state/game-state.ts';
import type { MapPoint } from './state/map-point.ts';

const world = fixtureWorld();
const rome = 'rome' as FactionId;

function game(): GameState {
  return newGame(world.map, { seed: 1, player: 'rome' });
}

function armyOf(state: GameState, owner: string): Army {
  const army = Object.values(state.armies).find((a) => a.owner === owner);
  if (!army) throw new Error(`no army of ${owner}`);
  return army;
}

function standAt(state: GameState, owner: string, position: MapPoint): ArmyId {
  const army = armyOf(state, owner);
  army.activity = { kind: 'idle', position };
  return army.id;
}

function cityAt(state: GameState, id: string): MapPoint {
  const city = state.cities[id as CityId];
  if (!city) throw new Error(`no city ${id}`);
  return city.position;
}

const east = (from: MapPoint, km: number): MapPoint => ({ x: from.x + km, y: from.y });
const west = (from: MapPoint, km: number): MapPoint => ({ x: from.x - km, y: from.y });
/** Far inland in Persia, more than 1,000 km from anything Roman. */
const PERSIA = { x: 6000, y: 3000 };
/** The toe of Italy in Rome's province of Capua, 385 km from every Roman city and army. */
const CALABRIA = { x: 2740, y: 2820 };
/** Open sea between Iberia and Sardinia. */
const WESTERN_SEA = { x: 1900, y: 2350 };

describe('sightOf', () => {
  test('a faction sees its own armies, convoys, and refugee columns anywhere', () => {
    const state = game();
    const army = standAt(state, 'rome', PERSIA);
    const convoy = allocateId(state, 'convoy');
    state.convoys[convoy] = {
      id: convoy,
      owner: rome,
      position: WESTERN_SEA,
      armies: [],
      waypoints: [west(WESTERN_SEA, 50)],
    };
    const column = allocateId(state, 'refugeeColumn');
    state.refugeeColumns[column] = {
      id: column,
      owner: rome,
      people: 500,
      from: 'roma' as CityId,
      to: 'capua' as CityId,
      position: east(PERSIA, 400),
      waypoints: [],
    };
    const sight = sightOf(state, world, rome);
    expect(sight.armies.has(army)).toBe(true);
    expect(sight.convoys.has(convoy)).toBe(true);
    expect(sight.refugeeColumns.has(column)).toBe(true);
    expect(sight.sees(east(PERSIA, 400))).toBe(false);
    expectConsistent(state);
  });

  test('a foreign army inside a province of the faction is seen far from its cities', () => {
    const state = game();
    const punic = standAt(state, 'carthage', CALABRIA);
    const sight = sightOf(state, world, rome);
    for (const { centre } of sight.circles) {
      expect(Math.hypot(CALABRIA.x - centre.x, CALABRIA.y - centre.y)).toBeGreaterThan(
        SIGHT_KM.city,
      );
    }
    expect(sight.armies.has(punic)).toBe(true);
    expectConsistent(state);
  });

  test('a foreign army near an army of the faction is seen, and one beyond its range is not', () => {
    const state = game();
    standAt(state, 'rome', PERSIA);
    const near = standAt(state, 'persia', east(PERSIA, SIGHT_KM.army - 10));
    const far = standAt(state, 'egypt', east(PERSIA, SIGHT_KM.army + 10));
    const sight = sightOf(state, world, rome);
    expect(sight.armies.has(near)).toBe(true);
    expect(sight.armies.has(far)).toBe(false);
    expectConsistent(state);
  });

  test('a foreign army near a city of the faction is seen', () => {
    const state = game();
    const roma = cityAt(state, 'roma');
    const punic = standAt(state, 'carthage', west(roma, SIGHT_KM.city - 10));
    expect(sightOf(state, world, rome).armies.has(punic)).toBe(true);
    expectConsistent(state);
  });

  test('a foreign army far from everything of the faction is out of sight', () => {
    const state = game();
    const sight = sightOf(state, world, rome);
    for (const owner of ['carthage', 'macedon', 'egypt', 'persia']) {
      expect(sight.armies.has(armyOf(state, owner).id)).toBe(false);
    }
    expect(sight.armies.has(armyOf(state, 'rome').id)).toBe(true);
    expectConsistent(state);
  });

  test('a foreign convoy and the army aboard it are seen near a city and hidden at open sea', () => {
    const state = game();
    const punic = armyOf(state, 'carthage');
    const convoy = allocateId(state, 'convoy');
    const roma = cityAt(state, 'roma');
    punic.activity = { kind: 'embarked', convoy };
    state.convoys[convoy] = {
      id: convoy,
      owner: 'carthage' as FactionId,
      position: west(roma, 80),
      armies: [punic.id],
      waypoints: [west(roma, 10)],
    };
    const near = sightOf(state, world, rome);
    expect(near.convoys.has(convoy)).toBe(true);
    expect(near.armies.has(punic.id)).toBe(true);

    const record = state.convoys[convoy];
    if (!record) throw new Error('convoy missing');
    record.position = WESTERN_SEA;
    const far = sightOf(state, world, rome);
    expect(far.convoys.has(convoy)).toBe(false);
    expect(far.armies.has(punic.id)).toBe(false);
    expectConsistent(state);
  });

  test('a battle half in sight is seen with every army in it', () => {
    const state = game();
    standAt(state, 'rome', PERSIA);
    const battle = allocateId(state, 'battle');
    const attacker = armyOf(state, 'macedon');
    const defender = armyOf(state, 'persia');
    const inside = east(PERSIA, SIGHT_KM.army - 5);
    const outside = east(PERSIA, SIGHT_KM.army + 5);
    attacker.activity = { kind: 'inBattle', position: inside, battle, march: [] };
    defender.activity = { kind: 'inBattle', position: outside, battle, march: [] };
    state.battles[battle] = {
      id: battle,
      position: east(PERSIA, SIGHT_KM.army + 1),
      attackers: [attacker.id],
      defenders: [defender.id],
      startedOn: state.day,
      sides: { attackers: { factions: [], lost: 0 }, defenders: { factions: [], lost: 0 } },
    };
    const sight = sightOf(state, world, rome);
    expect(sight.sees(state.battles[battle].position)).toBe(false);
    expect(sight.sees(outside)).toBe(false);
    expect(sight.battles.has(battle)).toBe(true);
    expect(sight.armies.has(attacker.id)).toBe(true);
    expect(sight.armies.has(defender.id)).toBe(true);

    standAt(state, 'rome', cityAt(state, 'roma'));
    const away = sightOf(state, world, rome);
    expect(away.battles.has(battle)).toBe(false);
    expect(away.armies.has(attacker.id)).toBe(false);
    expectConsistent(state);
  });

  test('each range ends at its named distance', () => {
    const state = game();
    const roma = cityAt(state, 'roma');
    const city = sightOf(state, world, rome);
    expect(city.sees(west(roma, SIGHT_KM.city - 0.5))).toBe(true);
    expect(city.sees(west(roma, SIGHT_KM.city + 0.5))).toBe(false);

    standAt(state, 'rome', PERSIA);
    const army = sightOf(state, world, rome);
    expect(army.sees(east(PERSIA, SIGHT_KM.army - 0.5))).toBe(true);
    expect(army.sees(east(PERSIA, SIGHT_KM.army + 0.5))).toBe(false);

    const roman = armyOf(state, 'rome');
    const convoy = allocateId(state, 'convoy');
    roman.activity = { kind: 'embarked', convoy };
    state.convoys[convoy] = {
      id: convoy,
      owner: rome,
      position: WESTERN_SEA,
      armies: [roman.id],
      waypoints: [west(WESTERN_SEA, 50)],
    };
    const sea = sightOf(state, world, rome);
    expect(sea.sees(west(WESTERN_SEA, SIGHT_KM.convoy - 0.5))).toBe(true);
    expect(sea.sees(west(WESTERN_SEA, SIGHT_KM.convoy + 0.5))).toBe(false);
    expect(sea.sees(PERSIA)).toBe(false);

    const province = sightOf(state, world, rome);
    expect(province.sees(CALABRIA)).toBe(true);
    expect(province.sees({ x: CALABRIA.x + 60, y: CALABRIA.y })).toBe(false);
    expectConsistent(state);
  });

  test('it is fast enough for every refresh on the new game with every army marching', () => {
    const state = game();
    const capitals = ['roma', 'carthago', 'pella', 'alexandria', 'persepolis'];
    for (const [i, army] of Object.values(state.armies).entries()) {
      if (army.activity.kind !== 'idle') continue;
      const from = army.activity.position;
      const to = state.cities[capitals[(i + 1) % capitals.length] as CityId]?.position;
      if (to) startMarch(world, army, from, to);
    }
    const marching = Object.values(state.armies).filter((a) => a.activity.kind === 'marching');
    expect(marching.length).toBe(Object.keys(state.armies).length);
    for (let i = 0; i < 50; i++) sightOf(state, world, rome);
    const times: number[] = [];
    for (let i = 0; i < 500; i++) {
      const started = performance.now();
      const sight = sightOf(state, world, rome);
      sight.sees(PERSIA);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? NaN;
    console.log(
      `sightOf on the new game with ${marching.length} armies marching: median ${(median * 1000).toFixed(0)} µs, p99 ${((times[Math.floor(times.length * 0.99)] ?? NaN) * 1000).toFixed(0)} µs`,
    );
    expect(median).toBeLessThan(2);
    expectConsistent(state);
  });
});
