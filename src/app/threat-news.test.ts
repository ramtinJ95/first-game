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
import { powersNearWar, standingThreats, threatNewsOfDay } from './threat-news.ts';

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
function game(men: number, gold: 'full' | 'empty', day = 0): GameState {
  const state = newGame(map, { seed: 1, player: 'rome' });
  state.day = day as Day;
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
        /^Carthage could soon declare war on you: its armies have \d+% of the strength it needs against your forces near Roma\. Your treasury of [\d,]+ gold lowers what it needs by 25%, since a peace would make you pay it\. Guards hired at Roma count against it for their first 90 days\. Watch it under At peace in the Wars panel\.$/,
      ),
    ]);
    expect(news[0]?.tone).toBe('bad');
    expect(newsOf(state, told)).toEqual([]);
  });

  test('says nothing of a power far from the odds it needs', () => {
    expect(newsOf(game(5300, 'empty'), new Set())).toEqual([]);
  });

  test('tells once in a peace although the power falls back for months and returns', () => {
    const told = new Set<string>();
    expect(newsOf(game(5300, 'full', 0), told)).toHaveLength(1);
    expect(newsOf(game(2000, 'empty', 10), told)).toEqual([]);
    expect(newsOf(game(2000, 'empty', 300), told)).toEqual([]);
    expect(newsOf(game(5300, 'full', 310), told)).toEqual([]);
    expect(newsOf(game(2000, 'empty', 320), told)).toEqual([]);
    expect(newsOf(game(5300, 'full', 600), told)).toEqual([]);
  });

  test('tells again once the power stayed below the threat for a year, or after a war between them', () => {
    const told = new Set<string>();
    expect(newsOf(game(5300, 'full', 0), told)).toHaveLength(1);
    expect(newsOf(game(2000, 'empty', 10), told)).toEqual([]);
    const aYearLess = new Set(told);
    expect(newsOf(game(5300, 'full', 374), aYearLess)).toEqual([]);
    expect(newsOf(game(5300, 'full', 375), told)).toHaveLength(1);

    const atWar = game(5300, 'full');
    expect(
      executeOrder(atWar, { kind: 'declareWar', faction: carthage, against: rome }, world),
    ).toBeUndefined();
    expect(newsOf(atWar, told)).toEqual([]);
    expect(newsOf(game(5300, 'full'), told)).toHaveLength(1);
  });
});

describe('how near each power at peace stands to declaring war, as the wars panel lists it', () => {
  test('names the share it has, where it weighs your forces, and what your treasury and guards do, in the news words', () => {
    const state = game(5300, 'full');
    const carthage = standingThreats(state, world).find((t) => t.power === 'carthage');
    expect(carthage?.text).toMatch(
      /^Carthage has \d+% of the strength it needs to declare war on you, against your forces near Roma\. Your treasury of [\d,]+ gold lowers what it needs by 25%, since a peace would make you pay it\. Guards hired at Roma count against it for their first 90 days\.$/,
    );
    const weaker = standingThreats(game(2000, 'full'), world).find((t) => t.power === 'carthage');
    expect(weaker?.readiness).toBeLessThan(carthage?.readiness ?? 0);
    expect(standingThreats(state, world).map((t) => t.power)).not.toContain('rome');
  });

  test('says a power far from your cities is not weighing a war on you', () => {
    const egypt = standingThreats(newGame(map, { seed: 1, player: 'rome' }), world).find(
      (t) => t.power === 'egypt',
    );
    expect(egypt).toMatchObject({
      readiness: undefined,
      text: 'Egypt is not weighing a war on you now: none of its cities is near enough to yours, or none of its armies stands ready to march.',
    });
  });

  test('counts the powers at the warning threshold for the top bar, and none once they fall below', () => {
    expect(powersNearWar(game(5300, 'full'), world)).toBe(1);
    expect(powersNearWar(game(2000, 'empty'), world)).toBe(0);
    expect(powersNearWar(game(5300, 'full'), world)).toBe(1);
  });

  test('leaves out a power at war with you or bound by a truce', () => {
    const atWar = game(5300, 'full');
    executeOrder(atWar, { kind: 'declareWar', faction: carthage, against: rome }, world);
    expect(standingThreats(atWar, world).map((t) => t.power)).not.toContain('carthage');
    const truce = game(5300, 'full');
    truce.truces[warKey(carthage, rome)] = { since: truce.day, endsOn: (truce.day + 100) as Day };
    expect(standingThreats(truce, world).map((t) => t.power)).not.toContain('carthage');
  });
});
