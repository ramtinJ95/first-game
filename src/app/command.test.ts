import { describe, expect, it } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import type { ArmyId, CityId } from '../sim/ids.ts';
import { newGame } from '../sim/new-game.ts';
import type { Order } from '../sim/orders/orders.ts';
import { expectConsistent } from '../sim/references.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import type { World } from '../sim/world/world.ts';
import { planCommand, plannedRoutes, route, type CommandTarget } from './command.ts';

const world = fixtureWorld();
const f = FIXTURE;

function cityOf(state: GameState, id: CityId) {
  const city = state.cities[id];
  if (!city) throw new Error(`no city ${id}`);
  return city;
}

function armyOf(state: GameState, id: ArmyId = f.romanArmy) {
  const army = state.armies[id];
  if (!army) throw new Error(`no army ${id}`);
  return army;
}

function plan(state: GameState, target: CommandTarget, army = f.romanArmy, on: World = world) {
  return planCommand(state, on, armyOf(state, army), target);
}

const atCity = (state: GameState, id: CityId): CommandTarget => ({
  kind: 'city',
  city: cityOf(state, id),
});
const atPoint = (point: MapPoint): CommandTarget => ({ kind: 'point', point });

/** Plays the order, then days without orders until the army no longer marches or sails. */
function playOut(state: GameState, order: Order, army: ArmyId = f.romanArmy) {
  let current = tick(state, [order], world).state;
  let days = 1;
  for (; days < 400; days++) {
    const { kind } = armyOf(current, army).activity;
    if (kind !== 'marching' && kind !== 'embarked') break;
    current = tick(current, [], world).state;
  }
  expectConsistent(current);
  return { state: current, days };
}

function daysOf(detail: string): number {
  const days = /^(\d+) days?$/.exec(detail)?.[1];
  if (!days) throw new Error(`no days in "${detail}"`);
  return Number(days);
}

describe('a right click on a city', () => {
  it('marches to an enemy city with no notice, and the army besieges it on arrival', () => {
    const state = buildFixture();
    changeCityOwner(state, f.capua, f.carthage);
    state.wars[warKey(f.rome, f.carthage)] = { since: state.day };
    const capua = cityOf(state, f.capua);

    const planned = plan(state, atCity(state, f.capua));
    expect(planned).toEqual({
      kind: 'issue',
      order: { kind: 'moveArmy', faction: f.rome, army: f.romanArmy, to: capua.position },
    });
    if (planned.kind !== 'issue') return;
    const { activity } = armyOf(playOut(state, planned.order).state);
    expect(activity.kind).toBe('besieging');
  });

  it('marches to a foreign city at peace and says that a siege needs a war', () => {
    const state = buildFixture();
    changeCityOwner(state, f.capua, f.carthage);

    const planned = plan(state, atCity(state, f.capua));
    expect(planned).toMatchObject({
      kind: 'issue',
      notice: 'At peace with Carthage. Declare war to besiege it.',
    });
    if (planned.kind !== 'issue') return;
    expect(armyOf(playOut(state, planned.order).state).activity.kind).toBe('idle');
  });

  it("names a minor by its city's name when at peace with it", () => {
    const state = buildFixture();
    armyOf(state).activity = { kind: 'idle', position: { x: 2641.2, y: 2911.3 } };
    expect(plan(state, atCity(state, f.syracusae))).toMatchObject({
      kind: 'issue',
      notice: 'At peace with Syracusae. Declare war to besiege it.',
    });
  });

  it('marches to its own city with no notice', () => {
    const state = buildFixture();
    expect(plan(state, atCity(state, f.capua))).toEqual({
      kind: 'issue',
      order: {
        kind: 'moveArmy',
        faction: f.rome,
        army: f.romanArmy,
        to: cityOf(state, f.capua).position,
      },
    });
  });

  it('names the city when no land route reaches it', () => {
    const state = buildFixture();
    armyOf(state).activity = { kind: 'idle', position: { ...cityOf(state, f.capua).position } };
    expect(plan(state, atCity(state, f.syracusae))).toEqual({
      kind: 'refuse',
      notice: 'Order refused. No land route reaches Syracusae.',
    });
  });
});

describe('a right click on a point', () => {
  it('marches to a point on land', () => {
    const state = buildFixture();
    const to = { x: 2561, y: 2336 };
    expect(plan(state, atPoint(to))).toEqual({
      kind: 'issue',
      order: { kind: 'moveArmy', faction: f.rome, army: f.romanArmy, to },
    });
  });

  it('refuses at once, in words, a point in the sea or off the map', () => {
    const state = buildFixture();
    expect(plan(state, atPoint({ x: 2400, y: 2500 }))).toEqual({
      kind: 'refuse',
      notice: 'Order refused. The destination is in the sea.',
    });
    expect(plan(state, atPoint({ x: -50, y: -50 }))).toEqual({
      kind: 'refuse',
      notice: 'Order refused. The destination is off the map.',
    });
  });

  it('refuses at once an army that is in a battle', () => {
    let state = newGame(world.map, { seed: 1, player: 'rome' });
    const [romans, punic] = [f.rome, f.carthage].map((owner) =>
      Object.values(state.armies).find((army) => army.owner === owner),
    );
    if (!romans || !punic || romans.activity.kind !== 'idle') throw new Error('no armies');
    const { x, y } = romans.activity.position;
    punic.activity = { kind: 'idle', position: { x: x + 5, y } };
    state.wars[warKey(f.rome, f.carthage)] = { since: state.day };
    state = tick(state, [], world).state;
    expect(armyOf(state, romans.id).activity.kind).toBe('inBattle');

    expect(plan(state, atPoint({ x: 2561, y: 2336 }), romans.id)).toEqual({
      kind: 'refuse',
      notice: 'Order refused. The army is in the battle and must retreat first.',
    });
  });
});

