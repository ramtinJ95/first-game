import { describe, expect, test } from 'vitest';
import { buildingWorth } from './ai/build.ts';
import { buildRefusal } from './buildings/build.ts';
import { BUILDINGS, SIGNATURE_BUILDINGS, type BuildingKind } from './buildings/buildings.ts';
import { changeCityOwner, UNREST_DAYS } from './cities.ts';
import { buildFixture, FIXTURE as f, fixtureWorld, growRome } from './fixture.ts';
import { GUARD_GOLD } from './guards.ts';
import type { CityId, FactionId, ProvinceId } from './ids.ts';
import { POWERS, type PowerId } from './map.ts';
import { STARTING_GENERAL_SKILL } from './new-game.ts';
import { embarkationAt, GATHER_DAYS } from './orders/embark.ts';
import { executeOrder } from './orders/orders.ts';
import { removeRecord } from './records.ts';
import { expectConsistent } from './references.ts';
import type { GameState } from './state/game-state.ts';
import type { MapPoint } from './state/map-point.ts';
import { reforming } from './systems/battles.ts';
import { armyKmPerDay, travelDaysAlong } from './march.ts';
import { adminShareOf, dailyBalances, limitsOf, muster } from './systems/economy.ts';
import { movement } from './systems/movement.ts';
import { tick } from './tick.ts';
import { TROOPS } from './troops.ts';
import { distance } from './world/find-path.ts';
import { nearestSea } from './world/world.ts';

const world = fixtureWorld();
const power = (id: PowerId) => id as string as FactionId;

