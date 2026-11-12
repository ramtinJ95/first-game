import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { CityId, FactionId, FormationId } from '../ids.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { OUTPUT_PER_PERSON, UPKEEP_PER_MAN } from '../systems/economy.ts';
import { removeRecord } from '../records.ts';
import { tick } from '../tick.ts';
import { decideAll, decideOrders } from './decide.ts';
import { MINOR_DEFICIT_DAYS } from './thresholds.ts';

const world = fixtureWorld();
const f = FIXTURE;

const ROMA = { x: 2511.3, y: 2335.8 };
const CAPUA = { x: 2638.8, y: 2448.3 };
/** Inland, between Capua and Roma, more than a siege distance from either. */
const BETWEEN = { x: 2575, y: 2392 };

function declare(state: GameState, faction: FactionId, against: FactionId) {
  expect(executeOrder(state, { kind: 'declareWar', faction, against }, world)).toBeUndefined();
}

function army(state: GameState, id: string) {
  const found = state.armies[id as never];
  if (!found) throw new Error(`no army ${id}`);
  return found;
}

function city(state: GameState, id: CityId) {
  const found = state.cities[id];
  if (!found) throw new Error(`no city ${id}`);
  return found;
}

function place(state: GameState, id: string, position: MapPoint) {
  army(state, id).activity = { kind: 'idle', position };
}

function setMen(state: GameState, id: FormationId, men: number) {
  const formation = state.formations[id];
  if (!formation) throw new Error(`no formation ${id}`);
  formation.men = men;
}

/** The faction's orders today, which the next tick must accept, leaving a consistent state. */
function decide(state: GameState, faction: FactionId): Order[] {
  const orders = decideOrders(state, world, faction);
  const result = tick(state, orders, world);
  expect(result.rejected).toEqual([]);
  expectConsistent(result.state);
  return orders;
}

function kinds(orders: readonly Order[]) {
  return orders.map((order) => order.kind);
}

function only<K extends Order['kind']>(orders: readonly Order[], kind: K) {
  return orders.filter((order) => order.kind === kind);
}

/** Rome can pay for more men: its cities earn far more than its army costs. */
function richRome(): GameState {
  const state = buildFixture();
  city(state, f.roma).population = 200_000;
  const rome = state.factions[f.rome];
  if (rome) rome.stores.food = 5000;
  return state;
}

describe('the decision function', () => {
  test('reads a frozen state without changing it and gives the same orders twice', () => {
    const state = buildFixture();
    declare(state, f.carthage, f.rome);
    declare(state, f.rome, f.syracusaeFaction);
    place(state, f.punicArmy, { x: CAPUA.x + 3, y: CAPUA.y });
    const besieged = tick(state, [], world).state;
    const before = JSON.stringify(besieged);
    const frozen = deepFreeze(JSON.parse(before) as GameState);
    const first = decideAll(frozen, world, []);
    expect(first.length).toBeGreaterThan(0);
    expect(JSON.stringify(frozen)).toBe(before);
    expect(decideAll(frozen, world, [])).toEqual(first);
  });

  test("leaves out the player's faction and every defeated faction", () => {
    const state = richRome();
    city(state, f.carthago).population = 200_000;
    const carthage = state.factions[f.carthage];
    if (!carthage) throw new Error('no Carthage');
    expect(decideAll(state, world).every((order) => order.faction !== f.rome)).toBe(true);
    expect(decideAll(state, world).some((order) => order.faction === f.carthage)).toBe(true);
    carthage.defeatedOn = 1 as Day;
    expect(decideAll(state, world)).toEqual([]);
  });
});

