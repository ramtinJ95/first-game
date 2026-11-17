import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { allocateId, type ArmyId, type CityId, type FactionId } from '../sim/ids.ts';
import { nameNewArmy } from '../sim/army-names.ts';
import { expectConsistent } from '../sim/references.ts';
import { removeRecord } from '../sim/records.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { distance } from '../sim/world/find-path.ts';
import { parseMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import { executeOrder } from '../sim/orders/orders.ts';
import { tick } from '../sim/tick.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { Stores } from '../sim/state/faction.ts';
import { warKey } from '../sim/state/war.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import { buildWorld } from '../sim/world/world.ts';
import { dateText } from './names.ts';
import { NOTICE_DAYS } from '../sim/ai/thresholds.ts';
import { notice } from '../sim/systems/notice.ts';
import { ALL_PAUSES, stopsOfDay } from './pauses.ts';
import type { Alert } from './alerts.ts';
import {
  THREAT_STAND_DAYS,
  powersNearWar,
  standingThreats,
  threatFadedNewsOfDay,
  threatNewsOfDay,
  weighedNotes,
} from './threat-news.ts';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const carthage = 'carthage' as FactionId;
const macedon = 'macedon' as FactionId;
const egypt = 'egypt' as FactionId;
const persia = 'persia' as FactionId;

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

/** The news of a day that ends in the state, with the power on notice since `since`. */
function onNotice(state: GameState, since: number, told: Set<string>) {
  notice(state, world);
  for (const power of Object.values(state.factions))
    if (power.noticeSince !== null) power.noticeSince = since as Day;
  return threatNewsOfDay(state, state, world, told);
}

describe('the news of a power that could soon declare war on the player', () => {
  test('tells once when a power nears the odds it needs, with what the treasury takes off', () => {
    const told = new Set<string>();
    const state = game(5300, 'full');
    const news = newsOf(state, told);
    expect(news.map((alert) => alert.text)).toEqual([
      expect.stringMatching(
        /^Carthage could soon declare war on you: it has \d+% of the strength it needs against your forces near Roma, and may declare from Year \d+, day \d+ if it holds it\. Your treasury of [\d,]+ gold lowers the strength it needs by 25%, so more gold brings war nearer\. Your armies on land within 1,500 km count; more men, or guards at Roma for 90 days, lower it\. See At peace in Wars\.$/,
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

  test('tells once while the power stays on one notice', () => {
    const told = new Set<string>();
    expect(onNotice(game(5300, 'full', 6), 0, told)).toHaveLength(1);
    expect(onNotice(game(5300, 'full', 7), 0, told)).toEqual([]);
    expect(onNotice(game(5300, 'full', 89), 0, told)).toEqual([]);
  });

  test('a power that comes back on notice warns again in time for the war it may then declare', () => {
    const told = new Set<string>();
    expect(newsOf(game(5300, 'full', 100), told)).toHaveLength(1);
    expect(newsOf(game(2000, 'empty', 200), told)).toEqual([]);
    expect(newsOf(game(5300, 'full', 450), told)).toHaveLength(1);
  });

  test("the tenth play-through's run: a notice that comes back warns once it stands its week, 24 days before the day it names", () => {
    const told = new Set<string>();
    const state = game(5300, 'full');
    const power = state.factions[carthage];
    if (!power) throw new Error('no Carthage');
    const warnings: { on: string; names: string }[] = [];
    // Warned on Year 6, day 273; back on notice on Year 7, day 224, 316 days after.
    for (let day = 2092; day <= 2444; day++) {
      state.day = day as Day;
      power.noticeSince = (day < 2110 ? 2092 : day < 2414 ? null : 2414) as Day | null;
      for (const alert of threatNewsOfDay(state, state, world, told)) {
        const named = /may declare from (Year \d+, day \d+)/.exec(alert.text)?.[1] ?? '';
        warnings.push({ on: dateText(day), names: named });
      }
    }
    expect(warnings).toEqual([
      { on: 'Year 6, day 273', names: 'Year 6, day 297' },
      { on: 'Year 7, day 230', names: 'Year 7, day 254' },
    ]);
  });

  test('a reminder on a notice whose first day of war has passed says war may come any day', () => {
    const told = new Set<string>();
    const state = game(5300, 'full', 100);
    const power = state.factions[carthage];
    if (!power) throw new Error('no Carthage');
    notice(state, world);
    power.noticeSince = 94 as Day;
    const [warning] = threatNewsOfDay(state, state, world, told);
    expect(warning?.text).toMatch(/^Carthage could soon declare war on you: it has \d+% /);
    state.day = 184 as Day;
    const [reminder] = threatNewsOfDay(state, state, world, told);
    expect(reminder?.text).toMatch(
      /^Carthage still stands near war with you, as warned on Year 1, day 100: it has \d+% of the strength it needs against your forces near \w+, and may declare any day now if it holds it\./,
    );
    expect(reminder?.text).not.toContain('may declare from');
    expect(standingThreats(state, world).find((t) => t.power === carthage)?.text).toContain(
      'It may declare any day now if it holds it.',
    );
  });

  test('a power held on one notice is told of again 60 days after each day it was told of', () => {
    const told = new Set<string>();
    const state = game(5300, 'full');
    const power = state.factions[carthage];
    if (!power) throw new Error('no Carthage');
    const warnedOn: number[] = [];
    for (let day = 0; day <= 400; day++) {
      state.day = day as Day;
      power.noticeSince = 0 as Day;
      if (threatNewsOfDay(state, state, world, told).length > 0) warnedOn.push(day);
    }
    expect(warnedOn).toEqual([6, 90, 150, 210, 270, 330, 390]);
  });

  test('tells again a power still on notice 60 days after the day it named, and after a war between them', () => {
    const told = new Set<string>();
    expect(onNotice(game(5300, 'full', 6), 0, told)).toHaveLength(1);
    expect(onNotice(game(5300, 'full', 89), 0, told)).toEqual([]);
    expect(onNotice(game(5300, 'full', 90), 0, told)).toHaveLength(1);

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
      /^Carthage has \d+% of the strength it needs to declare war on you, against your forces near Roma\.$/,
    );
    expect(weighedNotes(state, standingThreats(state, world))).toEqual([
      'Near Roma, your armies on land within 1,500 km count: First Legion (4,300 men). More men, or guards at Roma for 90 days, lower it.',
      'Near Capua, your armies on land within 1,500 km count: First Legion (4,300 men). More men, or guards at Capua for 90 days, lower it.',
      expect.stringMatching(
        /^Your treasury of [\d,]+ gold lowers the strength Carthage needs by 25%, so more gold brings war nearer\.$/,
      ),
    ]);
    const weaker = standingThreats(game(2000, 'full'), world).find((t) => t.power === 'carthage');
    expect(weaker?.readiness).toBeLessThan(carthage?.readiness ?? 0);
    expect(standingThreats(state, world).map((t) => t.power)).not.toContain('rome');
  });

  test('counts every army on land within 1,500 km of the city it weighs, so marching there lowers nothing and more men do', () => {
    /** Carthage's share against Rome with Rome's army idle at the city, as `game` gives it otherwise. */
    const shareWith = (city: string, men = 4000) => {
      const state = game(5300, 'full');
      spearmenOf(state, rome).men = men;
      const army = Object.values(state.armies).find((a) => a.owner === rome);
      const at = state.cities[city as CityId];
      if (!army || !at) throw new Error(`no Roman army or ${city}`);
      army.activity = { kind: 'idle', position: at.position };
      return standingThreats(state, world).find((t) => t.power === carthage)?.readiness ?? 0;
    };
    const atRoma = shareWith('roma');
    expect(shareWith('mediolanum')).toBe(atRoma);
    expect(shareWith('persepolis')).toBeGreaterThan(atRoma);
    expect(shareWith('roma', 6000)).toBeLessThan(atRoma);
  });

  test('leaves out an army at sea, however near', () => {
    const shareOf = (state: GameState) =>
      standingThreats(state, world).find((t) => t.power === carthage)?.readiness ?? 0;
    let ashore = game(5300, 'full');
    let afloat = game(5300, 'full');
    const army = Object.values(afloat.armies).find((a) => a.owner === rome);
    const roma = afloat.cities['roma' as CityId];
    if (!army || army.activity.kind !== 'idle' || !roma) throw new Error('no idle Roman army');
    let orders = [
      {
        kind: 'embark',
        faction: rome,
        army: army.id,
        to: 'syracusae' as CityId,
        from: roma.position,
      } as const,
    ];
    for (let day = 0; day < 30 && afloat.armies[army.id]?.activity.kind !== 'embarked'; day++) {
      afloat = tick(afloat, orders, world).state;
      ashore = tick(ashore, [], world).state;
      orders = [];
    }
    expect(afloat.armies[army.id]?.activity.kind).toBe('embarked');
    expect(shareOf(afloat)).toBeGreaterThan(shareOf(ashore));
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
      /^Carthage has \d+% of the strength it needs to declare war on you, against all your armies in the field\. More men lower it, not guards: Skirmishers cost 900 gold and train in 10 days\. It weighs you so only while you hold no more cities than at the start\.$/,
    );
    expect(newsOf(state, new Set()).map((alert) => alert.text)).toEqual([
      expect.stringMatching(
        /^Carthage could soon declare war on you: it has \d+% of the strength it needs against all your armies in the field, and may declare from Year \d+, day \d+ if it holds it\. More men lower it, not guards.*See At peace in Wars\.$/,
      ),
    ]);
  });

  /** Carthage pressing Rome by its field armies, with Rome's stores as given. */
  function pressedWith(stores: { gold: number; manpower: number }): GameState {
    const state = game(8000, 'empty');
    const roma = state.cities['roma' as CityId];
    const romans = state.factions[rome];
    if (!roma || !romans) throw new Error('no Roma');
    roma.garrison = 80_000;
    Object.assign(romans.stores, stores);
    return state;
  }
  const lineOf = (state: GameState, stores?: Stores) =>
    standingThreats(state, world, stores).find((t) => t.power === carthage)?.text ?? '';

  test('names the cheapest troop you can afford now, or what the cheapest costs and what you lack', () => {
    expect(lineOf(pressedWith({ gold: 2229, manpower: 5000 }))).toContain(
      'More men lower it, not guards: Skirmishers cost 900 gold and train in 10 days.',
    );
    expect(lineOf(pressedWith({ gold: 2229, manpower: 450 }))).toContain(
      'More men lower it, not guards: Light cavalry cost 1,800 gold and train in 20 days.',
    );
    expect(lineOf(pressedWith({ gold: 729, manpower: 5000 }))).toContain(
      'More men lower it, not guards, but even Skirmishers cost 900 gold, 10 days; you have 729 gold.',
    );
    expect(lineOf(pressedWith({ gold: 5000, manpower: 350 }))).toContain(
      'More men lower it, not guards, but even Skirmishers need 500 men, 10 days; you have 350 manpower.',
    );
  });

  /** `pressedWith` on day 100, on notice so that war may first come `left` days on. */
  function pressedFor(left: number, stores: { gold: number; manpower: number }): GameState {
    const state = pressedWith(stores);
    state.day = 100 as Day;
    notice(state, world);
    const power = state.factions[carthage];
    if (!power) throw new Error('no Carthage');
    power.noticeSince = (100 + left - NOTICE_DAYS) as Day;
    return state;
  }

  test('names a troop that finishes training before the day war may come, while one is affordable', () => {
    expect(lineOf(pressedFor(24, { gold: 2229, manpower: 450 }))).toContain(
      'More men lower it, not guards: Light cavalry cost 1,800 gold and train in 20 days.',
    );
    expect(lineOf(pressedFor(11, { gold: 5000, manpower: 5000 }))).toContain(
      'More men lower it, not guards: Skirmishers cost 900 gold and train in 10 days.',
    );
  });

  test('with none affordable ready in time, names the one that is and the day it musters, from which it lowers the threat', () => {
    // The power decides on its day before that day's recruits muster, so these come on the day, not before it.
    expect(lineOf(pressedFor(10, { gold: 5000, manpower: 5000 }))).toContain(
      'More men lower it, not guards: order Skirmishers now for 900 gold; they muster and lower it from Year 1, day 110, the first day war may come.',
    );
    // The tenth play-through's warning, 11 days before war: Light cavalry, the one troop affordable, train in 20.
    expect(lineOf(pressedFor(11, { gold: 2229, manpower: 450 }))).toContain(
      'More men lower it, not guards: order Light cavalry now for 1,800 gold; they muster and lower it from Year 1, day 120, 9 days after war may first come.',
    );
    expect(lineOf(pressedFor(9, { gold: 5000, manpower: 5000 }))).toContain(
      'they muster and lower it from Year 1, day 110, 1 day after war may first come.',
    );
    expect(lineOf(pressedFor(11, { gold: 2229, manpower: 300 }))).toContain(
      'More men lower it, not guards, but even Skirmishers need 500 men, 10 days; you have 300 manpower.',
    );
    for (const left of [1, 5, 10, 23])
      expect(lineOf(pressedFor(left, { gold: 5000, manpower: 5000 }))).toMatch(
        /More men lower it, not guards: (order )?Skirmishers/,
      );
  });

  test('a reminder names what may be raised, with no day to finish before', () => {
    const [reminder] = threatNewsOfDay(
      pressedFor(-60, { gold: 5000, manpower: 5000 }),
      pressedFor(-60, { gold: 5000, manpower: 5000 }),
      world,
      new Set([`threat:carthage:${100 - 60 - 1}`]),
    );
    expect(reminder?.text).toContain(
      'may declare any day now if it holds it. More men lower it, not guards: Skirmishers cost 900 gold and train in 10 days.',
    );
  });

  test("the warning's day and its advice agree across the day the news reckons after", () => {
    const newsOn = (left: number) => {
      const before = pressedFor(left, { gold: 5000, manpower: 5000 });
      const after = structuredClone(before);
      after.day = (before.day + 1) as Day;
      return threatNewsOfDay(before, after, world, new Set())[0]?.text ?? '';
    };
    expect(newsOn(1)).toContain(
      'may declare from Year 1, day 101 if it holds it. More men lower it, not guards: Skirmishers ordered now muster on Year 1, day 111.',
    );
    expect(newsOn(0)).toContain(
      'may declare any day now if it holds it. More men lower it, not guards: Skirmishers cost 900 gold and train in 10 days.',
    );
  });

  test('once the named day has passed, names what may be raised for as long as the notice holds', () => {
    expect(lineOf(pressedFor(-5, { gold: 2229, manpower: 450 }))).toContain(
      'More men lower it, not guards: Light cavalry cost 1,800 gold and train in 20 days. It weighs you so only while you hold no more cities than at the start. It may declare any day now if it holds it.',
    );
    expect(lineOf(pressedFor(-5, { gold: 5000, manpower: 300 }))).toContain(
      'More men lower it, not guards, but even Skirmishers need 500 men, 10 days; you have 300 manpower.',
    );
  });

  test('counts only the cities that may recruit now', () => {
    const state = pressedWith({ gold: 2229, manpower: 5000 });
    for (const city of Object.values(state.cities)) if (city.owner === rome) city.unrestDays = 30;
    expect(lineOf(state)).toContain(
      'More men lower it, not guards, but no city of yours may recruit now.',
    );
  });

  test('reckons what you can afford after the orders waiting, as the wars panel gives them', () => {
    const state = pressedWith({ gold: 2229, manpower: 5000 });
    expect(lineOf(state, { gold: 429, food: 0, manpower: 4000 })).toContain(
      'but even Skirmishers cost 900 gold, 10 days; you have 429 gold.',
    );
  });

  test('the field-army warning is no longer than it was before it named a troop, whatever the stores', () => {
    for (const stores of [
      { gold: 2229, manpower: 5000 },
      { gold: 2229, manpower: 450 },
      { gold: 899, manpower: 5000 },
      { gold: 5000, manpower: 499 },
      { gold: 99_999, manpower: 99_999 },
    ]) {
      const [warning] = newsOf(pressedWith(stores), new Set());
      expect(warning?.text.length ?? 0).toBeLessThanOrEqual(355);
    }
  });

  test('a first warning that comes late, as after a save is imported, is no longer either', () => {
    for (const stores of [
      { gold: 2229, manpower: 450 },
      { gold: 5000, manpower: 5000 },
      { gold: 99_999, manpower: 99_999 },
    ]) {
      const state = pressedWith(stores);
      state.day = 100 as Day;
      const [warning] = onNotice(state, 78, new Set());
      expect(warning?.text).toMatch(/ordered now muster on Year 1, day 1[12]0\./);
      expect(warning?.text.length ?? 0).toBeLessThanOrEqual(355);
    }
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

  test('a reminder told on one day with a first warning marks only the reminded power, with the day it was warned', () => {
    const both = game(5300, 'full', 184);
    spearmenOf(both, macedon).men = 30_000;
    notice(both, world);
    const punic = both.factions[carthage];
    const macedonians = both.factions[macedon];
    if (!punic || !macedonians) throw new Error('no Carthage or Macedon');
    punic.noticeSince = 94 as Day;
    macedonians.noticeSince = (184 - THREAT_STAND_DAYS + 1) as Day;
    const [news] = threatNewsOfDay(both, both, world, new Set(['threat:carthage:100']));
    expect(news?.text).toMatch(
      /^Carthage and Macedon could soon declare war on you, with \d+% and \d+% of the strength each needs\. If they hold it, Carthage, as warned on Year 1, day 100, may declare any day now and Macedon may declare from Year 1, day 208\./,
    );
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

describe('the news of a warned threat that fades', () => {
  /**
   * Carthage on notice since day 94 on day 120, and the day after, when it stands lower; with
   * `reckon` false the day after keeps no notice whatever it stands at. `news` is the news of
   * the day the notice ends, and `week` that of each day after it that the power stands as on
   * the day after, through the day it has stood off notice THREAT_STAND_DAYS.
   */
  function fading(told: Set<string>, after = game(2000, 'empty', 121), reckon = true) {
    const before = game(5300, 'full', 120);
    notice(before, world);
    const power = before.factions[carthage];
    if (!power) throw new Error('no Carthage');
    power.noticeSince = 94 as Day;
    if (reckon) notice(after, world);
    const news = threatFadedNewsOfDay(before, after, world, told);
    const week: Alert[][] = [];
    let day = after;
    for (let n = 1; n < THREAT_STAND_DAYS; n++) {
      const next = structuredClone(day);
      next.day = (day.day + 1) as Day;
      week.push(threatFadedNewsOfDay(day, next, world, told));
      day = next;
    }
    return { before, after: day, news: [...news, ...week.flat()], first: news, week };
  }

  test('tells once, without stopping the game, that a power the player was warned of no longer stands near war', () => {
    const told = new Set(['threat:carthage:100']);
    const { after, news } = fading(told);
    expect(news.map((alert) => alert.text)).toEqual([
      expect.stringMatching(
        /^Carthage's threat has passed for now: it has fallen to \d+% of the strength it needs to declare war on you, and must stand at 80% for 30 days before it may\.$/,
      ),
    ]);
    expect(news[0]?.tone).toBe('good');
    expect(stopsOfDay(news, ALL_PAUSES, new Set()).stop).toBe(false);
    const next = game(2000, 'empty', 122);
    notice(next, world);
    expect(threatFadedNewsOfDay(after, next, world, told)).toEqual([]);
  });

  test('waits until the power has stood off notice a week, as the warning waits', () => {
    const { first, week } = fading(new Set(['threat:carthage:100']));
    expect(first).toEqual([]);
    expect(week.slice(0, -1).flat()).toEqual([]);
    expect(week.at(-1)?.map((alert) => alert.kind)).toEqual(['warThreatFaded']);
    expect(THREAT_STAND_DAYS).toBe(7);
    expect(week).toHaveLength(6);
  });

  test('says nothing of a strength that comes back on notice within the week, nor when that notice ends unwarned', () => {
    const told = new Set(['threat:carthage:100']);
    const before = game(5300, 'full', 120);
    notice(before, world);
    const punic = before.factions[carthage];
    if (!punic) throw new Error('no Carthage');
    punic.noticeSince = 94 as Day;
    const off = game(2000, 'empty', 121);
    notice(off, world);
    const back = game(5300, 'full', 124);
    notice(back, world);
    expect(back.factions[carthage]?.noticeSince).toBe(124);
    const news = [
      ...threatFadedNewsOfDay(before, off, world, told),
      ...threatFadedNewsOfDay(off, back, world, told),
    ];
    let day = game(2000, 'empty', 125);
    notice(day, world);
    news.push(...threatFadedNewsOfDay(back, day, world, told));
    for (let n = 0; n < 2 * THREAT_STAND_DAYS; n++) {
      const next = structuredClone(day);
      next.day = (day.day + 1) as Day;
      news.push(...threatFadedNewsOfDay(day, next, world, told));
      day = next;
    }
    expect(news).toEqual([]);
  });

  test('says nothing when a war comes within the week', () => {
    const told = new Set(['threat:carthage:100']);
    const before = game(5300, 'full', 120);
    notice(before, world);
    const punic = before.factions[carthage];
    if (!punic) throw new Error('no Carthage');
    punic.noticeSince = 94 as Day;
    const off = game(2000, 'empty', 121);
    notice(off, world);
    expect(threatFadedNewsOfDay(before, off, world, told)).toEqual([]);
    expect([...told].some((key) => key.startsWith('threat-off:'))).toBe(true);
    const atWar = game(2000, 'empty', 122);
    executeOrder(atWar, { kind: 'declareWar', faction: carthage, against: rome }, world);
    expect(threatFadedNewsOfDay(atWar, atWar, world, told)).toEqual([]);
    expect([...told].some((key) => key.startsWith('threat-off:'))).toBe(false);
  });

  test('keeps no waiting line for a power defeated within the week', () => {
    const told = new Set(['threat:carthage:100']);
    const before = game(5300, 'full', 120);
    notice(before, world);
    const punic = before.factions[carthage];
    if (!punic) throw new Error('no Carthage');
    punic.noticeSince = 94 as Day;
    const off = game(2000, 'empty', 121);
    notice(off, world);
    threatFadedNewsOfDay(before, off, world, told);
    const defeated = game(2000, 'empty', 122);
    const fallen = defeated.factions[carthage];
    if (!fallen) throw new Error('no Carthage');
    fallen.defeatedOn = 122 as Day;
    expect(threatFadedNewsOfDay(off, defeated, world, told)).toEqual([]);
    expect([...told].some((key) => key.startsWith('threat-off:'))).toBe(false);
  });

  test('says nothing of a notice the player was never warned of', () => {
    expect(fading(new Set()).news).toEqual([]);
    expect(fading(new Set(['threat:carthage:60'])).news).toEqual([]);
  });

  test("says nothing of a notice that ends while the power stands at the notice again by the day's end", () => {
    // As on a day guards stop counting after the notice was reckoned lower.
    const after = game(5300, 'full', 121);
    expect(fading(new Set(['threat:carthage:100']), after, false).news).toEqual([]);
  });

  test('gives the reason, not 0%, when a war with another power ties down all its armies', () => {
    const atWar = game(5300, 'full', 121);
    // Egypt holds a city in Carthage's reach, so the war holds back Egypt's whole field army.
    changeCityOwner(atWar, 'lepcis-magna' as CityId, egypt);
    spearmenOf(atWar, egypt).men = 30_000;
    executeOrder(atWar, { kind: 'declareWar', faction: carthage, against: egypt }, world);
    const { news } = fading(new Set(['threat:carthage:100']), atWar);
    expect(news.map((alert) => alert.text)).toEqual([
      "Carthage's threat has passed for now: it is at war with Egypt, which ties down all its armies, and must stand at 80% for 30 days before it may.",
    ]);
  });

  test('names a share under 1% as under 1%, not as a war that ties down all its armies', () => {
    const atWar = game(5300, 'full', 121);
    changeCityOwner(atWar, 'lepcis-magna' as CityId, egypt);
    spearmenOf(atWar, egypt).men = 5299;
    executeOrder(atWar, { kind: 'declareWar', faction: carthage, against: egypt }, world);
    const { news } = fading(new Set(['threat:carthage:100']), atWar);
    expect(news[0]?.text).toContain(
      'it has fallen to under 1% of the strength it needs to declare war on you',
    );
  });

  test('names no war for armies that are not ready to march, when the war holds nothing back', () => {
    const away = game(5300, 'full', 121);
    executeOrder(away, { kind: 'declareWar', faction: carthage, against: persia }, world);
    for (const id of Object.values(away.armies).flatMap((army) =>
      army.owner === carthage ? army.formations : [],
    )) {
      const formation = away.formations[id];
      if (formation) formation.morale = 0;
    }
    const { news } = fading(new Set(['threat:carthage:100']), away);
    expect(news[0]?.text).toContain('none of its armies stands ready to march');
    expect(news[0]?.text).not.toContain('Persia');
  });

  test('gives the reason when its armies are ready but no city of yours is in its reach', () => {
    const far = game(5300, 'full', 121);
    for (const city of Object.values(far.cities))
      if (city.owner === rome) changeCityOwner(far, city.id, macedon);
    changeCityOwner(far, 'ekbatana' as CityId, rome);
    const { news } = fading(new Set(['threat:carthage:100']), far);
    expect(news[0]?.text).toContain(
      'none of its cities is near enough to yours to weigh a war on you',
    );
  });

  test('gives the reason when no army of its stands ready to march', () => {
    const away = game(5300, 'full', 121);
    for (const army of Object.values(away.armies))
      if (army.owner === carthage)
        for (const id of army.formations) {
          const formation = away.formations[id];
          if (formation) formation.morale = 0;
        }
    const { news } = fading(new Set(['threat:carthage:100']), away);
    expect(news[0]?.text).toContain('none of its armies stands ready to march');
  });

  test('says nothing when the notice ends in a war', () => {
    const atWar = game(5300, 'full', 121);
    executeOrder(atWar, { kind: 'declareWar', faction: carthage, against: rome }, world);
    expect(fading(new Set(['threat:carthage:100']), atWar).news).toEqual([]);
  });
});

describe('the armies the At peace list names as counting against each power', () => {
  /** A new Roman army of spearmen idle at the point. */
  function raise(state: GameState, at: MapPoint, men: number): ArmyId {
    const id = allocateId(state, 'army');
    const formation = allocateId(state, 'formation');
    state.armies[id] = {
      id,
      owner: rome,
      name: nameNewArmy(state, rome),
      formations: [formation],
      stance: 'holdTheLine',
      generalSkill: 3,
      activity: { kind: 'idle', position: { ...at } },
    };
    state.formations[formation] = { id: formation, army: id, troop: 'spearmen', men, morale: 1 };
    return id;
  }

  /** The state with the army embarked for Syracusae from Roma, played until it is at sea. */
  function atSea(state: GameState, army: ArmyId): GameState {
    const roma = state.cities['roma' as CityId];
    if (!roma) throw new Error('no Roma');
    let orders = [
      {
        kind: 'embark',
        faction: rome,
        army,
        to: 'syracusae' as CityId,
        from: roma.position,
      } as const,
    ];
    let current = state;
    for (let day = 0; day < 30 && current.armies[army]?.activity.kind !== 'embarked'; day++) {
      current = tick(current, orders, world).state;
      orders = [];
    }
    expect(current.armies[army]?.activity.kind).toBe('embarked');
    return current;
  }

  /** The power's share with the army gone, so whether the army counts is the rule's answer. */
  function shareWithout(state: GameState, army: ArmyId | undefined): number {
    const copy = structuredClone(state);
    if (army) {
      for (const formation of copy.armies[army]?.formations ?? [])
        removeRecord(copy.formations, formation);
      removeRecord(copy.armies, army);
    }
    return standingThreats(copy, world).find((t) => t.power === carthage)?.readiness ?? 0;
  }

  const placeOf = (state: GameState, city: string) => {
    const at = state.cities[city as CityId];
    if (!at) throw new Error(`no ${city}`);
    return at.position;
  };

  test('a city threat counts the armies on land within 1,500 km of it, not one at sea or farther, and the note names each', () => {
    const start = game(5300, 'full');
    const first = Object.values(start.armies).find((a) => a.owner === rome)?.id;
    const sailing = raise(start, placeOf(start, 'roma'), 1500);
    const far = raise(start, placeOf(start, 'persepolis'), 2000);
    const state = atSea(start, sailing);
    expectConsistent(state);
    const share = shareWithout(state, undefined);
    expect(shareWithout(state, first), 'the army at Roma counts').toBeGreaterThan(share);
    expect(shareWithout(state, sailing), 'the army at sea does not').toBe(share);
    expect(shareWithout(state, far), 'the army at Persepolis does not').toBe(share);
    const km = Math.ceil(distance(placeOf(state, 'persepolis'), placeOf(state, 'roma')));
    expect(weighedNotes(state, standingThreats(state, world))[0]).toBe(
      `Near Roma, your armies on land within 1,500 km count: First Legion (4,300 men). Third Legion (${km.toLocaleString('en-GB')} km away) and Second Legion (at sea) do not. More men, or guards at Roma for 90 days, lower it.`,
    );
  });

  test('a field-army threat counts every army that can fight, at sea and far away too, and the note names each', () => {
    const start = game(8000, 'empty');
    const sailing = raise(start, placeOf(start, 'roma'), 500);
    const far = raise(start, placeOf(start, 'persepolis'), 400);
    const state = atSea(start, sailing);
    const roma = state.cities['roma' as CityId];
    if (!roma) throw new Error('no Roma');
    roma.garrison = 80_000;
    expectConsistent(state);
    const threats = standingThreats(state, world);
    expect(threats.find((t) => t.power === carthage)?.weighs).toBe('field');
    const share = shareWithout(state, undefined);
    expect(shareWithout(state, sailing), 'the army at sea counts').toBeGreaterThan(share);
    expect(shareWithout(state, far), 'the army at Persepolis counts').toBeGreaterThan(share);
    expect(weighedNotes(state, threats)[0]).toMatch(
      /^In the field, every army of yours counts, wherever it stands, at sea too: First Legion \([\d,]+ men\), Second Legion \([\d,]+ men\) and Third Legion \([\d,]+ men\)\.$/,
    );
  });

  test('names the three largest armies and counts the rest together, so a large realm still fits the panel', () => {
    const state = game(5300, 'full');
    for (const men of [3000, 2000, 1000, 500]) raise(state, placeOf(state, 'capua'), men);
    raise(state, placeOf(state, 'persepolis'), 700);
    raise(state, placeOf(state, 'babylon'), 600);
    raise(state, placeOf(state, 'alexandria'), 500);
    raise(state, placeOf(state, 'hekatompylos'), 400);
    expect(weighedNotes(state, standingThreats(state, world))[0]).toMatch(
      /^Near Roma, your armies on land within 1,500 km count: First Legion \(4,300 men\), Second Legion \(3,000 men\), Third Legion \(2,000 men\) and 2 more with 1,500 men\. .+ \([\d,]+ km away\), .+ \([\d,]+ km away\), .+ \([\d,]+ km away\) and 1 more do not\. More men, or guards at Roma for 90 days, lower it\.$/,
    );
  });

  test('names three broken armies in the field and counts the rest, as they count nothing', () => {
    const state = game(8000, 'empty');
    const roma = state.cities['roma' as CityId];
    if (!roma) throw new Error('no Roma');
    roma.garrison = 80_000;
    for (let i = 0; i < 5; i++) {
      const army = state.armies[raise(state, placeOf(state, 'capua'), 100)];
      const formation = army && state.formations[army.formations[0] as never];
      if (!formation) throw new Error('no formation');
      formation.morale = 0;
    }
    expect(weighedNotes(state, standingThreats(state, world))[0]).toBe(
      'In the field, every army of yours counts, wherever it stands, at sea too: First Legion (4,300 men); Second Legion (broken), Third Legion (broken), Fourth Legion (broken) and 2 more do not.',
    );
  });

  test('says the treasury once for every power it lowers', () => {
    const state = game(5300, 'full');
    const notes = weighedNotes(state, standingThreats(state, world));
    expect(notes.filter((note) => note.startsWith('Your treasury'))).toHaveLength(1);
  });
});