function need<T>(value: T | undefined, what = 'a record'): T {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/** The fixture with the great power in the game, holding the city, and gold enough for any building. */
function holding(id: PowerId, city: CityId = f.carthago): GameState {
  const state = buildFixture();
  const faction = power(id);
  if (!Object.hasOwn(state.factions, faction)) {
    const record = structuredClone(need(state.factions[f.carthage]));
    state.factions[faction] = { ...record, id: faction, name: id };
  }
  need(state.cities[city]).owner = faction;
  for (const record of Object.values(state.factions)) record.stores.gold = 50_000;
  return state;
}

function finish(state: GameState, city: CityId, kind: BuildingKind): void {
  need(state.cities[city]).buildings.push(kind);
}

describe("each great power's own building", () => {
  test.each(POWERS)('only %s may start its own building, in a city of its own', (own) => {
    const kind = SIGNATURE_BUILDINGS[own];
    const state = holding(own);
    expect(buildRefusal(state, need(state.cities[f.carthago]), kind)).toBeUndefined();
    for (const other of POWERS.filter((p) => p !== own)) {
      const theirs = holding(other);
      expect(buildRefusal(theirs, need(theirs.cities[f.carthago]), kind)).toBe(
        `a ${kind} is ${own}'s own building`,
      );
    }
  });

  test('a conqueror keeps the building that stands, but cannot start it again elsewhere', () => {
    const state = holding('carthage');
    finish(state, f.capua, 'colonia');
    changeCityOwner(state, f.capua, f.carthage);
    expect(need(state.cities[f.capua]).buildings).toContain('colonia');
    expect(buildRefusal(state, need(state.cities[f.carthago]), 'colonia')).toBe(
      "a colonia is rome's own building",
    );
    expectConsistent(state);
  });

  test("a Colonia halves the unrest of a city Rome takes within its reach, and only Rome's", () => {
    const state = holding('carthage', f.roma);
    changeCityOwner(state, f.roma, f.rome);
    expect(need(state.cities[f.roma]).unrestDays).toBe(UNREST_DAYS);

    const near = holding('carthage', f.roma);
    finish(near, f.capua, 'colonia');
    changeCityOwner(near, f.roma, f.rome);
    expect(need(near.cities[f.roma]).unrestDays).toBe(UNREST_DAYS / 2);
    expectConsistent(near);

    const far = holding('carthage', f.roma);
    finish(far, f.carthago, 'colonia');
    need(far.cities[f.carthago]).owner = f.rome;
    changeCityOwner(far, f.roma, f.rome);
    expect(need(far.cities[f.roma]).unrestDays).toBe(UNREST_DAYS);
  });

  test('recruits train in fewer days in a city with a Colonia', () => {
    const state = holding('carthage');
    finish(state, f.roma, 'colonia');
    const next = tick(
      state,
      [{ kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' }],
      world,
    ).state;
    const [recruit] = need(next.cities[f.roma]).recruits;
    const days = TROOPS.spearmen.recruit.days;
    expect(need(recruit).readyOn - state.day).toBe(Math.ceil(days * 0.75));
    expectConsistent(next);
  });

  test('Royal stables train cavalry in half the days, and other troops as before', () => {
    const state = holding('macedon');
    finish(state, f.carthago, 'royalStables');
    const ready = (troop: 'heavyCavalry' | 'spearmen') => {
      const copy = structuredClone(state);
      const next = tick(
        copy,
        [{ kind: 'recruit', faction: power('macedon'), city: f.carthago, troop }],
        world,
      ).state;
      return need(need(next.cities[f.carthago]).recruits[0]).readyOn - state.day;
    };
    expect(ready('heavyCavalry')).toBe(TROOPS.heavyCavalry.recruit.days / 2);
    expect(ready('spearmen')).toBe(TROOPS.spearmen.recruit.days);
  });

  test('a Great granary stores more food and grows more of it', () => {
    const before = holding('egypt');
    const after = holding('egypt');
    finish(after, f.carthago, 'greatGranary');
    const egypt = power('egypt');
    const people = need(before.cities[f.carthago]).population;
    const store = (s: GameState) => need(limitsOf(s).get(egypt)).food;
    const food = (s: GameState) => need(dailyBalances(s).get(egypt)).food;
    expect(store(after) - store(before)).toBeCloseTo(
      BUILDINGS.greatGranary.storeDays * people * 0.0004,
    );
    expect(food(after) - food(before)).toBeCloseTo(people * 0.0006 * 0.25);
  });

  test("a Great granary sells grain for more of its city's gold", () => {
    const before = holding('egypt');
    const after = holding('egypt');
    finish(after, f.carthago, 'greatGranary');
    const people = need(before.cities[f.carthago]).population;
    const gold = (s: GameState) => need(dailyBalances(s).get(power('egypt'))).gold;
    expect(gold(after) - gold(before)).toBeCloseTo(people * 0.00042 * 0.15);
  });

  test("a Royal road speeds its owner's armies in its province, and no one else's", () => {
    const marched = (owner: FactionId, road: boolean, holder: PowerId = 'persia') => {
      const state = holding('persia', f.roma);
      if (road) finish(state, f.roma, 'royalRoad');
      need(state.cities[f.roma]).owner = power(holder);
      const army = need(state.armies[f.romanArmy]);
      army.owner = owner;
      const from = { x: 2511.3, y: 2345.8 };
      army.activity = {
        kind: 'marching',
        position: from,
        waypoints: [{ x: 2511.3, y: 2445.8 }],
      };
      movement(state);
      return distance(from, (army.activity as { position: MapPoint }).position);
    };
    expect(marched(power('persia'), false)).toBeCloseTo(25);
    expect(marched(power('persia'), true)).toBeCloseTo(25 * 1.25);
    expect(marched(f.rome, true)).toBeCloseTo(25);
    expect(marched(f.rome, true, 'rome')).toBeCloseTo(25 * 1.25);
  });

  test('a forecast of a march or a crossing takes the days the movement takes, roads and Cothons counted', () => {
    const ticksToArrive = (state: GameState, moving: () => boolean) => {
      let days = 0;
      while (moving() && days < 500) {
        movement(state);
        days++;
      }
      return days;
    };
    const marches: number[] = [];
    const crossings: number[] = [];
    for (const road of [false, true]) {
      const state = holding('persia', f.roma);
      if (road) finish(state, f.roma, 'royalRoad');
      const army = need(state.armies[f.romanArmy]);
      army.owner = power('persia');
      const from = { x: 2511.3, y: 2345.8 };
      const waypoints = [
        { x: 2511.3, y: 2380.8 },
        { x: 2560, y: 2420.8 },
        { x: 2511.3, y: 2345.8 },
        { x: 2560, y: 2420.8 },
        { x: 2900, y: 2500 },
      ];
      army.activity = { kind: 'marching', position: from, waypoints: structuredClone(waypoints) };
      const forecast = travelDaysAlong(
        state,
        army.owner,
        from,
        waypoints,
        armyKmPerDay(state, army),
      );
      marches.push(forecast);
      expect(ticksToArrive(state, () => army.activity.kind === 'marching')).toBe(forecast);
    }
    for (const cothon of [false, true]) {
      let state = holding('carthage');
      if (cothon) finish(state, f.carthago, 'cothon');
      state = tick(
        state,
        [{ kind: 'embark', faction: f.carthage, army: f.punicArmy, to: f.roma }],
        world,
      ).state;
      const convoy = need(Object.values(state.convoys)[0], 'a convoy');
      const forecast = travelDaysAlong(
        state,
        convoy.owner,
        convoy.position,
        convoy.waypoints,
        'sail',
      );
      crossings.push(forecast);
      const moved = structuredClone(state);
      expect(ticksToArrive(moved, () => Object.hasOwn(moved.convoys, convoy.id))).toBe(forecast);
    }
    expect(need(marches[1])).toBeLessThan(need(marches[0]));
    expect(need(crossings[1])).toBeLessThan(need(crossings[0]));
  });

  test('a Cothon has convoys within its reach sail faster, and ships gather sooner on a shore there', () => {
    const sailed = (cothon: boolean) => {
      let state = holding('carthage');
      if (cothon) finish(state, f.carthago, 'cothon');
      state = tick(
        state,
        [{ kind: 'embark', faction: f.carthage, army: f.punicArmy, to: f.roma }],
        world,
      ).state;
      const convoy = need(Object.values(state.convoys)[0], 'a convoy');
      const from = { ...convoy.position };
      state = tick(state, [], world).state;
      return distance(from, need(state.convoys[convoy.id]).position);
    };
    expect(sailed(false)).toBeLessThanOrEqual(20.001);
    expect(sailed(true)).toBeGreaterThan(20.001);

    const state = holding('carthage');
    const carthago = need(state.cities[f.carthago]);
    const harbour = need(world.harbours.get(f.roma));
    const shore = [80, 120, 160, 200]
      .map((dx) => nearestSea(world.mesh, { x: carthago.position.x + dx, y: carthago.position.y }))
      .find((point) => point && distance(point, carthago.position) > 30);
    const at = need(shore ?? undefined, 'a shore near Carthago');
    expect(embarkationAt(state, world, f.carthage, at, harbour)?.waitDays).toBe(GATHER_DAYS);
    finish(state, f.carthago, 'cothon');
    expect(embarkationAt(state, world, f.carthage, at, harbour)?.waitDays).toBe(GATHER_DAYS / 2);
    expect(embarkationAt(state, world, f.rome, at, harbour)?.waitDays).toBe(GATHER_DAYS);
  });

  test.each(POWERS)("the AI finds %s's own building worth gold where it suits", (own) => {
    const state = holding(own);
    const city = need(state.cities[f.carthago]);
    need(state.armies[f.punicArmy]).owner = power(own);
    if (own === 'egypt') need(state.factions[power(own)]).stores.food = 0;
    if (own === 'rome') need(state.cities[f.syracusae]).position = { x: 2300, y: 2800 };
    expect(buildingWorth(state, city, SIGNATURE_BUILDINGS[own])).toBeGreaterThan(0);
  });
});

describe("each great power's standing bonus", () => {
  test('Roman armies re-form in 2 days, and others in 3', () => {
    const state = buildFixture();
    const changed = (owner: FactionId) => ({ owner, stanceChangedOn: state.day });
    const after = (days: number) => ({ day: state.day + days });
    expect(reforming(after(1), changed(f.rome))).toBe(true);
    expect(reforming(after(2), changed(f.rome))).toBe(false);
    expect(reforming(after(2), changed(f.carthage))).toBe(true);
    expect(reforming(after(3), changed(f.carthage))).toBe(false);
  });

  test('Carthage pays a quarter less for a band of guards, and Rome the full price', () => {
    const state = holding('carthage');
    executeOrder(state, { kind: 'hireGuards', faction: f.carthage, city: f.carthago }, world);
    executeOrder(state, { kind: 'hireGuards', faction: f.rome, city: f.roma }, world);
    expect(need(state.factions[f.carthage]).stores.gold).toBe(50_000 - GUARD_GOLD * 0.75);
    expect(need(state.factions[f.rome]).stores.gold).toBe(50_000 - GUARD_GOLD);
    expectConsistent(state);
  });

  test("every new army of Macedon's has a general of skill 5, and Rome's of 3", () => {
    const raised = (id: PowerId) => {
      const state = holding(id, f.roma);
      const roma = need(state.cities[f.roma]);
      roma.recruits = [{ troop: 'spearmen', readyOn: state.day }];
      muster(state);
      const army = Object.values(state.armies).find((a) => a.owner === power(id));
      return need(army, 'a new army').generalSkill;
    };
    expect(raised('macedon')).toBe(5);
    const state = buildFixture();
    need(state.cities[f.roma]).recruits = [{ troop: 'spearmen', readyOn: state.day }];
    need(state.armies[f.romanArmy]).activity = { kind: 'idle', position: { x: 0, y: 0 } };
    muster(state);
    const fresh = Object.values(state.armies).find(
      (a) => a.id !== f.romanArmy && a.owner === f.rome,
    );
    expect(need(fresh).generalSkill).toBe(STARTING_GENERAL_SKILL);
  });

  test('Egypt grows a fifth more food along the Nile, and a conqueror does not', () => {
    const grown = (owner: PowerId, nile: boolean) => {
      const state = holding(owner);
      if (nile) {
        const id = 'alexandria' as ProvinceId;
        const africa = need(state.provinces[f.africa]);
        removeRecord(state.provinces, f.africa);
        state.provinces[id] = { ...africa, id };
        need(state.cities[f.carthago]).province = id;
      }
      expectConsistent(state);
      const before = need(dailyBalances(state).get(power(owner))).food;
      need(state.cities[f.carthago]).population *= 2;
      return need(dailyBalances(state).get(power(owner))).food - before;
    };
    expect(grown('egypt', true) / grown('egypt', false)).toBeGreaterThan(1);
    const people = need(buildFixture().cities[f.carthago]).population;
    expect(grown('egypt', true) - grown('egypt', false)).toBeCloseTo(people * 0.0006 * 0.2);
    expect(grown('rome', true)).toBeCloseTo(grown('rome', false));
  });

  test('Persia governs 10 cities at full share where Rome yields less, and from 16 alike', () => {
    const persia = power('persia');
    const shares = (cities: number) => {
      const state = buildFixture();
      growRome(state, cities);
      const rome = adminShareOf(state, f.rome);
      state.factions[persia] = { ...structuredClone(need(state.factions[f.rome])), id: persia };
      for (const city of Object.values(state.cities))
        if (city.owner === f.rome) city.owner = persia;
      return { rome, persia: adminShareOf(state, persia) };
    };
    expect(shares(10).rome).toBeLessThan(1);
    expect(shares(10).persia).toBe(1);
    expect(shares(13).persia).toBeGreaterThan(shares(13).rome);
    expect(shares(16).persia).toBeCloseTo(shares(16).rome);
  });
});