describe('a great power', () => {
  describe('budget', () => {
    test('raises a troop when the balance after its upkeep stays positive and gold covers the reserve', () => {
      expect(only(decide(richRome(), f.rome), 'recruit')).toEqual([
        { kind: 'recruit', faction: f.rome, city: f.roma, troop: 'swordsmen' },
      ]);
    });

    test('raises nothing when the new upkeep would turn the daily balance negative', () => {
      const state = buildFixture();
      const rome = state.factions[f.rome];
      if (!rome) throw new Error('no Rome');
      rome.stores = { gold: 100_000, food: 100_000, manpower: 100_000 };
      expect(only(decide(state, f.rome), 'recruit')).toEqual([]);
    });

    test('raises nothing when paying would take gold below the reserve', () => {
      const state = richRome();
      const rome = state.factions[f.rome];
      if (!rome) throw new Error('no Rome');
      rome.stores.gold = 4000;
      expect(only(decide(state, f.rome), 'recruit')).toEqual([]);
    });
  });

  test('raises a mix of troops, and while no target is in its power they muster into the army waiting at the city', () => {
    let state = richRome();
    const rome = state.factions[f.rome];
    if (!rome) throw new Error('no Rome');
    rome.stores = { gold: 200_000, food: 200_000, manpower: 20_000 };
    declare(state, f.carthage, f.rome);
    setMen(state, f.citizenSpears, 50_000);
    const raised = new Set<string>();
    for (let day = 0; day < 60; day++) {
      const orders = decideOrders(state, world, f.rome);
      for (const order of orders) if (order.kind === 'recruit') raised.add(order.troop);
      const result = tick(state, orders, world);
      expect(result.rejected).toEqual([]);
      state = result.state;
    }
    expectConsistent(state);
    expect(raised.size).toBeGreaterThanOrEqual(4);
    const romanArmies = Object.values(state.armies).filter((a) => a.owner === f.rome);
    expect(romanArmies).toHaveLength(1);
    expect(romanArmies[0]?.formations.length).toBeGreaterThan(4);
  });

  describe('war', () => {
    test('declares war on the neighbour it is strong enough to beat', () => {
      expect(decide(buildFixture(), f.rome)).toEqual([
        { kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction },
      ]);
    });

    test('does not open a second front while its war with a strong enemy takes its strength', () => {
      const state = buildFixture();
      declare(state, f.carthage, f.rome);
      place(state, f.punicArmy, { x: 2229.9, y: 2865.1 });
      expect(kinds(decide(state, f.rome))).not.toContain('declareWar');
    });

    test('declares nothing against a neighbour stronger than the threshold allows', () => {
      const state = buildFixture();
      setMen(state, f.hastati, 200);
      setMen(state, f.equites, 50);
      expect(only(decide(state, f.rome), 'declareWar')).toEqual([]);
    });
  });

  describe('offence', () => {
    test('marches on an enemy city it can reach by land', () => {
      const state = buildFixture();
      declare(state, f.rome, f.carthage);
      city(state, f.capua).owner = f.carthage;
      expect(decide(state, f.rome)).toContainEqual({
        kind: 'moveArmy',
        faction: f.rome,
        army: f.romanArmy,
        to: CAPUA,
      });
    });

    test('embarks at its port for an enemy city across the sea', () => {
      const state = buildFixture();
      declare(state, f.rome, f.syracusaeFaction);
      expect(decide(state, f.rome)).toContainEqual({
        kind: 'embark',
        faction: f.rome,
        army: f.romanArmy,
        to: f.syracusae,
      });
    });

    test('storms a city when the storm is near certain and cheap, and besieges a strong one', () => {
      const weak = besieging(f.syracusae);
      expect(decide(weak, f.rome)).toContainEqual({
        kind: 'storm',
        faction: f.rome,
        city: f.syracusae,
      });
      const strong = besieging(f.carthago);
      expect(kinds(decide(strong, f.rome))).not.toContain('storm');
    });

    test('sacks a city it took while short of gold, enslaves it while short of men, else occupies it', () => {
      const fate = (gold: number, manpower: number) => {
        const state = buildFixture();
        const syracusae = city(state, f.syracusae);
        syracusae.owner = f.rome;
        syracusae.fellOn = state.day;
        place(state, f.romanArmy, syracusae.position);
        const rome = state.factions[f.rome];
        if (!rome) throw new Error('no Rome');
        rome.stores = { gold, food: 5000, manpower };
        return decide(state, f.rome).filter((o) => o.kind === 'sack' || o.kind === 'enslave');
      };
      expect(kinds(fate(100, 5000))).toEqual(['sack']);
      expect(kinds(fate(5000, 200))).toEqual(['enslave']);
      expect(fate(5000, 5000)).toEqual([]);
    });
  });

  describe('defence', () => {
    test('marches to relieve its besieged city when it is the stronger', () => {
      const state = capuaBesieged(500);
      expect(decide(state, f.rome)).toContainEqual({
        kind: 'moveArmy',
        faction: f.rome,
        army: f.romanArmy,
        to: CAPUA,
      });
    });

    test('leaves a siege by a stronger army alone', () => {
      const state = capuaBesieged(6000);
      expect(only(decide(state, f.rome), 'moveArmy')).not.toContainEqual(
        expect.objectContaining({ to: CAPUA }),
      );
    });

    test('retreats from a battle it is losing and fights one it is winning', () => {
      const battle = (punicMen: number) => {
        const state = buildFixture();
        declare(state, f.carthage, f.rome);
        place(state, f.romanArmy, BETWEEN);
        place(state, f.punicArmy, { x: BETWEEN.x + 5, y: BETWEEN.y });
        setMen(state, f.citizenSpears, punicMen);
        const fighting = tick(state, [], world).state;
        expect(army(fighting, f.romanArmy).activity.kind).toBe('inBattle');
        return kinds(decide(fighting, f.rome));
      };
      expect(battle(3000)).toContain('retreat');
      expect(battle(1000)).not.toContain('retreat');
    });

    test('keeps an army at the capital while an enemy army marches near it', () => {
      const state = buildFixture();
      declare(state, f.rome, f.carthage);
      city(state, f.capua).owner = f.carthage;
      place(state, f.punicArmy, BETWEEN);
      army(state, f.punicArmy).activity = {
        kind: 'marching',
        position: { x: ROMA.x + 60, y: ROMA.y },
        waypoints: [ROMA],
      };
      expect(kinds(decide(state, f.rome))).not.toContain('moveArmy');
    });

    test('sends an army home to the capital when an enemy army comes near it', () => {
      const state = buildFixture();
      declare(state, f.rome, f.carthage);
      place(state, f.romanArmy, BETWEEN);
      army(state, f.punicArmy).activity = {
        kind: 'marching',
        position: { x: ROMA.x - 40, y: ROMA.y + 20 },
        waypoints: [ROMA],
      };
      expect(decide(state, f.rome)).toContainEqual({
        kind: 'moveArmy',
        faction: f.rome,
        army: f.romanArmy,
        to: ROMA,
      });
    });
  });

  describe('each order once', () => {
    test('gives no new order to an army already marching to its target', () => {
      const state = buildFixture();
      declare(state, f.rome, f.carthage);
      city(state, f.capua).owner = f.carthage;
      const marching = tick(state, decideOrders(state, world, f.rome), world).state;
      expect(army(marching, f.romanArmy).activity.kind).toBe('marching');
      expect(decide(marching, f.rome)).toEqual([]);
    });

    test('gives no order to an army that besieges, and decides again once the siege ends', () => {
      const state = besieging(f.carthago);
      expect(decide(state, f.rome)).toEqual([]);
      const captured = besieging(f.carthago);
      const carthago = city(captured, f.carthago);
      carthago.owner = f.rome;
      for (const siege of Object.values(captured.sieges)) removeRecord(captured.sieges, siege.id);
      place(captured, f.romanArmy, carthago.position);
      city(captured, f.capua).owner = f.carthage;
      expect(kinds(decide(captured, f.rome))).toContain('moveArmy');
    });
  });
});

