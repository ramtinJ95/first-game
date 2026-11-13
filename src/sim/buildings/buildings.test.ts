import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../cities.ts';
import type { DayEvent } from '../events.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import { loadGame, SAVE_FORMAT, saveGame } from '../save.ts';
import type { GameState } from '../state/game-state.ts';
import { dailyBalances, limitsOf } from '../systems/economy.ts';
import { CITY_DEFENCES, fullDefences } from '../systems/sieges.ts';
import { tick } from '../tick.ts';
import { TROOPS } from '../troops.ts';
import { BUILDINGS, CANCEL_REFUND, type BuildingKind } from './buildings.ts';
import { buildingGain } from './gains.ts';

/** The value, or a thrown error naming what the test expected to exist. */
function need<T>(value: T | undefined, what = 'a record'): T {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const world = fixtureWorld();

const build = (building: BuildingKind, city = FIXTURE.roma): Order => ({
  kind: 'build',
  faction: FIXTURE.rome,
  city,
  building,
});
const cancel = (city = FIXTURE.roma): Order => ({
  kind: 'cancelBuilding',
  faction: FIXTURE.rome,
  city,
});

function rich(): GameState {
  const state = buildFixture();
  need(state.factions[FIXTURE.rome]).stores.gold = 50_000;
  return state;
}

function withBuilt(state: GameState, city: typeof FIXTURE.roma, ...kinds: BuildingKind[]) {
  need(state.cities[city]).buildings.push(...kinds);
  return state;
}

/** Plays days with no orders until the city's work is done, and returns the events of every day. */
function playUntilBuilt(state: GameState, city = FIXTURE.roma) {
  const events: DayEvent[] = [];
  let days = 0;
  while (state.cities[city]?.construction) {
    const next = tick(state, [], world);
    events.push(...next.events);
    state = next.state;
    days += 1;
    if (days > 400) throw new Error('the building never finished');
  }
  return { state, events, days };
}

describe('what each building does', () => {
  test('a forum raises the gold of its city by half', () => {
    const state = rich();
    const before = need(dailyBalances(state).get(FIXTURE.rome)).gold;
    const gain = buildingGain(state, need(state.cities[FIXTURE.roma]), 'forum').daily.gold;
    withBuilt(state, FIXTURE.roma, 'forum');
    const after = need(dailyBalances(state).get(FIXTURE.rome)).gold;
    expect(after - before).toBeCloseTo(gain, 9);
    expect(gain).toBeCloseTo(40_000 * 0.00042 * BUILDINGS.forum.goldShare, 9);
    expectConsistent(state);
  });

  test('canals add the same food in a large city and a small one', () => {
    const state = rich();
    const roma = buildingGain(state, need(state.cities[FIXTURE.roma]), 'canals').daily.food;
    const capua = buildingGain(state, need(state.cities[FIXTURE.capua]), 'canals').daily.food;
    expect(roma).toBeCloseTo(BUILDINGS.canals.food, 9);
    expect(capua).toBeCloseTo(BUILDINGS.canals.food, 9);
    expectConsistent(state);
  });

  test('canals grow less in a city in unrest', () => {
    const state = rich();
    need(state.cities[FIXTURE.capua]).unrestDays = 90;
    const food = buildingGain(state, need(state.cities[FIXTURE.capua]), 'canals').daily.food;
    expect(food).toBeLessThan(BUILDINGS.canals.food);
    expect(food).toBeGreaterThan(0);
    expectConsistent(state);
  });

  test('barracks give half again the manpower, raise the levy, and halve the training', () => {
    const state = rich();
    const before = need(limitsOf(state).get(FIXTURE.rome)).manpower;
    withBuilt(state, FIXTURE.roma, 'barracks');
    expect(need(limitsOf(state).get(FIXTURE.rome)).manpower - before).toBeCloseTo(
      40_000 * 0.05 * (BUILDINGS.barracks.levyShare - 1),
      6,
    );
    const day = state.day;
    expect(
      executeOrder(
        state,
        { kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.roma, troop: 'spearmen' },
        world,
      ),
    ).toBeUndefined();
    expect(
      executeOrder(
        state,
        { kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.capua, troop: 'spearmen' },
        world,
      ),
    ).toBeUndefined();
    const days = TROOPS.spearmen.recruit.days;
    expect(need(need(state.cities[FIXTURE.roma]).recruits[0]).readyOn).toBe(
      day + Math.ceil(days / 2),
    );
    expect(need(need(state.cities[FIXTURE.capua]).recruits[0]).readyOn).toBe(day + days);
    expectConsistent(state);
  });

  test('towers raise the full walls and garrison, and the city grows into them', () => {
    let state = withBuilt(rich(), FIXTURE.capua, 'towers');
    const full = fullDefences(need(state.cities[FIXTURE.capua]));
    expect(full.walls).toBe(CITY_DEFENCES.greatPowerCity.walls * 1.5);
    expect(full.garrison).toBe(Math.round(CITY_DEFENCES.greatPowerCity.garrison * 1.3));
    state = tick(state, [], world).state;
    expect(need(state.cities[FIXTURE.capua]).garrison).toBeGreaterThan(
      CITY_DEFENCES.greatPowerCity.garrison,
    );
    expectConsistent(state);
  });

  test("a temple counts unrest down three days a day in its owner's cities within reach", () => {
    let state = withBuilt(rich(), FIXTURE.roma, 'temple');
    need(state.cities[FIXTURE.capua]).unrestDays = 90;
    need(state.cities[FIXTURE.carthago]).unrestDays = 90;
    state = tick(state, [], world).state;
    expect(need(state.cities[FIXTURE.capua]).unrestDays).toBe(90 - BUILDINGS.temple.unrestPace);
    expect(need(state.cities[FIXTURE.carthago]).unrestDays).toBe(89);
    expectConsistent(state);
  });
});

describe('building', () => {
  test('pays the gold at the order, works its days, and finishes with the news', () => {
    const state = rich();
    expect(executeOrder(state, build('forum'), world)).toBeUndefined();
    expect(need(state.factions[FIXTURE.rome]).stores.gold).toBe(50_000 - BUILDINGS.forum.gold);
    expect(need(state.cities[FIXTURE.roma]).construction).toEqual({
      building: 'forum',
      daysLeft: BUILDINGS.forum.days,
    });
    const done = playUntilBuilt(state);
    expect(done.days).toBe(BUILDINGS.forum.days);
    expect(need(done.state.cities[FIXTURE.roma]).buildings).toEqual(['forum']);
    expect(done.events).toContainEqual(
      expect.objectContaining({ kind: 'buildingFinished', city: FIXTURE.roma, building: 'forum' }),
    );
    expectConsistent(done.state);
  });

  test.each([
    {
      name: 'when gold is short',
      setup: (state: GameState) => (need(state.factions[FIXTURE.rome]).stores.gold = 3999.5),
      order: build('canals'),
      reason: 'a canals costs 4000 gold, but rome has 3999',
    },
    {
      name: 'in a city too small',
      setup: () => {},
      order: build('forum', FIXTURE.capua),
      reason: 'a forum needs 20000 people, but city capua has 18000',
    },
    {
      name: 'in unrest',
      setup: (state: GameState) => (need(state.cities[FIXTURE.roma]).unrestDays = 5),
      order: build('canals'),
      reason: 'city roma is in unrest for 5 more days',
    },
    {
      name: 'a second time',
      setup: (state: GameState) => need(state.cities[FIXTURE.roma]).buildings.push('canals'),
      order: build('canals'),
      reason: 'city roma has a canals already',
    },
    {
      name: 'while another is at work',
      setup: (state: GameState) =>
        (need(state.cities[FIXTURE.roma]).construction = { building: 'temple', daysLeft: 3 }),
      order: build('canals'),
      reason: 'city roma is building a temple',
    },
    {
      name: 'in a city of another faction',
      setup: () => {},
      order: build('canals', FIXTURE.carthago),
      reason: 'city carthago belongs to carthage, not rome',
    },
  ])('is refused $name and changes nothing', ({ setup, order, reason }) => {
    const state = rich();
    setup(state);
    const before = structuredClone(state);
    expect(executeOrder(state, order, world)?.reason).toBe(reason);
    expect(state).toEqual(before);
  });

  test('is refused under siege, and a siege pauses the work', () => {
    const state = rich();
    executeOrder(
      state,
      { kind: 'declareWar', faction: FIXTURE.carthage, against: FIXTURE.rome },
      world,
    );
    executeOrder(state, build('canals', FIXTURE.capua), world);
    need(state.armies[FIXTURE.punicArmy]).activity = {
      kind: 'idle',
      position: { x: 2641.8, y: 2448.3 },
    };
    need(state.armies[FIXTURE.romanArmy]).activity = { kind: 'idle', position: { x: 0, y: 0 } };
    expect(executeOrder(state, build('canals', FIXTURE.roma), world)).toBeUndefined();
    expect(executeOrder(state, build('towers', FIXTURE.capua), world)?.reason).toBe(
      'city capua is building a canals',
    );
    const next = tick(state, [], world).state;
    expect(need(need(next.cities[FIXTURE.capua]).construction ?? undefined).daysLeft).toBe(
      BUILDINGS.canals.days,
    );
    expect(need(need(next.cities[FIXTURE.roma]).construction ?? undefined).daysLeft).toBe(
      BUILDINGS.canals.days - 1,
    );
    const free = structuredClone(next);
    need(free.cities[FIXTURE.capua]).construction = null;
    expect(executeOrder(free, build('towers', FIXTURE.capua), world)?.reason).toBe(
      'city capua is under siege',
    );
    expectConsistent(next);
  });

  test('cancelling stops the work and gives back half the gold', () => {
    const state = rich();
    executeOrder(state, build('towers'), world);
    const after = tick(state, [cancel()], world).state;
    expect(need(after.cities[FIXTURE.roma]).construction).toBeNull();
    expect(need(after.cities[FIXTURE.roma]).buildings).toEqual([]);
    const paid = 50_000 - BUILDINGS.towers.gold;
    const refund = BUILDINGS.towers.gold * CANCEL_REFUND;
    // Gold this far above the treasury limit earns nothing more, so the refund is all that comes in.
    expect(need(after.factions[FIXTURE.rome]).stores.gold).toBe(paid + refund);
    expect(executeOrder(structuredClone(after) as GameState, cancel(), world)?.reason).toBe(
      'city roma is building nothing',
    );
    expectConsistent(after);
  });

  test('a save keeps what is built and what is at work, and a save from before buildings is refused', () => {
    const state = withBuilt(rich(), FIXTURE.roma, 'forum');
    executeOrder(state, build('temple'), world);
    const loaded = loadGame(saveGame(state));
    expect(loaded.ok && loaded.state.cities[FIXTURE.roma]).toMatchObject({
      buildings: ['forum'],
      construction: { building: 'temple', daysLeft: BUILDINGS.temple.days },
    });
    const old = JSON.parse(saveGame(buildFixture())) as { state: GameState };
    for (const city of Object.values(old.state.cities)) {
      delete (city as Partial<typeof city>).buildings;
      delete (city as Partial<typeof city>).construction;
    }
    expect(loadGame(JSON.stringify({ format: 9, state: old.state }))).toMatchObject({ ok: false });
    expect(loadGame(JSON.stringify({ format: SAVE_FORMAT, state: old.state }))).toMatchObject({
      ok: false,
    });
  });
});

const NEAR_CAPUA = { x: 2641.8, y: 2448.3 };

/** Carthage starves out Capua, which stands with towers and a temple and has canals at work, on day 2. */
function capuaFallen(): { state: GameState; events: DayEvent[] } {
  let state = rich();
  withBuilt(state, FIXTURE.capua, 'towers', 'temple');
  need(state.cities[FIXTURE.capua]).construction = { building: 'canals', daysLeft: 10 };
  executeOrder(
    state,
    { kind: 'declareWar', faction: FIXTURE.carthage, against: FIXTURE.rome },
    world,
  );
  need(state.armies[FIXTURE.punicArmy]).activity = { kind: 'idle', position: NEAR_CAPUA };
  need(state.armies[FIXTURE.romanArmy]).activity = { kind: 'idle', position: { x: 0, y: 0 } };
  need(state.cities[FIXTURE.capua]).foodDays = 0;
  need(state.cities[FIXTURE.capua]).garrison = 100;
  const events: DayEvent[] = [];
  for (let day = 0; day < 2; day++) {
    const next = tick(state, [], world);
    events.push(...next.events);
    state = next.state;
  }
  expect(state.cities[FIXTURE.capua]).toMatchObject({ owner: FIXTURE.carthage, fellOn: 2 });
  return { state: structuredClone(state) as GameState, events };
}

describe('a captured city', () => {
  test('falls with its finished buildings, and the building at work is lost', () => {
    const { state, events } = capuaFallen();
    expect(state.cities[FIXTURE.capua]).toMatchObject({
      buildings: ['towers', 'temple'],
      construction: null,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'buildingsLost',
        city: FIXTURE.capua,
        owner: FIXTURE.rome,
        buildings: ['canals'],
        cause: 'siege',
      }),
    );
    expectConsistent(state);
  });

  test('occupied keeps its buildings, which then serve the new owner', () => {
    const { state } = capuaFallen();
    const after = tick(state, [], world).state;
    expect(need(after.cities[FIXTURE.capua]).buildings).toEqual(['towers', 'temple']);
    expect(fullDefences(need(after.cities[FIXTURE.capua])).garrison).toBe(1950);
    expectConsistent(after);
  });

  test('sacked loses every building, with the news', () => {
    const { state } = capuaFallen();
    const sack: Order = { kind: 'sack', faction: FIXTURE.carthage, city: FIXTURE.capua };
    const { state: after, events } = tick(state, [sack], world);
    expect(need(after.cities[FIXTURE.capua]).buildings).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'buildingsLost',
        city: FIXTURE.capua,
        owner: FIXTURE.carthage,
        buildings: ['towers', 'temple'],
        cause: 'sack',
      }),
    );
    expectConsistent(after);
  });

  test('enslaved keeps its buildings', () => {
    const { state } = capuaFallen();
    const enslave: Order = { kind: 'enslave', faction: FIXTURE.carthage, city: FIXTURE.capua };
    const { state: after, events } = tick(state, [enslave], world);
    expect(need(after.cities[FIXTURE.capua]).buildings).toEqual(['towers', 'temple']);
    expect(events.some((event) => event.kind === 'buildingsLost')).toBe(false);
    expectConsistent(after);
  });

  test('changing owner outside a siege keeps the buildings too', () => {
    const state = withBuilt(rich(), FIXTURE.capua, 'canals');
    changeCityOwner(state, FIXTURE.capua, FIXTURE.carthage);
    expect(need(state.cities[FIXTURE.capua]).buildings).toEqual(['canals']);
    expectConsistent(state);
  });
});

describe('loading a save', () => {
  test('refuses a city with a building twice, or at work on one it has finished', () => {
    for (const change of [
      (city: { buildings: BuildingKind[] }) => city.buildings.push('forum', 'forum'),
      (city: { buildings: BuildingKind[]; construction: unknown }) => {
        city.buildings.push('forum');
        city.construction = { building: 'forum', daysLeft: 3 };
      },
    ]) {
      const state = buildFixture();
      change(need(state.cities[FIXTURE.roma]));
      const loaded = loadGame(saveGame(state));
      expect(loaded.ok).toBe(false);
    }
  });
});
