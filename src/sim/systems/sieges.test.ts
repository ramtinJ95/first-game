import { describe, expect, test } from 'vitest';
import { UNREST_DAYS } from '../cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { ArmyId, CityId, FactionId, FormationId } from '../ids.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import { loadGame, saveGame } from '../save.ts';
import type { ArmyActivity } from '../state/army.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { startMarch } from '../march.ts';
import { tick } from '../tick.ts';
import { CITY_DEFENCES, RECOVERY_DAYS } from './sieges.ts';

const world = fixtureWorld();

const NEAR_CAPUA = { x: 2641.8, y: 2448.3 };
/** Inland, between Capua and Roma, more than a siege distance from either. */
const BETWEEN = { x: 2575, y: 2392 };
const FAR_AWAY: ArmyActivity = { kind: 'idle', position: { x: 0, y: 0 } };
/** A city that fell today has rebuilt one day's worth of its new garrison by nightfall. */
const NEW_GARRISON = Math.ceil(CITY_DEFENCES.greatPowerCity.garrison / RECOVERY_DAYS);

function atWar(seed = 1): GameState {
  const state = buildFixture(seed);
  expect(
    executeOrder(
      state,
      { kind: 'declareWar', faction: FIXTURE.carthage, against: FIXTURE.rome },
      world,
    ),
  ).toBeUndefined();
  return state;
}

/** Carthage's army stands idle beside Capua and Rome's army is far away. */
function besiegingCapua(seed = 1): GameState {
  const state = atWar(seed);
  armyOf(state, FIXTURE.punicArmy).activity = { kind: 'idle', position: NEAR_CAPUA };
  armyOf(state, FIXTURE.romanArmy).activity = FAR_AWAY;
  return state;
}

function armyOf(state: GameState, id: ArmyId) {
  const army = state.armies[id];
  if (!army) throw new Error(`army ${id} is missing`);
  return army;
}

function cityOf(state: GameState, id: CityId) {
  const city = state.cities[id];
  if (!city) throw new Error(`city ${id} is missing`);
  return city;
}

function addArmy(
  state: GameState,
  id: string,
  owner: FactionId,
  men: number,
  position: MapPoint,
): ArmyId {
  const armyId = id as ArmyId;
  const formation = `${id}-spearmen` as FormationId;
  state.formations[formation] = { id: formation, army: armyId, troop: 'spearmen', men, morale: 1 };
  state.armies[armyId] = {
    id: armyId,
    owner,
    formations: [formation],
    stance: 'holdTheLine',
    generalSkill: 3,
    activity: { kind: 'idle', position },
  };
  return armyId;
}

function menOf(state: GameState, id: ArmyId): number {
  return armyOf(state, id).formations.reduce((sum, f) => sum + (state.formations[f]?.men ?? 0), 0);
}

function play(state: GameState, days: number, orders: readonly Order[] = []): GameState {
  for (let day = 0; day < days; day += 1) state = tick(state, day === 0 ? orders : [], world).state;
  return state;
}

describe('the start of a siege', () => {
  test('an idle army beside a city of a faction it is at war with besieges it, and not at peace', () => {
    const peaceful = buildFixture();
    armyOf(peaceful, FIXTURE.punicArmy).activity = { kind: 'idle', position: NEAR_CAPUA };
    const atPeace = tick(peaceful, [], world).state;
    expect(atPeace.sieges).toEqual({});
    expect(armyOf(atPeace, FIXTURE.punicArmy).activity.kind).toBe('idle');
    expectConsistent(atPeace);

    const state = tick(besiegingCapua(), [], world).state;
    const [siege] = Object.values(state.sieges);
    expect(siege).toMatchObject({
      city: FIXTURE.capua,
      besiegers: [FIXTURE.punicArmy],
      startedOn: 1,
    });
    expect(armyOf(state, FIXTURE.punicArmy).activity).toEqual({
      kind: 'besieging',
      position: NEAR_CAPUA,
      siege: siege?.id,
    });
    expectConsistent(state);
  });

  test('a marching army does not besiege the city it passes', () => {
    const state = besiegingCapua();
    expect(
      startMarch(world, armyOf(state, FIXTURE.punicArmy), NEAR_CAPUA, BETWEEN),
    ).toBeUndefined();
    expect(tick(state, [], world).state.sieges).toEqual({});
    expectConsistent(state);
  });

  test('a second army at war with the city joins the siege behind the first', () => {
    let state = tick(besiegingCapua(), [], world).state;
    const second = addArmy(state, 'army-second', FIXTURE.carthage, 500, { x: 2635.8, y: 2448.3 });
    state = tick(state, [], world).state;
    const sieges = Object.values(state.sieges);
    expect(sieges).toHaveLength(1);
    expect(sieges[0]?.besiegers).toEqual([FIXTURE.punicArmy, second]);
    expect(armyOf(state, second).activity.kind).toBe('besieging');
    expectConsistent(state);
  });
});

