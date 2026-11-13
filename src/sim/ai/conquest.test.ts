import { describe, expect, test } from 'vitest';
import { fixtureWorld } from '../fixture.ts';
import { allocateId, type ArmyId, type CityId, type FactionId } from '../ids.ts';
import { newGame } from '../new-game.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { removeRecord } from '../records.ts';
import { expectConsistent } from '../references.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { tick } from '../tick.ts';
import { distance } from '../world/find-path.ts';
import { decideOrders } from './decide.ts';
import { createRouter } from './routes.ts';
import { byLand } from './situation.ts';

const world = fixtureWorld();
const rome = 'rome' as FactionId;

function addArmy(state: GameState, owner: FactionId, men: number, at: MapPoint): ArmyId {
  const id = allocateId(state, 'army');
  const formation = allocateId(state, 'formation');
  state.formations[formation] = { id: formation, army: id, troop: 'spearmen', men, morale: 1 };
  state.armies[id] = {
    id,
    owner,
    formations: [formation],
    stance: 'holdTheLine',
    generalSkill: 3,
    activity: { kind: 'idle', position: { ...at } },
  };
  return id;
}

function cityOf(state: GameState, faction: FactionId): City {
  const city = Object.values(state.cities).find((c) => c.owner === faction);
  if (!city) throw new Error(`${faction} holds no city`);
  return city;
}

/** Rome at war with the minor nearest Roma by land, with every minor army gone. */
function war() {
  const state = newGame(world.map, { seed: 1, player: 'rome' });
  const roma = cityOf(state, rome);
  const [target] = Object.values(state.cities)
    .filter(
      (city) =>
        state.factions[city.owner]?.kind === 'minor' && byLand(world, roma.position, city.position),
    )
    .sort((a, b) => distance(a.position, roma.position) - distance(b.position, roma.position));
  if (!target) throw new Error('no minor city by land from Roma');
  for (const army of Object.values(state.armies)) {
    for (const id of army.formations) removeRecord(state.formations, id);
    removeRecord(state.armies, army.id);
  }
  Object.assign(target, { garrison: 1200, walls: 100, foodDays: 40 });
  expect(
    executeOrder(state, { kind: 'declareWar', faction: rome, against: target.owner }, world),
  ).toBeUndefined();
  const far = Object.values(state.cities)
    .filter((city) => city.owner === rome)
    .sort(
      (a, b) => distance(b.position, target.position) - distance(a.position, target.position),
    )[0];
  if (!far) throw new Error('rome holds no city');
  return { state, target, far };
}
describe('a league of minor cities', () => {
  /** The first league, in id order, whose two cities a land route joins. */
  function leagued() {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    const first = Object.values(state.factions)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .find(
        (f) =>
          f.league != null &&
          byLand(world, cityOf(state, f.id).position, cityOf(state, f.league).position),
      );
    const partner = first?.league ? state.factions[first.league] : undefined;
    if (!first || !partner) throw new Error('the new game has no league by land');
    return { state, first: first.id, partner: partner.id };
  }

  test('a minor joins the war on its league partner', () => {
    const { state, first, partner } = leagued();
    expect(executeOrder(state, { kind: 'declareWar', faction: rome, against: first }, world)).toBeUndefined();
    expect(decideOrders(state, world, partner)).toContainEqual({
      kind: 'declareWar',
      faction: partner,
      against: rome,
    });
    expectConsistent(state);
  });

  test("a minor marches to lift the siege of its partner's city", () => {
    const { state, first, partner } = leagued();
    for (const id of [first, partner]) {
      expect(executeOrder(state, { kind: 'declareWar', faction: rome, against: id }, world)).toBeUndefined();
    }
    const besieged = cityOf(state, first);
    const home = cityOf(state, partner);
    addArmy(state, rome, 2000, besieged.position);
    const relief = addArmy(state, partner, 500, home.position);
    const next = tick(state, [], world).state;
    expect(Object.values(next.sieges).some((siege) => siege.city === besieged.id)).toBe(true);
    const orders = decideOrders(next, world, partner);
    expect(orders).toContainEqual(
      expect.objectContaining({ kind: 'moveArmy', army: relief, to: besieged.position }),
    );
    expectConsistent(next);
  });
});

