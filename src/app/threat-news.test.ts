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
import { dateText } from './names.ts';
import { NOTICE_DAYS } from '../sim/ai/thresholds.ts';
import { notice } from '../sim/systems/notice.ts';
import { ALL_PAUSES, stopsOfDay } from './pauses.ts';
import {
  THREAT_STAND_DAYS,
  powersNearWar,
  standingThreats,
  threatNewsOfDay,
} from './threat-news.ts';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const carthage = 'carthage' as FactionId;
const macedon = 'macedon' as FactionId;

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

/** The news of a day that ends in the state, once the day's notice is kept. */
function newsOf(state: GameState, told: Set<string>, stood = THREAT_STAND_DAYS) {
  notice(state, world);
  for (const power of Object.values(state.factions))
    if (power.noticeSince !== null) power.noticeSince = (state.day - stood + 1) as Day;
  return threatNewsOfDay(state, state, world, told);
}

describe('the news of a power that could soon declare war on the player', () => {
  test('tells once when a power nears the odds it needs, with what the treasury takes off', () => {
    const told = new Set<string>();
    const state = game(5300, 'full');
    const news = newsOf(state, told);
    expect(news.map((alert) => alert.text)).toEqual([
      expect.stringMatching(
        /^Carthage could soon declare war on you: it has \d+% of the strength it needs against your forces near Roma, and may declare from Year \d+, day \d+ if it holds it\. Your treasury of [\d,]+ gold lowers the strength it needs by 25%, so more gold brings war nearer\. Your armies near Roma and guards hired there count against it, guards for their first 90 days\. See At peace in Wars\.$/,
      ),
    ]);
    expect(news[0]?.tone).toBe('bad');
    expect(newsOf(state, told)).toEqual([]);
  });

  test('says nothing of a power far from the odds it needs', () => {
    expect(newsOf(game(5300, 'empty'), new Set())).toEqual([]);
  });

  test('tells nothing of a strength that has stood under a week, and names the day war may come once it has', () => {
    expect(newsOf(game(5300, 'full', 100), new Set(), THREAT_STAND_DAYS - 1)).toEqual([]);
    const [warning] = newsOf(game(5300, 'full', 100), new Set());
    expect(warning?.text).toContain(
      `and may declare from ${dateText(100 - THREAT_STAND_DAYS + 1 + NOTICE_DAYS)} if it holds it.`,
    );
  });

  test('tells once while the power stays on notice, though it falls back for months and returns', () => {
    const told = new Set<string>();
    expect(newsOf(game(5300, 'full', 0), told)).toHaveLength(1);
    expect(newsOf(game(2000, 'empty', 10), told)).toEqual([]);
    expect(newsOf(game(5300, 'full', 310), told)).toEqual([]);
    expect(newsOf(game(5300, 'full', 334), told)).toEqual([]);
  });

  test('a power that comes back on notice warns again in time for the war it may then declare', () => {
    const told = new Set<string>();
    expect(newsOf(game(5300, 'full', 100), told)).toHaveLength(1);
    expect(newsOf(game(2000, 'empty', 200), told)).toEqual([]);
    expect(newsOf(game(5300, 'full', 450), told)).toHaveLength(1);
  });

  test('tells again a power still on notice 335 days after it warned, and after a war between them', () => {
    const told = new Set<string>();
    expect(newsOf(game(5300, 'full', 0), told)).toHaveLength(1);
    expect(newsOf(game(5300, 'full', 334), told)).toEqual([]);
    expect(newsOf(game(5300, 'full', 335), told)).toHaveLength(1);

    const atWar = game(5300, 'full', 400);
    expect(
      executeOrder(atWar, { kind: 'declareWar', faction: carthage, against: rome }, world),
    ).toBeUndefined();
    expect(newsOf(atWar, told)).toEqual([]);
    expect(newsOf(game(5300, 'full', 401), told)).toHaveLength(1);
  });
});

