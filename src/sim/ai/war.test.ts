import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../cities.ts';
import type { CityId, FactionId } from '../ids.ts';
import { parseMap } from '../map.ts';
import { newGame } from '../new-game.ts';
import { executeOrder } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import { warKey } from '../state/war.ts';
import { ADMIN_CITIES, limitsOf } from '../systems/economy.ts';
import { buildWorld } from '../world/world.ts';
import { buildFixture, FIXTURE, fixtureWorld, onNotice } from '../fixture.ts';
import { decideOrders } from './decide.ts';
import { HOARD_ODDS_SHARE, STAY_HOME_CAP, STAY_HOME_PER_YEAR } from './thresholds.ts';
import { warReadiness } from './war.ts';
import { GUARD_BAND, GUARD_DAYS, GUARD_DETER_DAYS } from '../guards.ts';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const carthage = 'carthage' as FactionId;

/** Eight minor cities west of Carthago, which grow Carthage to twelve, a third past ADMIN_CITIES. */
const WEST: readonly CityId[] = [
  'caralis',
  'cirta',
  'iol-caesarea',
  'cidamus',
  'tarraco',
  'carthago-nova',
  'numantia',
  'burdigala',
] as CityId[];

function spearmenOf(state: GameState, owner: FactionId) {
  const army = Object.values(state.armies).find((a) => a.owner === owner);
  const spearmen = army && state.formations[army.formations[0] as never];
  if (!spearmen) throw new Error(`no spearmen of ${owner}`);
  return spearmen;
}

/**
 * Carthage with 6,500 spearmen, grown by the cities WEST names when `grown`, and in a
 * truce with every minor, beside a Rome of 4,000 spearmen whose treasury is full or empty.
 */
function carthageAndRome({ grown, full }: { grown: boolean; full: boolean }): GameState {
  const state = newGame(map, { seed: 1, player: 'rome' });
  if (grown) for (const id of WEST) changeCityOwner(state, id, carthage);
  for (const faction of Object.values(state.factions))
    if (faction.kind === 'minor')
      state.truces[warKey(carthage, faction.id)] = {
        since: state.day,
        endsOn: (state.day + 365) as Day,
      };
  spearmenOf(state, carthage).men = 6500;
  spearmenOf(state, rome).men = 4000;
  const romans = state.factions[rome];
  if (!romans) throw new Error('no Rome');
  romans.stores.gold = full ? (limitsOf(state).get(rome)?.gold ?? 0) : 0;
  onNotice(state, carthage);
  return state;
}

const declarations = (state: GameState) =>
  decideOrders(state, world, carthage).filter((order) => order.kind === 'declareWar');

describe('a rival great power with a full treasury', () => {
  test('draws a war from a power that has grown, at odds it would not take against an empty treasury', () => {
    const full = carthageAndRome({ grown: true, full: true });
    const empty = carthageAndRome({ grown: true, full: false });
    expect(declarations(full)).toEqual([{ kind: 'declareWar', faction: carthage, against: rome }]);
    expect(declarations(empty)).not.toContainEqual(expect.objectContaining({ against: rome }));
    expectConsistent(full);
    expectConsistent(empty);
  });

  test('weighs no treasury for a power within ADMIN_CITIES', () => {
    const full = carthageAndRome({ grown: false, full: true });
    const empty = carthageAndRome({ grown: false, full: false });
    expect(warReadiness(full, world, carthage, rome)?.hoard).toBe(0);
    expect(warReadiness(full, world, carthage, rome)?.readiness).toBeCloseTo(
      warReadiness(empty, world, carthage, rome)?.readiness ?? 0,
    );
    expectConsistent(full);
  });

  test('tells how near the power stands to war and how much the treasury takes off', () => {
    const full = warReadiness(carthageAndRome({ grown: true, full: true }), world, carthage, rome);
    const empty = warReadiness(
      carthageAndRome({ grown: true, full: false }),
      world,
      carthage,
      rome,
    );
    expect(full?.hoard).toBeCloseTo(HOARD_ODDS_SHARE * (1 - ADMIN_CITIES / 12));
    expect(empty?.hoard).toBe(0);
    expect(full?.readiness).toBeGreaterThanOrEqual(1);
    expect(empty?.readiness).toBeLessThan(1);
    expect(full?.readiness).toBeCloseTo((empty?.readiness ?? 0) / (1 - (full?.hoard ?? 0)));
  });

  test('tells nothing of a power already at war with the faction', () => {
    const state = carthageAndRome({ grown: true, full: true });
    expect(
      executeOrder(state, { kind: 'declareWar', faction: carthage, against: rome }, world),
    ).toBeUndefined();
    expect(warReadiness(state, world, carthage, rome)).toBeUndefined();
    expectConsistent(state);
  });
});