describe('a siege the attack can hold', () => {
  test('an army too few to blockade alone does not march ahead of the army that makes it enough', () => {
    const { state, target, far } = war();
    const near = { x: target.position.x + 30, y: target.position.y };
    expect(byLand(world, near, target.position)).toBe(true);
    const ahead = addArmy(state, rome, 400, near);
    addArmy(state, rome, 1700, far.position);
    const orders = decideOrders(state, world, rome);
    expect(orders).not.toContainEqual(
      expect.objectContaining({ kind: 'moveArmy', army: ahead, to: target.position }),
    );
    expectConsistent(state);
  });

  function waiting(extra?: { men: number; km: number }) {
    const { state, target } = war();
    const besiegers = addArmy(state, rome, 1000, target.position);
    const coming = addArmy(state, rome, 600, { x: target.position.x + 40, y: target.position.y });
    const orders: Order[] = [
      { kind: 'moveArmy', faction: rome, army: coming, to: target.position },
    ];
    if (extra) {
      const from = { x: target.position.x + extra.km, y: target.position.y };
      expect(byLand(world, from, target.position)).toBe(true);
      const late = addArmy(state, rome, extra.men, from);
      orders.push({ kind: 'moveArmy', faction: rome, army: late, to: target.position });
    }
    return { state: tick(state, orders, world).state, target, besiegers, coming };
  }

  test('a siege too weak to blockade waits for an army that arrives before sallies wear it down, and the two blockade the city', () => {
    const start = waiting();
    const { target, besiegers, coming } = start;
    let { state } = start;
    expect(state.armies[besiegers]?.activity.kind).toBe('besieging');
    for (let day = 0; day < 5; day++) {
      const orders = decideOrders(state, world, rome);
      expect(orders).not.toContainEqual(
        expect.objectContaining({ kind: 'moveArmy', army: besiegers }),
      );
      expect(orders).not.toContainEqual(
        expect.objectContaining({ kind: 'moveArmy', army: coming }),
      );
      state = tick(state, orders, world).state;
    }
    const siege = Object.values(state.sieges).find((s) => s.city === target.id);
    expect(siege?.besiegers).toEqual(expect.arrayContaining([besiegers, coming]));
    expectConsistent(state);
  });

  test('a far army on its way does not make a siege that is reinforced in time give up', () => {
    const { state, besiegers } = waiting({ men: 100, km: 400 });
    expect(decideOrders(state, world, rome)).not.toContainEqual(
      expect.objectContaining({ kind: 'moveArmy', army: besiegers }),
    );
    expectConsistent(state);
  });
});