describe('how near each power at peace stands to declaring war, as the wars panel lists it', () => {
  test('names the share it has, where it weighs your forces, and what your treasury and guards do, in the news words', () => {
    const state = game(5300, 'full');
    const carthage = standingThreats(state, world).find((t) => t.power === 'carthage');
    expect(carthage?.text).toMatch(
      /^Carthage has \d+% of the strength it needs to declare war on you, against your forces near Roma\. Your treasury of [\d,]+ gold lowers the strength it needs by 25%, so more gold brings war nearer\. Your armies near Roma and guards hired there count against it, guards for their first 90 days\.$/,
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

  test('says a power pressing you by its field armies is lowered by more men, not by guards', () => {
    const state = game(8000, 'full');
    const roma = state.cities['roma' as CityId];
    if (!roma) throw new Error('no Roma');
    roma.garrison = 80_000;
    const carthaginian = standingThreats(state, world).find((t) => t.power === 'carthage');
    expect(carthaginian?.text).toMatch(
      /^Carthage has \d+% of the strength it needs to declare war on you, against all your armies in the field\. More men lower it: Skirmishers cost 900 gold and train in 10 days\. Guards do not\. It weighs you so only while you hold no more cities than at the start\.$/,
    );
    expect(newsOf(state, new Set()).map((alert) => alert.text)).toEqual([
      expect.stringMatching(
        /^Carthage could soon declare war on you: it has \d+% of the strength it needs against all your armies in the field, and may declare from Year \d+, day \d+ if it holds it\. More men lower it.*Guards do not.*See At peace in Wars\.$/,
      ),
    ]);
  });

  test('says what the cheapest troop costs when you cannot afford it', () => {
    const state = game(8000, 'empty');
    const roma = state.cities['roma' as CityId];
    if (!roma) throw new Error('no Roma');
    roma.garrison = 80_000;
    const carthaginian = standingThreats(state, world).find((t) => t.power === 'carthage');
    expect(carthaginian?.text).toContain(
      'More men lower it, but Skirmishers, the cheapest, cost 900 gold; you have 0. Guards do not.',
    );
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

describe('a war warning stops the game', () => {
  test("each power's first warning in a peace stops it, a second power's too, and nothing told again stops it", () => {
    const told = new Set<string>();
    const state = game(5300, 'full');
    const carthaginian = stopsOfDay(newsOf(state, told), ALL_PAUSES, new Set());
    expect(carthaginian.stop).toBe(true);
    expect(carthaginian.news.map((alert) => alert.paused)).toEqual([true]);
    expect(stopsOfDay(newsOf(state, told), ALL_PAUSES, new Set()).stop).toBe(false);

    const both = game(5300, 'full');
    spearmenOf(both, macedon).men = 30_000;
    const macedonian = stopsOfDay(newsOf(both, told), ALL_PAUSES, new Set());
    expect(macedonian.news.map((alert) => alert.text)).toEqual([
      expect.stringMatching(/^Macedon could soon declare war on you/),
    ]);
    expect(macedonian.stop).toBe(true);
  });

  test('two powers warning on one day are one stopped line that names both', () => {
    const both = game(5300, 'full', 100);
    spearmenOf(both, macedon).men = 30_000;
    const news = newsOf(both, new Set());
    expect(news.map((alert) => alert.text)).toEqual([
      expect.stringMatching(
        /^Carthage and Macedon could soon declare war on you, with \d+% and \d+% of the strength each needs\. If they hold it, Carthage may declare from Year \d+, day \d+ and Macedon may declare from Year \d+, day \d+\. What lowers each is under At peace in Wars\.$/,
      ),
    ]);
    expect(stopsOfDay(news, ALL_PAUSES, new Set()).stop).toBe(true);
  });

  test('the Game menu setting turns the stop off', () => {
    const news = newsOf(game(5300, 'full'), new Set());
    expect(stopsOfDay(news, { ...ALL_PAUSES, warThreat: false }, new Set()).stop).toBe(false);
  });
});