describe('a day of siege', () => {
  test('food falls by a day and the walls by 2 points for each thousand besiegers', () => {
    const full = CITY_DEFENCES.greatPowerCity;
    let state = tick(besiegingCapua(), [], world).state;
    expect(cityOf(state, FIXTURE.capua)).toMatchObject({
      walls: full.walls - 3,
      garrison: full.garrison,
      foodDays: full.foodDays - 1,
    });
    state = play(state, 4);
    expect(cityOf(state, FIXTURE.capua)).toMatchObject({
      walls: full.walls - 15,
      garrison: full.garrison,
      foodDays: full.foodDays - 5,
    });
    expectConsistent(state);
  });

  test('once the food is gone hunger takes a twentieth of the full garrison each day', () => {
    const state = besiegingCapua();
    cityOf(state, FIXTURE.capua).foodDays = 1;
    const first = tick(state, [], world).state;
    expect(cityOf(first, FIXTURE.capua)).toMatchObject({ foodDays: 0, garrison: 1000 });
    const second = tick(first, [], world).state;
    expect(cityOf(second, FIXTURE.capua).garrison).toBe(950);
    const third = tick(second, [], world).state;
    expect(cityOf(third, FIXTURE.capua).garrison).toBe(900);
    expectConsistent(third);
  });

  test('a city whose garrison starves falls to the besieger with unrest and without its recruits', () => {
    const state = besiegingCapua();
    const capua = cityOf(state, FIXTURE.capua);
    capua.foodDays = 0;
    capua.garrison = 100;
    capua.recruits = [{ troop: 'spearmen', readyOn: 50 as GameState['day'] }];
    const first = tick(state, [], world).state;
    expect(cityOf(first, FIXTURE.capua)).toMatchObject({ owner: FIXTURE.rome, garrison: 50 });

    const fallen = tick(first, [], world).state;
    expect(cityOf(fallen, FIXTURE.capua)).toMatchObject({
      owner: FIXTURE.carthage,
      garrison: NEW_GARRISON,
      unrestDays: UNREST_DAYS - 1,
      recruits: [],
      fellOn: 2,
    });
    expect(fallen.sieges).toEqual({});
    expect(armyOf(fallen, FIXTURE.punicArmy).activity).toEqual({
      kind: 'idle',
      position: NEAR_CAPUA,
    });
    expect(fallen.factions[FIXTURE.rome]?.defeatedOn).toBeNull();
    expectConsistent(fallen);
  });

  test('a city with its walls down gives up on a roll of the generator, and never on its own', () => {
    const state = besiegingCapua();
    cityOf(state, FIXTURE.capua).walls = 0;
    let days = 0;
    let current = state;
    while (cityOf(current, FIXTURE.capua).owner === FIXTURE.rome) {
      current = tick(current, [], world).state;
      days += 1;
    }
    expect(cityOf(current, FIXTURE.capua).garrison).toBe(NEW_GARRISON);
    expect(days).toBeLessThan(CITY_DEFENCES.greatPowerCity.foodDays);
    expect(cityOf(current, FIXTURE.capua).owner).toBe(FIXTURE.carthage);
    expectConsistent(current);
  });

  test('the city goes to the faction whose army has besieged it longest', () => {
    let state = tick(besiegingCapua(), [], world).state;
    const numidia = 'numidia' as FactionId;
    state.factions[numidia] = {
      id: numidia,
      name: 'Numidia',
      kind: 'greatPower',
      stores: { gold: 1000, food: 1000, manpower: 0 },
      defeatedOn: null,
    };
    executeOrder(state, { kind: 'declareWar', faction: numidia, against: FIXTURE.rome }, world);
    const numidian = addArmy(state, 'army-numidian', numidia, 3000, { x: 2638.8, y: 2451.3 });
    cityOf(state, FIXTURE.capua).garrison = 100;
    cityOf(state, FIXTURE.capua).foodDays = 0;
    state = play(state, 2);
    expect(cityOf(state, FIXTURE.capua).owner).toBe(FIXTURE.carthage);
    expect(armyOf(state, numidian).activity.kind).toBe('idle');
    expect(state.sieges).toEqual({});
    expectConsistent(state);
  });

  test('a besieger whose owner runs short of food gives up the siege and cannot start another', () => {
    let state = tick(besiegingCapua(), [], world).state;
    const stores = state.factions[FIXTURE.carthage]?.stores;
    if (!stores) throw new Error('Carthage is missing');
    stores.food = -1000;
    state = play(state, 3);
    expect(state.sieges).toEqual({});
    expect(armyOf(state, FIXTURE.punicArmy).activity.kind).toBe('idle');
    expectConsistent(state);
  });
  test('a besieger whose formations all break gives up the siege, so a relief army can reach it', () => {
    let state = tick(besiegingCapua(), [], world).state;
    const spears = state.formations[FIXTURE.citizenSpears];
    if (spears) spears.morale = 0;
    state = tick(state, [], world).state;
    expect(state.sieges).toEqual({});
    expect(armyOf(state, FIXTURE.punicArmy).activity.kind).toBe('idle');
    expectConsistent(state);
  });
});

