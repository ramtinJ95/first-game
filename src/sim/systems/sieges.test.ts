import { describe, expect, test } from 'vitest';
import { earlyMusters, UNREST_DAYS } from '../cities.ts';
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
import {
  CITY_DEFENCES,
  HUNGER_SHARE,
  OCCUPATION_SHARE,
  RECOVERY_DAYS,
  SALLY_SHARE,
  WALL_DEFENCE,
} from './sieges.ts';

const world = fixtureWorld();

const NEAR_CAPUA = { x: 2641.8, y: 2448.3 };
/** Inland, between Capua and Roma, more than a siege distance from either. */
const BETWEEN = { x: 2575, y: 2392 };
const FAR_AWAY: ArmyActivity = { kind: 'idle', position: { x: 0, y: 0 } };
const FULL = CITY_DEFENCES.greatPowerCity;
const HUNGER = Math.ceil(FULL.garrison * HUNGER_SHARE);
/** The men the conquerors leave in Capua, which has rebuilt a day's worth more by nightfall. */
const LEFT_BEHIND = Math.round(FULL.garrison * OCCUPATION_SHARE);
const NEW_GARRISON = LEFT_BEHIND + Math.ceil(FULL.garrison / RECOVERY_DAYS);

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
    expect(cityOf(first, FIXTURE.capua)).toMatchObject({ foodDays: 0, garrison: FULL.garrison });
    const second = tick(first, [], world).state;
    expect(cityOf(second, FIXTURE.capua).garrison).toBe(FULL.garrison - HUNGER);
    const third = tick(second, [], world).state;
    expect(cityOf(third, FIXTURE.capua).garrison).toBe(FULL.garrison - 2 * HUNGER);
    expectConsistent(third);
  });

  test('a city whose garrison starves falls with unrest, and the besiegers leave men to hold it', () => {
    const state = besiegingCapua();
    const capua = cityOf(state, FIXTURE.capua);
    capua.foodDays = 0;
    capua.garrison = HUNGER + 10;
    const first = tick(state, [], world).state;
    expect(cityOf(first, FIXTURE.capua)).toMatchObject({ owner: FIXTURE.rome, garrison: 10 });
    const men = menOf(first, FIXTURE.punicArmy);

    const fallen = tick(first, [], world).state;
    expect(cityOf(fallen, FIXTURE.capua)).toMatchObject({
      owner: FIXTURE.carthage,
      garrison: NEW_GARRISON,
      unrestDays: UNREST_DAYS - 1,
      fellOn: 2,
    });
    expect(menOf(fallen, FIXTURE.punicArmy)).toBe(men - LEFT_BEHIND);
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

describe('a token siege', () => {
  test('too few besiegers cut no food, and the garrison sallies until they are gone', () => {
    const state = besiegingCapua();
    armyOf(state, FIXTURE.punicArmy).activity = FAR_AWAY;
    const token = addArmy(state, 'army-token', FIXTURE.carthage, 100, NEAR_CAPUA);
    const first = tick(state, [], world).state;
    expect(cityOf(first, FIXTURE.capua)).toMatchObject({
      foodDays: FULL.foodDays,
      garrison: FULL.garrison,
    });
    expect(menOf(first, token)).toBe(100 - Math.ceil(FULL.garrison * SALLY_SHARE));

    const after = play(first, 2);
    expect(after.armies[token]).toBeUndefined();
    expect(after.sieges).toEqual({});
    expect(cityOf(after, FIXTURE.capua)).toMatchObject({ owner: FIXTURE.rome, ...FULL });
    expectConsistent(after);
  });

  test('besiegers as many as the garrison cut the food and suffer no sally', () => {
    const state = besiegingCapua();
    armyOf(state, FIXTURE.punicArmy).activity = FAR_AWAY;
    const siege = addArmy(state, 'army-siege', FIXTURE.carthage, FULL.garrison, NEAR_CAPUA);
    const after = play(state, 5);
    expect(cityOf(after, FIXTURE.capua).foodDays).toBe(FULL.foodDays - 5);
    expect(menOf(after, siege)).toBe(FULL.garrison);
    expectConsistent(after);
  });
});

describe('troops in training', () => {
  test('a besieged city musters its recruits at once, and they sally against the besiegers', () => {
    const state = besiegingCapua();
    const due = 50 as GameState['day'];
    cityOf(state, FIXTURE.capua).recruits = [{ troop: 'spearmen', readyOn: due }];
    const besieged = tick(state, [], world).state;
    expect(cityOf(besieged, FIXTURE.capua).recruits).toEqual([]);
    expect(earlyMusters(state, besieged)).toEqual([
      { city: FIXTURE.capua, owner: FIXTURE.rome, troops: ['spearmen'] },
    ]);
    const defenders = Object.values(besieged.armies).filter(
      (army) => army.owner === FIXTURE.rome && army.id !== FIXTURE.romanArmy,
    );
    expect(defenders.map((army) => army.activity.kind)).toEqual(['idle']);
    expect(menOf(besieged, defenders[0]?.id as ArmyId)).toBe(1000);

    const sally = tick(besieged, [], world).state;
    expect(Object.values(sally.battles)).toHaveLength(1);
    expect(sally.sieges).toEqual({});
    expectConsistent(sally);
  });

  for (const [how, set] of [
    ['starves', (city: GameState['cities'][CityId]) => ((city.foodDays = 0), (city.garrison = 1))],
    ['gives up', (city: GameState['cities'][CityId]) => (city.walls = 0)],
  ] as const) {
    test(`a city that ${how} on the day its recruits muster holds until they have fought`, () => {
      for (let seed = 1; seed <= 10; seed++) {
        const state = besiegingCapua(seed);
        const capua = cityOf(state, FIXTURE.capua);
        set(capua);
        capua.recruits = [{ troop: 'spearmen', readyOn: 50 as GameState['day'] }];
        const mustered = tick(state, [], world).state;
        expect(cityOf(mustered, FIXTURE.capua).owner).toBe(FIXTURE.rome);
        const fought = tick(mustered, [], world).state;
        expect(Object.values(fought.battles)).toHaveLength(1);
        expect(cityOf(fought, FIXTURE.capua).owner).toBe(FIXTURE.rome);
        expectConsistent(fought);
      }
    });
  }

  test('a storm is refused while the mustered defenders stand at the city', () => {
    const state = besiegingCapua();
    cityOf(state, FIXTURE.capua).recruits = [
      { troop: 'spearmen', readyOn: 50 as GameState['day'] },
    ];
    const besieged = tick(state, [], world).state;
    const refused = executeOrder(
      besieged,
      { kind: 'storm', faction: FIXTURE.carthage, city: FIXTURE.capua },
      world,
    );
    expect(refused?.reason).toBe('an army of rome defends capua in the field');
    expectConsistent(besieged);
  });

  test('a recruit is refused in a besieged city, so no training can be lost with it', () => {
    const state = tick(besiegingCapua(), [], world).state;
    const refused = tick(
      state,
      [{ kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.capua, troop: 'spearmen' }],
      world,
    );
    expect(refused.rejected.map((r) => r.reason)).toEqual(['city capua is under siege']);
    expectConsistent(refused.state);
  });

  test('recruits due on their day are not counted as mustered early', () => {
    const state = buildFixture();
    cityOf(state, FIXTURE.roma).recruits = [{ troop: 'spearmen', readyOn: state.day }];
    const next = tick(state, [], world).state;
    expect(cityOf(next, FIXTURE.roma).recruits).toEqual([]);
    expect(earlyMusters(state, next)).toEqual([]);
  });
});

describe('storming', () => {
  const storm: Order = { kind: 'storm', faction: FIXTURE.carthage, city: FIXTURE.capua };
  /** Capua's full garrison raised by its full walls, which a storm must beat 1.5 times over. */
  const DEFENCE = FULL.garrison * (1 + FULL.walls * WALL_DEFENCE);

  function stormWith(men: number, seed: number) {
    let state = besiegingCapua(seed);
    armyOf(state, FIXTURE.punicArmy).activity = FAR_AWAY;
    const army = addArmy(state, 'army-storm', FIXTURE.carthage, men, NEAR_CAPUA);
    state = tick(state, [], world).state;
    cityOf(state, FIXTURE.capua).walls = FULL.walls;
    const after = tick(state, [storm], world).state;
    return { after, army, lost: men - (after.armies[army] ? menOf(after, army) : 0) };
  }

  test('a clearly stronger army takes intact walls and a full garrison at a fifth to a third of its men', () => {
    const men = Math.round(2.1 * DEFENCE);
    for (let seed = 1; seed <= 10; seed++) {
      const { after, army, lost } = stormWith(men, seed);
      expect(cityOf(after, FIXTURE.capua)).toMatchObject({
        owner: FIXTURE.carthage,
        garrison: NEW_GARRISON,
        fellOn: 2,
      });
      expect(lost).toBeGreaterThanOrEqual(0.15 * men);
      expect(lost).toBeLessThanOrEqual(0.35 * men);
      expect(armyOf(after, army).activity.kind).toBe('idle');
      expectConsistent(after);
    }
  });

  test('an army that is not clearly stronger always fails against intact walls, and pays for it', () => {
    const men = Math.round(1.2 * DEFENCE);
    for (let seed = 1; seed <= 10; seed++) {
      const { after, army, lost } = stormWith(men, seed);
      expect(cityOf(after, FIXTURE.capua).owner).toBe(FIXTURE.rome);
      expect(lost).toBeGreaterThan(0.25 * men);
      expect(after.formations[`${army}-spearmen` as FormationId]?.morale).toBeCloseTo(0.7, 9);
      expect(armyOf(after, army).activity.kind).toBe('besieging');
      expectConsistent(after);
    }
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
    expect(cityOf(state, FIXTURE.capua)).toMatchObject({
      walls: 188,
      garrison: FULL.garrison - 2 * HUNGER,
      foodDays: 0,
    });

    state = tick(
      state,
      [{ kind: 'moveArmy', faction: FIXTURE.carthage, army: FIXTURE.punicArmy, to: BETWEEN }],
      world,
    ).state;
    expect(state.sieges).toEqual({});
    const city = cityOf(state, FIXTURE.capua);
    expect(city.walls).toBeCloseTo(188 + full.walls / RECOVERY_DAYS, 9);
    expect(city.garrison).toBe(
      FULL.garrison - 2 * HUNGER + Math.ceil(full.garrison / RECOVERY_DAYS),
    );
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
