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
import { decideOrders } from './decide.ts';
import { HOARD_ODDS_SHARE } from './thresholds.ts';
import { warReadiness } from './war.ts';

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
