import { describe, expect, test } from 'vitest';
import { BUILDINGS, FIRST_LEVELS, SECOND_LEVELS } from '../buildings/buildings.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../fixture.ts';
import { executeOrder } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import type { FactionId, FormationId } from '../ids.ts';
import { newGame } from '../new-game.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import { warKey } from '../state/war.ts';
import { TROOPS } from '../troops.ts';
import { mostNeeded } from './budget.ts';
import { decideOrders } from './decide.ts';
import { savingFor } from './saving.ts';
import { reserveOf } from './situation.ts';
import { NOTICE_SHARE } from './thresholds.ts';
import { warReadiness } from './war.ts';

function need<T>(value: T | undefined, what = 'a record'): T {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const world = fixtureWorld();

/** Rome at peace with every first and second level in its cities, men to call up, and `over` gold beyond its reserve. */
function grown(over: number): GameState {
  const state = buildFixture();
  for (const city of Object.values(state.cities))
    if (city.owner === f.rome)
      city.buildings = [...FIRST_LEVELS, ...FIRST_LEVELS.map((kind) => SECOND_LEVELS[kind])];
  const stores = need(state.factions[f.rome]).stores;
  stores.manpower = 10_000;
  stores.food = 10_000;
  stores.gold = reserveOf(state, f.rome, 'gold') + over;
  return state;
}

/** A copy the AI has not read yet: its caches hold each state as it first read it. */
const fresh = (state: GameState) => structuredClone(state);

const recruitsOf = (state: GameState, faction: FactionId) =>
  decideOrders(state, world, faction).filter((order) => order.kind === 'recruit');
const recruits = (state: GameState) => recruitsOf(state, f.rome);

const rome = 'rome' as FactionId;
const carthage = 'carthage' as FactionId;

/** Sets the men of the first formation of the faction's first army. */
function men(state: GameState, owner: FactionId, count: number) {
  const army = Object.values(state.armies).find((a) => a.owner === owner);
  need(state.formations[need(army).formations[0] as FormationId]).men = count;
}

describe('a great power at war with no great power saves for its next building', () => {
  test('it keeps the price of the work that pays back soonest and raises no recruit it would cut into', () => {
    const recruitGold = TROOPS[mostNeeded(grown(0), f.rome)].recruit.gold;
    const state = grown(recruitGold * 2);
    const saving = need(savingFor(state, world, f.rome), 'a saving');
    expect(saving).toEqual({
      city: f.roma,
      building: 'treasuryHall',
      gold: BUILDINGS.treasuryHall.gold,
    });
    expect(recruitGold * 2).toBeLessThan(saving.gold);
    expect(recruits(state)).toEqual([]);
    expect(decideOrders(state, world, f.rome).some((order) => order.kind === 'build')).toBe(false);
    expectConsistent(state);
  });

  test('it orders the work once its gold over the reserve pays for it', () => {
    const state = grown(BUILDINGS.treasuryHall.gold);
    const orders = decideOrders(state, world, f.rome);
    const build = need(orders.find((order) => order.kind === 'build'));
    expect(build).toEqual({
      kind: 'build',
      faction: f.rome,
      city: f.roma,
      building: 'treasuryHall',
    });
    expect(executeOrder(state, build, world)).toBeUndefined();
    expect(savingFor(fresh(state), world, f.rome)).toBeUndefined();
    expectConsistent(state);
  });

  test('it saves for a first level left before any great work', () => {
    const state = grown(TROOPS.spearmen.recruit.gold * 2);
    const roma = need(state.cities[f.roma]);
    roma.buildings = roma.buildings.filter((kind) => kind !== 'forum' && kind !== 'lawCourts');
    expect(savingFor(state, world, f.rome)).toEqual({
      city: f.roma,
      building: 'forum',
      gold: BUILDINGS.forum.gold,
    });
  });

  test('a war on a minor does not end the saving', () => {
    const state = grown(TROOPS.spearmen.recruit.gold * 2);
    const minor = need(
      Object.values(state.factions).find((faction) => faction.kind === 'minor'),
      'a minor',
    );
    expect(
      executeOrder(state, { kind: 'declareWar', faction: f.rome, against: minor.id }, world),
    ).toBeUndefined();
    expect(savingFor(fresh(state), world, f.rome)?.building).toBe('treasuryHall');
  });

  test('it does not save while its gold falls, so it neither recruits nor builds for nothing', () => {
    const state = grown(TROOPS.spearmen.recruit.gold * 2);
    need(state.formations[f.hastati]).men = 5000;
    expect(savingFor(state, world, f.rome)).toBeUndefined();
  });

  test('the saving ends the day a war with a great power comes', () => {
    const recruitGold = TROOPS[mostNeeded(grown(0), f.rome)].recruit.gold;
    const state = grown(recruitGold * 2);
    expect(recruits(state)).toEqual([]);
    expect(
      executeOrder(state, { kind: 'declareWar', faction: f.carthage, against: f.rome }, world),
    ).toBeUndefined();
    expect(savingFor(fresh(state), world, f.rome)).toBeUndefined();
    expect(recruits(fresh(state))).toHaveLength(1);
  });

  test('the saving ends the day a great power stands on notice against it', () => {
    const state = newGame(world.map, { seed: 1, player: 'rome' });
    state.day = 100 as Day;
    for (const faction of Object.values(state.factions))
      if (faction.kind === 'minor')
        state.truces[warKey(carthage, faction.id)] = {
          since: state.day,
          endsOn: (state.day + 365) as Day,
        };
    for (const city of Object.values(state.cities))
      if (city.owner === rome)
        city.buildings = FIRST_LEVELS.filter(
          (kind) => city.population >= BUILDINGS[kind].needs.people,
        );
    men(state, rome, 1000);
    men(state, carthage, 500);
    const stores = need(state.factions[rome]).stores;
    Object.assign(stores, { manpower: 10_000, food: 10_000 });
    stores.gold = reserveOf(state, rome, 'gold') + 2 * TROOPS.spearmen.recruit.gold;
    const calm = fresh(state);
    expect(need(warReadiness(calm, world, carthage, rome)).readiness).toBeLessThan(NOTICE_SHARE);
    expect(savingFor(calm, world, rome)?.building).toBeDefined();
    expect(recruitsOf(calm, rome)).toEqual([]);
    men(state, carthage, 4000);
    const threatened = fresh(state);
    expect(need(warReadiness(threatened, world, carthage, rome)).readiness).toBeGreaterThanOrEqual(
      NOTICE_SHARE,
    );
    expect(savingFor(threatened, world, rome)).toBeUndefined();
    expect(recruitsOf(threatened, rome)).toHaveLength(1);
  });
});