describe('storming', () => {
  const storm: Order = { kind: 'storm', faction: FIXTURE.carthage, city: FIXTURE.capua };

  test('a storm at three times the strength takes the city at a cost of a tenth to a sixth of the men', () => {
    let state = tick(besiegingCapua(), [], world).state;
    cityOf(state, FIXTURE.capua).garrison = 500;
    cityOf(state, FIXTURE.capua).walls = 100;
    const before = menOf(state, FIXTURE.punicArmy);
    const { state: after, rejected } = tick(state, [storm], world);
    state = after;
    expect(rejected).toEqual([]);
    const lost = before - menOf(state, FIXTURE.punicArmy);
    expect(lost).toBeGreaterThanOrEqual(150);
    expect(lost).toBeLessThanOrEqual(250);
    expect(cityOf(state, FIXTURE.capua)).toMatchObject({
      owner: FIXTURE.carthage,
      garrison: NEW_GARRISON,
      fellOn: 2,
    });
    expect(state.sieges).toEqual({});
    expect(armyOf(state, FIXTURE.punicArmy).activity.kind).toBe('idle');
    expectConsistent(state);
  });

  test('a storm that takes the city gives it to the faction that has besieged it longest', () => {
    const state = besiegingCapua();
    const numidia = 'numidia' as FactionId;
    state.factions[numidia] = {
      id: numidia,
      name: 'Numidia',
      kind: 'greatPower',
      stores: { gold: 1000, food: 1000, manpower: 0 },
      defeatedOn: null,
    };
    executeOrder(state, { kind: 'declareWar', faction: numidia, against: FIXTURE.rome }, world);
    const numidian = addArmy(state, 'army-numidian', numidia, 200, { x: 2638.8, y: 2451.3 });
    let next = tick(state, [], world).state;
    expect(Object.values(next.sieges)[0]?.besiegers).toEqual([numidian, FIXTURE.punicArmy]);
    cityOf(next, FIXTURE.capua).garrison = 500;
    cityOf(next, FIXTURE.capua).walls = 100;
    next = tick(next, [storm], world).state;
    expect(cityOf(next, FIXTURE.capua)).toMatchObject({ owner: numidia, fellOn: 2 });
    expect(armyOf(next, FIXTURE.punicArmy).activity.kind).toBe('idle');
    expectConsistent(next);
  });

  test('a storm against full walls fails, costs men and morale, and the siege goes on', () => {
    let state = tick(besiegingCapua(), [], world).state;
    const garrison = cityOf(state, FIXTURE.capua).garrison;
    const before = menOf(state, FIXTURE.punicArmy);
    const morale = state.formations[FIXTURE.citizenSpears]?.morale ?? 0;
    state = tick(state, [storm], world).state;
    const lost = before - menOf(state, FIXTURE.punicArmy);
    expect(lost).toBeGreaterThan(0.25 * before);
    expect(state.formations[FIXTURE.citizenSpears]?.morale).toBeCloseTo(morale - 0.3, 9);
    expect(cityOf(state, FIXTURE.capua).owner).toBe(FIXTURE.rome);
    expect(cityOf(state, FIXTURE.capua).garrison).toBeLessThan(garrison);
    expect(cityOf(state, FIXTURE.capua).garrison).toBeGreaterThan(0.8 * garrison);
    expect(armyOf(state, FIXTURE.punicArmy).activity.kind).toBe('besieging');
    expectConsistent(state);
  });

  test('a storm is refused while the besieger owner is short of food, before any draw', () => {
    const state = tick(besiegingCapua(), [], world).state;
    const stores = state.factions[FIXTURE.carthage]?.stores;
    if (stores) stores.food = -1;
    const before = structuredClone(state);
    expect(executeOrder(state, storm, world)?.reason).toBe(
      'carthage has no army in the siege of capua that can storm, unbroken and supplied',
    );
    expect(state).toEqual(before);
    expectConsistent(state);
  });

  test('a storm is refused where the faction has no army in a siege', () => {
    const state = tick(besiegingCapua(), [], world).state;
    const refused = tick(
      state,
      [
        { kind: 'storm', faction: FIXTURE.rome, city: FIXTURE.capua },
        { kind: 'storm', faction: FIXTURE.carthage, city: FIXTURE.roma },
      ],
      world,
    );
    expect(refused.rejected.map((r) => r.reason)).toEqual([
      'rome has no army in the siege of capua that can storm, unbroken and supplied',
      'city roma is not under siege',
    ]);
    expectConsistent(refused.state);
  });
});

