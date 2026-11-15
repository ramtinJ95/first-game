import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import { parseMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import { executeOrder } from '../sim/orders/orders.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey } from '../sim/state/war.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import { buildWorld } from '../sim/world/world.ts';
import { threatNewsOfDay } from './threat-news.ts';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
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

function spearmenOf(state: GameState, owner: FactionId) {
  const army = Object.values(state.armies).find((a) => a.owner === owner);
  const spearmen = army && state.formations[army.formations[0] as never];
  if (!spearmen) throw new Error(`no spearmen of ${owner}`);
  return spearmen;
}

/**
 * Rome as the player with 4,000 spearmen beside a Carthage of twelve cities at peace with
 * every minor, with `men` spearmen.
 */
function game(men: number, gold: 'full' | 'empty'): GameState {
  const state = newGame(map, { seed: 1, player: 'rome' });
  for (const id of WEST) changeCityOwner(state, id, carthage);
  for (const faction of Object.values(state.factions))
    if (faction.kind === 'minor')
      state.truces[warKey(carthage, faction.id)] = {
        since: state.day,
        endsOn: (state.day + 365) as Day,
      };
  spearmenOf(state, carthage).men = men;
  spearmenOf(state, rome).men = 4000;
  const romans = state.factions[rome];
  if (!romans) throw new Error('no Rome');
  romans.stores.gold = gold === 'full' ? (limitsOf(state).get(rome)?.gold ?? 0) : 0;
  return state;
}

/** The news of a day that ends in the state. */
const newsOf = (state: GameState, told: Set<string>) => threatNewsOfDay(state, state, world, told);

describe('the news of a power that could soon declare war on the player', () => {
  test('tells once when a power nears the odds it needs, with what the treasury takes off', () => {
    const told = new Set<string>();
    const state = game(5300, 'full');
    const news = newsOf(state, told);
    expect(news.map((alert) => alert.text)).toEqual([
      expect.stringMatching(
        /^Carthage could soon declare war on you: its armies have \d+% of the strength it needs against your forces near Roma\. Your treasury of [\d,]+ gold lowers what it needs by 25%, since a peace would make you pay it\. Guards hired at Roma count against it\.$/,
      ),
    ]);
    expect(news[0]?.tone).toBe('bad');
    expect(newsOf(state, told)).toEqual([]);
  });

  test('says nothing of a power far from the odds it needs', () => {
    expect(newsOf(game(5300, 'empty'), new Set())).toEqual([]);
  });

  test('tells again once the power fell back, or after a war between them', () => {
    const told = new Set<string>();
    expect(newsOf(game(5300, 'full'), told)).toHaveLength(1);
    expect(newsOf(game(2000, 'empty'), told)).toEqual([]);
    expect(newsOf(game(5300, 'full'), told)).toHaveLength(1);

    const atWar = game(5300, 'full');
    expect(
      executeOrder(atWar, { kind: 'declareWar', faction: carthage, against: rome }, world),
    ).toBeUndefined();
    expect(newsOf(atWar, told)).toEqual([]);
    expect(newsOf(game(5300, 'full'), told)).toHaveLength(1);
  });
});