describe('a right click on a port from a port', () => {
  it('offers only the sea to a port no land route reaches, with the days the crossing takes', () => {
    const state = buildFixture();
    const planned = plan(state, atCity(state, f.syracusae));
    expect(planned).toMatchObject({
      kind: 'menu',
      menu: {
        title: 'Orders for Syracusae',
        options: [
          {
            group: 'sea',
            label: 'Sail from Roma to Syracusae',
            order: { kind: 'embark', faction: f.rome, army: f.romanArmy, to: f.syracusae },
          },
        ],
      },
      notice: 'At peace with Syracusae. Declare war to besiege it.',
    });
    if (planned.kind !== 'menu') return;
    expect(planned.menu.options).toHaveLength(1);
    const [sail] = planned.menu.options;
    if (!sail) return;
    expect(playOut(state, sail.order).days).toBe(daysOf(sail.detail));
  });

  it('offers both ways to a port that a land route also reaches, each with its days', () => {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    const romans = Object.values(state.armies).find((army) => army.owner === state.player);
    if (!romans) throw new Error('no Roman army');
    const planned = plan(state, atCity(state, 'salona' as CityId), romans.id);
    if (planned.kind !== 'menu') throw new Error(`expected a menu, got ${planned.kind}`);
    expect(planned.menu.title).toBe('Orders for Salona');
    expect(planned.menu.options.map(({ group, label }) => [group, label])).toEqual([
      ['sea', 'Sail from Roma to Salona'],
      ['land', 'March to Salona'],
    ]);
    for (const option of planned.menu.options) {
      expect(playOut(state, option.order, romans.id).days).toBe(daysOf(option.detail));
    }
  });

  it('refuses a port that neither the sea nor the land reaches', () => {
    const state = buildFixture();
    const inland = { x: 2641.2, y: 2911.3 };
    const lake: World = { ...world, harbours: new Map(world.harbours).set(f.syracusae, inland) };
    expect(plan(state, atCity(state, f.syracusae), f.romanArmy, lake)).toEqual({
      kind: 'refuse',
      notice: 'Order refused. No way by sea or by land leads from Roma to Syracusae.',
    });
  });

  it('marches into the port the army already stands at', () => {
    const state = buildFixture();
    expect(plan(state, atCity(state, f.roma))).toMatchObject({
      kind: 'issue',
      order: { kind: 'moveArmy', to: cityOf(state, f.roma).position },
    });
  });

  it('marches without a menu when the army stands at no port of its own', () => {
    const state = buildFixture();
    changeCityOwner(state, f.roma, f.carthage);
    expect(plan(state, atCity(state, f.carthago))).toMatchObject({
      kind: 'issue',
      order: { kind: 'moveArmy', to: cityOf(state, f.carthago).position },
    });
  });
});

describe('route', () => {
  it('runs a waiting march from the army to its destination, and a crossing by the harbours', () => {
    const state = buildFixture();
    const at = armyOf(state).activity;
    if (at.kind !== 'idle') throw new Error('the Roman army should start idle');
    const capua = cityOf(state, f.capua).position;
    const march = route(state, world, {
      kind: 'moveArmy',
      faction: f.rome,
      army: f.romanArmy,
      to: capua,
    });
    if (typeof march === 'string') throw new Error(march);
    expect([march.path[0], march.path.at(-1)]).toEqual([at.position, capua]);

    const sail = route(state, world, {
      kind: 'embark',
      faction: f.rome,
      army: f.romanArmy,
      to: f.carthago,
    });
    if (typeof sail === 'string') throw new Error(sail);
    expect([sail.path[0], sail.path[1], sail.path.at(-1)]).toEqual([
      at.position,
      world.harbours.get(f.roma),
      world.harbours.get(f.carthago),
    ]);
  });
});

describe('plannedRoutes', () => {
  it('draws only the waiting order of an army already marching, and hides its old march', () => {
    const state = buildFixture();
    const roma = cityOf(state, f.roma).position;
    const capua = cityOf(state, f.capua).position;
    const marching = tick(
      state,
      [{ kind: 'moveArmy', faction: f.rome, army: f.romanArmy, to: capua }],
      world,
    ).state;
    expect(armyOf(marching).activity.kind).toBe('marching');
    const back: Order = {
      kind: 'moveArmy',
      faction: f.rome,
      army: f.romanArmy,
      to: { x: roma.x, y: roma.y },
    };
    const { paths, replaced } = plannedRoutes(marching, world, [back]);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.at(-1)).toEqual({ x: roma.x, y: roma.y });
    expect([...replaced]).toEqual([f.romanArmy]);
    expectConsistent(marching);
  });

  it('hides the march of an army whose halt waits, and leaves other armies alone', () => {
    const state = buildFixture();
    const capua = cityOf(state, f.capua).position;
    const marching = tick(
      state,
      [{ kind: 'moveArmy', faction: f.rome, army: f.romanArmy, to: capua }],
      world,
    ).state;
    const halt: Order = { kind: 'halt', faction: f.rome, army: f.romanArmy };
    expect(plannedRoutes(marching, world, [halt])).toEqual({
      paths: [],
      replaced: new Set([f.romanArmy]),
    });
    expect(plannedRoutes(marching, world, []).replaced.size).toBe(0);
    expectConsistent(marching);
  });
});