describe('relief', () => {
  function reliefOf(men: number): { state: GameState; relief: ArmyId } {
    let state = besiegingCapua();
    state = play(state, 10);
    const relief = addArmy(state, 'army-relief', FIXTURE.rome, men, { x: 2648.8, y: 2448.3 });
    return { state, relief };
  }

  function untilNoBattle(state: GameState): GameState {
    let current = state;
    do current = tick(current, [], world).state;
    while (Object.keys(current.battles).length > 0);
    return current;
  }

  test('a relief army attacks the besiegers, the siege ends, and the city keeps its damage', () => {
    const { state, relief } = reliefOf(3000);
    const walls = cityOf(state, FIXTURE.capua).walls;
    const first = tick(state, [], world).state;
    expect(first.sieges).toEqual({});
    expect(armyOf(first, FIXTURE.punicArmy).activity.kind).not.toBe('besieging');
    expect(cityOf(first, FIXTURE.capua).walls).toBeCloseTo(walls + 200 / RECOVERY_DAYS, 9);

    const after = untilNoBattle(first);
    expect(armyOf(after, FIXTURE.punicArmy).activity.kind).toBe('retreating');
    expect(armyOf(after, relief).activity.kind).toBe('idle');
    expect(after.sieges).toEqual({});
    expect(cityOf(after, FIXTURE.capua).owner).toBe(FIXTURE.rome);
    expect(cityOf(after, FIXTURE.capua).walls).toBeLessThan(200);
    expectConsistent(after);
  });

  test('a relief army that loses leaves the besiegers idle by the city, and they besiege it again', () => {
    const { state } = reliefOf(300);
    const after = untilNoBattle(state);
    expect(armyOf(after, FIXTURE.punicArmy).activity.kind).toBe('besieging');
    expect(Object.values(after.sieges)).toHaveLength(1);
    expect(Object.values(after.sieges)[0]?.besiegers).toEqual([FIXTURE.punicArmy]);
    expect(cityOf(after, FIXTURE.capua).walls).toBeLessThan(200 - 30);
    expectConsistent(after);
  });
});

describe('after a siege', () => {
  test('a siege lifted by order leaves the damage, which recovers over the days of peace', () => {
    const full = CITY_DEFENCES.greatPowerCity;
    let state = besiegingCapua();
    cityOf(state, FIXTURE.capua).foodDays = 2;
    state = play(state, 4);
    expect(cityOf(state, FIXTURE.capua)).toMatchObject({ walls: 188, garrison: 900, foodDays: 0 });

    state = tick(
      state,
      [{ kind: 'moveArmy', faction: FIXTURE.carthage, army: FIXTURE.punicArmy, to: BETWEEN }],
      world,
    ).state;
    expect(state.sieges).toEqual({});
    const city = cityOf(state, FIXTURE.capua);
    expect(city.walls).toBeCloseTo(188 + full.walls / RECOVERY_DAYS, 9);
    expect(city.garrison).toBe(900 + Math.ceil(full.garrison / RECOVERY_DAYS));
    expect(city.foodDays).toBeCloseTo(full.foodDays / RECOVERY_DAYS, 9);

    state = play(state, RECOVERY_DAYS);
    expect(cityOf(state, FIXTURE.capua)).toMatchObject(full);
    expectConsistent(state);
  });
});

describe('determinism and saves', () => {
  function breached(seed: number): GameState {
    const state = besiegingCapua(seed);
    cityOf(state, FIXTURE.capua).walls = 3;
    return state;
  }
  const storm: Order = { kind: 'storm', faction: FIXTURE.carthage, city: FIXTURE.capua };

  test('the same seed and the same orders give the same siege', () => {
    const run = () => play(tick(play(breached(9), 1), [storm], world).state, 40);
    expect(run()).toEqual(run());
    expectConsistent(run());
  });

  test('a save and load in the middle of a siege continues it unchanged', () => {
    const middle = play(breached(5), 1);
    expect(Object.keys(middle.sieges)).toHaveLength(1);
    const loaded = loadGame(saveGame(middle));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(play(loaded.state, 40)).toEqual(play(middle, 40));
    expectConsistent(loaded.state);
  });
});
