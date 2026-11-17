import { describe, expect, test } from 'vitest';
import { decideOrders } from '../ai/decide.ts';
import { NOTICE_DAYS, NOTICE_SHARE } from '../ai/thresholds.ts';
import { warReadiness } from '../ai/war.ts';
import { changeCityOwner } from '../cities.ts';
import { fixtureWorld } from '../fixture.ts';
import type { CityId, FactionId } from '../ids.ts';
import { newGame } from '../new-game.ts';
import { executeOrder } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import { warKey } from '../state/war.ts';
import { tick } from '../tick.ts';
import { TROOPS } from '../troops.ts';
import { limitsOf } from './economy.ts';
import { notice } from './notice.ts';

const world = fixtureWorld();
const rome = 'rome' as FactionId;
const carthage = 'carthage' as FactionId;
const WEST = [
  'caralis',
  'cirta',
  'iol-caesarea',
  'cidamus',
  'tarraco',
  'carthago-nova',
  'numantia',
  'burdigala',
] as CityId[];

function men(state: GameState, owner: FactionId, count: number) {
  const army = Object.values(state.armies).find((a) => a.owner === owner);
  const formation = army && state.formations[army.formations[0] as never];
  if (!formation) throw new Error(`no army of ${owner}`);
  formation.men = count;
}

/** Carthage at peace with every minor on day 100, ready to declare on Rome by `path`. */
function ready(path: 'strength' | 'pressure'): GameState {
  const state = newGame(world.map, { seed: 1, player: 'rome' });
  state.day = 100 as Day;
  for (const faction of Object.values(state.factions))
    if (faction.kind === 'minor')
      state.truces[warKey(carthage, faction.id)] = {
        since: state.day,
        endsOn: (state.day + 365) as Day,
      };
  if (path === 'strength') {
    for (const id of WEST) changeCityOwner(state, id, carthage);
    men(state, carthage, 6500);
    men(state, rome, 4000);
    const romans = state.factions[rome];
    if (romans) romans.stores.gold = limitsOf(state).get(rome)?.gold ?? 0;
  } else {
    men(state, carthage, 4000);
    men(state, rome, 1000);
  }
  return state;
}

const declares = (state: GameState) =>
  decideOrders(state, world, carthage).some(
    (order) => order.kind === 'declareWar' && order.against === rome,
  );

/** Plays the notice system for the days, as each tick does, with nothing else changing. */
function standFor(state: GameState, days: number) {
  for (let day = 0; day < days; day++) {
    notice(state, world);
    state.day = (state.day + 1) as Day;
  }
}

describe('a great power declares on the player only after it has stood on notice', () => {
  for (const path of ['strength', 'pressure'] as const) {
    test(`by ${path}: not before ${NOTICE_DAYS} days on notice, and on the day they are out`, () => {
      const state = ready(path);
      const threat = warReadiness(state, world, carthage, rome);
      expect(threat?.pressed).toBe(path === 'pressure');
      expect(threat?.readiness).toBeGreaterThanOrEqual(1);
      expect(declares(state)).toBe(false);
      standFor(state, NOTICE_DAYS - 1);
      expect(state.factions[carthage]?.noticeSince).toBe(100);
      expect(declares(state)).toBe(false);
      standFor(state, 1);
      expect(declares(state)).toBe(true);
      expectConsistent(state);
    });
  }

  test('forgets the notice on a day the power stands lower, and at war', () => {
    const start = ready('strength');
    standFor(start, 10);
    expect(start.factions[carthage]?.noticeSince).toBe(100);
    // The AI keeps what it reckoned of each record, so each change is made on a fresh copy.
    const weaker = structuredClone(start);
    men(weaker, carthage, 100);
    standFor(weaker, 1);
    expect(weaker.factions[carthage]?.noticeSince).toBeNull();
    const again = structuredClone(weaker);
    men(again, carthage, 6500);
    standFor(again, 1);
    expect(again.factions[carthage]?.noticeSince).toBe(again.day - 1);
    expect(
      executeOrder(again, { kind: 'declareWar', faction: carthage, against: rome }, world),
    ).toBeUndefined();
    standFor(again, 1);
    expect(again.factions[carthage]?.noticeSince).toBeNull();
    expectConsistent(again);
  });

  test('men who muster after the first day war may come still lower a notice the power holds', () => {
    let state = ready('pressure');
    men(state, rome, 2550);
    for (let day = 0; day < NOTICE_DAYS; day++) state = tick(state, [], world).state;
    // Past its first day of war, the power holds its notice below the full strength it needs, so it may not declare.
    expect(state.factions[carthage]?.noticeSince).toBe(100);
    expect(declares(state)).toBe(false);
    const ordered = state.day;
    state = tick(
      state,
      [{ kind: 'recruit', faction: rome, city: 'roma' as CityId, troop: 'skirmishers' }],
      world,
    ).state;
    while (state.day < ordered + TROOPS.skirmishers.recruit.days) {
      expect(state.factions[carthage]?.noticeSince).toBe(100);
      state = tick(state, [], world).state;
    }
    state = tick(state, [], world).state;
    expect(state.factions[carthage]?.noticeSince).toBeNull();
    expect(warReadiness(state, world, carthage, rome)?.readiness).toBeLessThan(NOTICE_SHARE);
    expectConsistent(state);
  });

  test('holds back no war on a faction that is not the player', () => {
    const state = ready('pressure');
    state.truces = {};
    expect(decideOrders(state, world, carthage)).toContainEqual(
      expect.objectContaining({ kind: 'declareWar', faction: carthage }),
    );
  });
});