describe('a rival great power that stays in the cities the map gave it', () => {
  /** `carthageAndRome` with Rome's treasury empty, on the day the given years into the game. */
  function inYear(years: number): GameState {
    const state = carthageAndRome({ grown: true, full: false });
    state.day = Math.round(years * 365) as Day;
    return state;
  }

  test('lowers the odds a power needs by STAY_HOME_PER_YEAR a year, to at most STAY_HOME_CAP', () => {
    const start = warReadiness(inYear(0), world, carthage, rome);
    const four = warReadiness(inYear(4), world, carthage, rome);
    const twenty = warReadiness(inYear(20), world, carthage, rome);
    expect(start?.stayedHome).toBe(0);
    expect(four?.stayedHome).toBeCloseTo(4 * STAY_HOME_PER_YEAR);
    expect(four?.readiness).toBeCloseTo((start?.readiness ?? 0) / (1 - 4 * STAY_HOME_PER_YEAR));
    expect(twenty?.stayedHome).toBeCloseTo(STAY_HOME_CAP);
    expect(twenty?.readiness).toBeCloseTo((start?.readiness ?? 0) / (1 - STAY_HOME_CAP));
  });

  test('lowers the pressure a power needs on the rival field armies by the same share', () => {
    const at = (years: number) => {
      const state = inYear(years);
      spearmenOf(state, carthage).men = 8000;
      const roma = state.cities['roma' as CityId];
      if (!roma) throw new Error('no Roma');
      roma.garrison = 80_000;
      return warReadiness(state, world, carthage, rome);
    };
    expect(at(0)?.pressed).toBe(true);
    expect(at(4)?.pressed).toBe(true);
    expect(at(4)?.readiness).toBeCloseTo((at(0)?.readiness ?? 0) / (1 - 4 * STAY_HOME_PER_YEAR));
  });

  test('counts cities, not conquests: a rival that lost a city and took another holds no more than the map gave it', () => {
    const state = inYear(4);
    changeCityOwner(state, 'capua' as CityId, carthage);
    changeCityOwner(state, 'deva' as CityId, rome);
    expect(warReadiness(state, world, carthage, rome)?.stayedHome).toBeCloseTo(
      4 * STAY_HOME_PER_YEAR,
    );
    changeCityOwner(state, 'capua' as CityId, rome);
    expect(warReadiness(state, world, carthage, rome)?.stayedHome).toBe(0);
    expectConsistent(state);
  });

  test('ends while the rival holds a city more than the map gave it, and weighs it so again once lost', () => {
    const state = inYear(4);
    changeCityOwner(state, 'mediolanum' as CityId, rome);
    expect(warReadiness(state, world, carthage, rome)?.stayedHome).toBe(0);
    changeCityOwner(state, 'mediolanum' as CityId, carthage);
    expect(warReadiness(state, world, carthage, rome)?.stayedHome).toBeCloseTo(
      4 * STAY_HOME_PER_YEAR,
    );
    expectConsistent(state);
  });
});

describe('how near a power stands to war', () => {
  const tiny = fixtureWorld();

  test('counts the pressure on a rival great power that keeps to its homeland', () => {
    const state = buildFixture();
    const hastati = state.formations[FIXTURE.hastati];
    const spears = state.formations[FIXTURE.citizenSpears];
    if (!hastati || !spears) throw new Error('no fixture formations');
    hastati.men = 2000;
    spears.men = 500;
    expect(
      executeOrder(
        state,
        { kind: 'declareWar', faction: FIXTURE.rome, against: FIXTURE.syracusaeFaction },
        tiny,
      ),
    ).toBeUndefined();
    expect(decideOrders(state, tiny, FIXTURE.rome)).toContainEqual({
      kind: 'declareWar',
      faction: FIXTURE.rome,
      against: FIXTURE.carthage,
    });
    const readiness = warReadiness(state, tiny, FIXTURE.rome, FIXTURE.carthage);
    expect(readiness?.readiness).toBeGreaterThanOrEqual(1);
    expect(readiness?.pressed).toBe(true);
    expectConsistent(state);
  });

  test('stands at nothing while its wars hold back all its strength', () => {
    const state = buildFixture();
    expect(
      executeOrder(
        state,
        { kind: 'declareWar', faction: FIXTURE.carthage, against: FIXTURE.rome },
        tiny,
      ),
    ).toBeUndefined();
    const punic = state.armies[FIXTURE.punicArmy];
    const spears = state.formations[FIXTURE.citizenSpears];
    if (!punic || !spears) throw new Error('no Punic army');
    spears.men = 5000;
    punic.activity = { kind: 'idle', position: { x: 2229.9, y: 2865.1 } };
    expect(warReadiness(state, tiny, FIXTURE.rome, FIXTURE.syracusaeFaction)?.readiness).toBe(0);
    expectConsistent(state);
  });
});

describe('guards a great power weighs before it declares', () => {
  /** The full state with its front city's walls held by `bands` bands hired `ago` days before. */
  function guarded(bands: number, ago: number): { state: GameState; front: CityId } {
    const state = carthageAndRome({ grown: true, full: true });
    const front = warReadiness(state, world, carthage, rome)?.front;
    const city = front && state.cities[front];
    if (!city) throw new Error('no front city');
    city.guards = Array.from({ length: bands }, () => ({
      until: (state.day + GUARD_DAYS - ago) as Day,
    }));
    city.garrison += bands * GUARD_BAND;
    return { state, front: city.id };
  }

  test(`count for their first ${GUARD_DETER_DAYS} days, and hold back the war while they do`, () => {
    const { state, front } = guarded(3, 0);
    const open = carthageAndRome({ grown: true, full: true });
    expect(declarations(open)).toEqual([{ kind: 'declareWar', faction: carthage, against: rome }]);
    expect(warReadiness(state, world, carthage, rome)?.front).toBe(front);
    expect(warReadiness(state, world, carthage, rome)?.readiness ?? 0).toBeLessThan(
      warReadiness(open, world, carthage, rome)?.readiness ?? 0,
    );
    expect(declarations(state)).toEqual([]);
    expectConsistent(state);
  });

  test(`count for nothing after ${GUARD_DETER_DAYS} days, though they still stand on the walls`, () => {
    const { state } = guarded(3, GUARD_DETER_DAYS);
    const open = carthageAndRome({ grown: true, full: true });
    expect(warReadiness(state, world, carthage, rome)?.readiness).toBeCloseTo(
      warReadiness(open, world, carthage, rome)?.readiness ?? 0,
    );
    expect(declarations(state)).toEqual([{ kind: 'declareWar', faction: carthage, against: rome }]);
    expectConsistent(state);
  });
});