describe('arrival by road, not by the straight line', () => {
  function marching(state: GameState, id: ArmyId, from: MapPoint, waypoints: MapPoint[]) {
    const army = state.armies[id];
    if (!army) throw new Error(`no army ${id}`);
    army.activity = { kind: 'marching', position: { ...from }, waypoints };
  }

  test('an army near the city in a straight line but far by road does not count as there first', () => {
    const { state, target, far } = war();
    const strong = addArmy(state, rome, 1700, far.position);
    const near = { x: target.position.x + 30, y: target.position.y };
    marching(state, strong, near, [{ ...far.position }, { ...target.position }]);
    const weak = addArmy(state, rome, 400, { x: target.position.x + 60, y: target.position.y });
    expect(decideOrders(state, world, rome)).not.toContainEqual(
      expect.objectContaining({ kind: 'moveArmy', army: weak, to: target.position }),
    );
    expectConsistent(state);
  });

  test('armies already marching together do not keep a course on which one arrives alone', () => {
    const { state, target, far } = war();
    const first = addArmy(state, rome, 400, target.position);
    marching(state, first, { x: target.position.x + 20, y: target.position.y }, [
      { ...target.position },
    ]);
    const last = addArmy(state, rome, 1300, far.position);
    marching(state, last, far.position, [{ ...target.position }]);
    const orders = decideOrders(state, world, rome);
    const forFirst = orders.filter((order) => order.kind === 'moveArmy' && order.army === first);
    expect(forFirst).toHaveLength(1);
    expect(forFirst[0]).not.toMatchObject({ to: target.position });
    expectConsistent(state);
  });

  test('a siege does not wait for an army that is sent today to relieve a city of its own', () => {
    const { state, target } = war();
    const besiegers = addArmy(state, rome, 1000, target.position);
    const coming = addArmy(state, rome, 600, target.position);
    marching(state, coming, { x: target.position.x + 40, y: target.position.y }, [
      { ...target.position },
    ]);
    const home = Object.values(state.cities)
      .filter((city) => city.owner === rome)
      .sort(
        (a, b) => distance(a.position, target.position) - distance(b.position, target.position),
      )[0];
    if (!home) throw new Error('rome holds no city');
    const raider = addArmy(state, target.owner, 200, home.position);
    const siegeAtHome = allocateId(state, 'siege');
    state.sieges[siegeAtHome] = {
      id: siegeAtHome,
      city: home.id,
      besiegers: [raider],
      startedOn: state.day,
    };
    const raiderArmy = state.armies[raider];
    if (raiderArmy) {
      raiderArmy.activity = {
        kind: 'besieging',
        position: { ...home.position },
        siege: siegeAtHome,
      };
    }
    const siegeAway = allocateId(state, 'siege');
    state.sieges[siegeAway] = {
      id: siegeAway,
      city: target.id,
      besiegers: [besiegers],
      startedOn: state.day,
    };
    const besiegerArmy = state.armies[besiegers];
    if (besiegerArmy) {
      besiegerArmy.activity = {
        kind: 'besieging',
        position: { ...target.position },
        siege: siegeAway,
      };
    }
    expectConsistent(state);
    const orders = decideOrders(state, world, rome);
    expect(orders).toContainEqual(
      expect.objectContaining({ kind: 'moveArmy', army: coming, to: home.position }),
    );
    expect(orders).toContainEqual(expect.objectContaining({ kind: 'moveArmy', army: besiegers }));
  });

  test('an army sent by sea does not count as there before an army that marches', () => {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    for (const army of Object.values(state.armies)) {
      for (const id of army.formations) removeRecord(state.formations, id);
      removeRecord(state.armies, army.id);
    }
    const salona = cityOf(state, 'salona' as FactionId);
    Object.assign(salona, { garrison: 1200, walls: 100, foodDays: 40 });
    expect(
      executeOrder(state, { kind: 'declareWar', faction: rome, against: salona.owner }, world),
    ).toBeUndefined();
    const router = createRouter(state, world, rome);
    const from = (id: string) => state.cities[id as CityId]?.position ?? salona.position;
    const sailing = router.routeTo(from('ariminum'), salona);
    const marching = router.routeTo(from('capua'), salona);
    expect(sailing?.step.kind).toBe('embark');
    expect(marching?.step.kind).toBe('march');
    expect(marching?.cost ?? 0).toBeGreaterThan(sailing?.cost ?? Number.POSITIVE_INFINITY);
    addArmy(state, rome, 1700, from('ariminum'));
    const weak = addArmy(state, rome, 400, from('capua'));
    const step = marching?.step.kind === 'march' ? marching.step.to : undefined;
    expect(decideOrders(state, world, rome)).not.toContainEqual(
      expect.objectContaining({ kind: 'moveArmy', army: weak, to: step }),
    );
    expectConsistent(state);
  });
});

describe('the strength a war holds back', () => {
  test("an enemy's garrison, which never leaves its walls, holds back none of a power's strength", () => {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    const roma = cityOf(state, rome);
    const [enemy] = Object.values(state.cities)
      .filter((city) => state.factions[city.owner]?.kind === 'minor')
      .sort((a, b) => distance(a.position, roma.position) - distance(b.position, roma.position));
    if (!enemy) throw new Error('no minor city');
    enemy.garrison = 9000;
    expect(
      executeOrder(state, { kind: 'declareWar', faction: rome, against: enemy.owner }, world),
    ).toBeUndefined();
    addArmy(state, rome, 6000, roma.position);
    const declared = decideOrders(state, world, rome).flatMap((order) =>
      order.kind === 'declareWar' ? [state.factions[order.against]?.kind] : [],
    );
    expect(declared).toEqual(['minor']);
    expectConsistent(state);
  });
});
