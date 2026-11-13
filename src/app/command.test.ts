import { describe, expect, it } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import type { ArmyId, CityId, FactionId } from '../sim/ids.ts';
import { newGame } from '../sim/new-game.ts';
import { MAX_MARCH_DAYS } from '../sim/march.ts';
import { GATHER_DAYS } from '../sim/orders/embark.ts';
import type { Order } from '../sim/orders/orders.ts';
import { expectConsistent } from '../sim/references.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import type { World } from '../sim/world/world.ts';
import { FAR_LONGER, planCommand, plannedRoutes, route, type CommandTarget } from './command.ts';
import { placeName } from './names.ts';

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

/** The days of every leg in a menu line, summed. */
function daysOf(detail: string): number {
  const days = [...detail.matchAll(/(\d+) days?/g)].map((match) => Number(match[1]));
  if (days.length === 0) throw new Error(`no days in "${detail}"`);
  return days.reduce((sum, n) => sum + n, 0);
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

  it('offers the march to the shore and the days that gather ships there when no port of its own sails near and no land route reaches the city', () => {
    const state = buildFixture();
    changeCityOwner(state, f.roma, f.carthage);
    armyOf(state).activity = { kind: 'idle', position: { ...cityOf(state, f.capua).position } };
    const planned = plan(state, atCity(state, f.syracusae));
    if (planned.kind !== 'menu') throw new Error(`expected a menu, got ${planned.kind}`);
    expect(planned.menu.options).toMatchObject([
      {
        group: 'sea',
        label: 'March to the shore near Capua to sail for Syracusae',
        detail: expect.stringMatching(
          new RegExp(
            `^\\d+ days? to the shore, then ${GATHER_DAYS} days to gather ships, then \\d+ days by sea$`,
          ),
        ),
        order: { kind: 'moveArmy' },
      },
    ]);
  });

  it('offers the march to a port of its own and the crossing when no land route reaches the city', () => {
    const state = buildFixture();
    armyOf(state).activity = { kind: 'idle', position: { x: 2545, y: 2330 } };
    const planned = plan(state, atCity(state, f.syracusae));
    if (planned.kind !== 'menu') throw new Error(`expected a menu, got ${planned.kind}`);
    expect(planned.menu.options).toMatchObject([
      {
        group: 'sea',
        label: 'March to Roma to sail for Syracusae',
        detail: expect.stringMatching(/^\d+ days? to the port, then \d+ days by sea$/),
        order: { kind: 'moveArmy', to: cityOf(state, f.roma).position },
      },
    ]);
  });

  it('Carthage to Capua by way of Roma: one order sails, lands, and marches on to Capua in the days the menu gave', () => {
    const state = buildFixture();
    armyOf(state, f.punicArmy).activity = {
      kind: 'idle',
      position: { ...cityOf(state, f.carthago).position },
    };
    const capua = cityOf(state, f.capua).position;
    const planned = plan(state, atCity(state, f.capua), f.punicArmy);
    if (planned.kind !== 'menu') throw new Error(`expected a menu, got ${planned.kind}`);
    expect(planned.menu.title).toBe('Orders for Capua');
    expect(planned.menu.options).toMatchObject([
      {
        group: 'sea',
        label: 'Sail from Carthago to Roma',
        order: { kind: 'embark', army: f.punicArmy, to: f.roma, then: capua },
      },
    ]);
    const [sail] = planned.menu.options;
    const [, atSea, ashore] =
      /^(\d+) days by sea, then (\d+) days by land$/.exec(sail?.detail ?? '') ?? [];
    if (!sail || !atSea || !ashore) throw new Error(`no legs in "${sail?.detail}"`);
    let current = tick(state, [sail.order], world).state;
    let days = 1;
    while (armyOf(current, f.punicArmy).activity.kind === 'embarked') {
      current = tick(current, [], world).state;
      days++;
    }
    expect(days).toBe(Number(atSea));
    while (armyOf(current, f.punicArmy).activity.kind === 'marching') {
      const { activity } = armyOf(current, f.punicArmy);
      expect(activity.kind === 'marching' && activity.waypoints.at(-1)).toEqual(capua);
      current = tick(current, [], world).state;
      days++;
    }
    expect(days).toBe(Number(atSea) + Number(ashore));
    expect(armyOf(current, f.punicArmy).activity).toEqual({ kind: 'idle', position: capua });
    expectConsistent(current);
  });

  it('opens the menu, and drops the march, when the march takes more than FAR_LONGER times the way by sea', () => {
    const state = newGame(world.map, { seed: 1, player: 'egypt' });
    const egyptians = Object.values(state.armies).find((army) => army.owner === state.player);
    if (!egyptians) throw new Error('no Egyptian army');
    egyptians.activity = {
      kind: 'idle',
      position: { ...cityOf(state, 'alexandria' as CityId).position },
    };
    const pergamon = atCity(state, 'pergamon' as CityId);
    const march = route(state, world, {
      kind: 'moveArmy',
      faction: egyptians.owner,
      army: egyptians.id,
      to: cityOf(state, 'pergamon' as CityId).position,
    });
    if (typeof march === 'string') throw new Error(march);
    expect(march.days).toBeLessThanOrEqual(MAX_MARCH_DAYS);
    const planned = plan(state, pergamon, egyptians.id);
    if (planned.kind !== 'menu') throw new Error(`expected a menu, got ${planned.kind}`);
    expect(planned.menu.options).toHaveLength(1);
    const [sail] = planned.menu.options;
    expect(sail).toMatchObject({ group: 'sea', order: { kind: 'embark' } });
    const legs = (sail?.detail.match(/\d+/g) ?? []).map(Number);
    expect(march.days).toBeGreaterThan(FAR_LONGER * legs.reduce((a, b) => a + b, 0));
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

  it('offers both ways to a port that a land route also reaches in about the same days, each with its days', () => {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    const romans = Object.values(state.armies).find((army) => army.owner === state.player);
    if (!romans) throw new Error('no Roman army');
    const planned = plan(state, atCity(state, 'massalia' as CityId), romans.id);
    if (planned.kind !== 'menu') throw new Error(`expected a menu, got ${planned.kind}`);
    expect(planned.menu.title).toBe('Orders for Massalia');
    expect(planned.menu.options.map(({ group, label }) => [group, label])).toEqual([
      ['sea', 'Sail from Roma to Massalia'],
      ['land', 'March to Massalia'],
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
    expect(plan(state, atCity(state, f.capua))).toMatchObject({
      kind: 'issue',
      order: { kind: 'moveArmy', to: cityOf(state, f.capua).position },
    });
  });

  it('marches without a menu to a port that the sea reaches only in more than FAR_LONGER times the days', () => {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    const romans = Object.values(state.armies).find((army) => army.owner === state.player);
    if (!romans) throw new Error('no Roman army');
    expect(plan(state, atCity(state, 'ariminum' as CityId), romans.id)).toMatchObject({
      kind: 'issue',
      order: { kind: 'moveArmy', to: cityOf(state, 'ariminum' as CityId).position },
    });
  });

  it('offers no march longer than MAX_MARCH_DAYS, only the crossing', () => {
    const state = buildFixture();
    const planned = plan(state, atCity(state, f.carthago));
    if (planned.kind !== 'menu') throw new Error(`expected a menu, got ${planned.kind}`);
    expect(planned.menu.options.map(({ group, label }) => [group, label])).toEqual([
      ['sea', 'Sail from Roma to Carthago'],
    ]);
  });

  it('refuses in words a march longer than MAX_MARCH_DAYS when no way by sea lands near the city', () => {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    const romans = Object.values(state.armies).find((army) => army.owner === state.player);
    if (!romans) throw new Error('no Roman army');
    const planned = plan(state, atCity(state, 'alexandria-arachosion' as CityId), romans.id);
    expect(planned).toMatchObject({ kind: 'refuse' });
    expect(planned.notice).toMatch(
      new RegExp(
        `^Order refused\\. The march to Alexandria Arachosion takes \\d+ days, more than the ${MAX_MARCH_DAYS} a march may take\\. No way by sea lands within ${MAX_MARCH_DAYS} days' march of it\\.$`,
      ),
    );
  });
});

describe('a way home from overseas', () => {
  it('Rome beaten at Carthago falls back into the field near Hadrumetum, and a right click on Roma sails it home', () => {
    let state = newGame(world.map, { seed: 1, player: 'rome' });
    const carthage = 'carthage' as FactionId;
    state.wars[warKey(f.rome, carthage)] = { since: state.day };
    const romans = Object.values(state.armies).find((army) => army.owner === f.rome);
    if (!romans) throw new Error('no Roman army');
    romans.activity = {
      kind: 'idle',
      position: { ...(world.harbours.get(f.carthago) as MapPoint) },
    };
    for (const army of Object.values(state.armies).filter((a) => a.owner === carthage)) {
      for (const id of army.formations) {
        const formation = state.formations[id];
        if (formation) formation.men *= 3;
      }
    }
    for (let day = 0; day < 60 && armyOf(state, romans.id).activity.kind !== 'retreating'; day++) {
      state = tick(state, [], world).state;
    }
    for (let day = 0; day < 60 && armyOf(state, romans.id).activity.kind !== 'idle'; day++) {
      state = tick(state, [], world).state;
    }
    const beaten = armyOf(state, romans.id).activity;
    if (beaten.kind !== 'idle') throw new Error(`the Roman army is ${beaten.kind}`);
    expect(placeName(state, beaten.position)).toBe('near Hadrumetum');

    const roma = atCity(state, f.roma);
    const planned = plan(state, roma, romans.id);
    if (planned.kind !== 'menu') throw new Error(`expected a menu, got "${planned.notice}"`);
    expect(planned.menu.options).toMatchObject([{ group: 'sea' }]);
    let current = state;
    for (let leg = 0; leg < 3; leg++) {
      const next = plan(current, roma, romans.id);
      const order =
        next.kind === 'menu'
          ? next.menu.options[0]?.order
          : next.kind === 'issue'
            ? next.order
            : undefined;
      if (!order) throw new Error(`no order home: "${next.notice}"`);
      current = playOut(current, order, romans.id).state;
      const { activity } = armyOf(current, romans.id);
      if (activity.kind === 'idle' && placeName(current, activity.position) === 'at Roma') break;
    }
    expect(armyOf(current, romans.id).activity).toEqual({
      kind: 'idle',
      position: cityOf(current, f.roma).position,
    });
  });
});

describe('a shore beside a port of its own', () => {
  it('offers the march to the port of its own when it sails sooner than ships gathered on the shore', () => {
    const state = buildFixture();
    armyOf(state, f.punicArmy).activity = { kind: 'idle', position: { x: 2225, y: 2960 } };
    const planned = plan(state, atCity(state, f.syracusae), f.punicArmy);
    if (planned.kind !== 'menu') throw new Error(`expected a menu, got ${planned.kind}`);
    expect(planned.menu.options).toMatchObject([
      {
        group: 'sea',
        label: 'March to Carthago to sail for Syracusae',
        order: { kind: 'moveArmy', to: cityOf(state, f.carthago).position },
      },
    ]);
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