describe('a minor', () => {
  function syracusaeAtWar(): GameState {
    const state = buildFixture();
    declare(state, f.rome, f.syracusaeFaction);
    const minor = state.factions[f.syracusaeFaction];
    if (!minor) throw new Error('no Syracusae');
    const deficit =
      500 * UPKEEP_PER_MAN.gold - city(state, f.syracusae).population * OUTPUT_PER_PERSON.gold;
    minor.stores = {
      gold: 900 + deficit * MINOR_DEFICIT_DAYS,
      food: deficit * MINOR_DEFICIT_DAYS,
      manpower: 500,
    };
    return state;
  }

  test('gives no orders at peace and never declares war', () => {
    const state = buildFixture();
    const minor = state.factions[f.syracusaeFaction];
    if (!minor) throw new Error('no Syracusae');
    minor.stores = { gold: 100_000, food: 100_000, manpower: 100_000 };
    expect(decide(state, f.syracusaeFaction)).toEqual([]);
  });

  test('at war, raises its cheapest troop when gold covers the cost and gold and food a year of the deficit', () => {
    const state = syracusaeAtWar();
    expect(decide(state, f.syracusaeFaction)).toEqual([
      { kind: 'recruit', faction: f.syracusaeFaction, city: f.syracusae, troop: 'skirmishers' },
    ]);
    const minor = state.factions[f.syracusaeFaction];
    if (!minor) throw new Error('no Syracusae');
    minor.stores.gold -= 1;
    expect(decide(state, f.syracusaeFaction)).toEqual([]);
    minor.stores.gold += 1;
    minor.stores.food -= 1;
    expect(decide(state, f.syracusaeFaction)).toEqual([]);
  });

  test('at war, brings an army that stands away back to its city', () => {
    const state = syracusaeAtWar();
    const minor = state.factions[f.syracusaeFaction];
    if (minor) minor.stores.gold = 0;
    const id = 'army-syracusan' as never;
    state.armies[id] = {
      id,
      owner: f.syracusaeFaction,
      formations: [f.citizenSpears],
      stance: 'holdTheLine',
      generalSkill: 0,
      activity: { kind: 'idle', position: { x: 2600, y: 2900 } },
    };
    const punic = army(state, f.punicArmy);
    punic.formations = [];
    const spears = state.formations[f.citizenSpears];
    if (spears) spears.army = id;
    removeRecord(state.armies, f.punicArmy);
    expect(decide(state, f.syracusaeFaction)).toEqual([
      { kind: 'moveArmy', faction: f.syracusaeFaction, army: id, to: { x: 2661.2, y: 2911.3 } },
    ]);
  });
});

/** Rome's army besieges the city, which Carthage or Syracusae holds, and Rome is at war with its owner. */
function besieging(target: CityId): GameState {
  const state = buildFixture();
  const owner = city(state, target).owner;
  declare(state, f.rome, owner);
  place(state, f.romanArmy, city(state, target).position);
  if (owner === f.carthage) place(state, f.punicArmy, CAPUA);
  const besieged = tick(state, [], world).state;
  expect(army(besieged, f.romanArmy).activity.kind).toBe('besieging');
  return besieged;
}

/** Carthage's army of this many men besieges Capua while Rome's army stands at Roma. */
function capuaBesieged(men: number): GameState {
  const state = buildFixture();
  declare(state, f.carthage, f.rome);
  setMen(state, f.citizenSpears, men);
  place(state, f.punicArmy, { x: CAPUA.x + 3, y: CAPUA.y });
  const besieged = tick(state, [], world).state;
  expect(army(besieged, f.punicArmy).activity.kind).toBe('besieging');
  return besieged;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}
