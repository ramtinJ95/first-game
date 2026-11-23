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
import { newWar, warKey } from '../sim/state/war.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import { buildWorld } from '../sim/world/world.ts';
import { dateText } from './names.ts';
import { NOTICE_DAYS } from '../sim/ai/thresholds.ts';
import { notice } from '../sim/systems/notice.ts';
import { recruitThreats, trainingThreats } from '../ui/recruit-threats.ts';
import { decideOrders } from '../sim/ai/decide.ts';
import { areAtWar } from '../sim/wars.ts';
import { ALL_PAUSES, stopsOfDay } from './pauses.ts';
import type { Alert } from './alerts.ts';
import {
  THREAT_SPARE_DAYS,
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
  const lineOf = (state: GameState, waiting: GameState = state) =>
    standingThreats(state, world, waiting).find((t) => t.power === carthage)?.text ?? '';

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
      'More men lower it, not guards: order Skirmishers now for 900 gold; they muster and lower it from Year 1, day 110, but it may declare that same day, before they muster.',
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

  /**
   * Carthage of 2,000 men pressing a Rome of 1,000 by its field armies on day 100, on notice so
   * that war may first come `left` days on, with Skirmishers ordered at Roma today.
   */
  function trainingFor(left: number) {
    const state = game(2000, 'empty', 100);
    spearmenOf(state, rome).men = 1000;
    Object.assign(state.factions[rome]?.stores ?? {}, { gold: 5000, manpower: 5000 });
    notice(state, world);
    const power = state.factions[carthage];
    if (!power) throw new Error('no Carthage');
    power.noticeSince = (100 + left - NOTICE_DAYS) as Day;
    const ordered = structuredClone(state);
    executeOrder(ordered, skirmishersAtRoma, world);
    expect(ordered.cities['roma' as CityId]?.recruits).toEqual([
      { troop: 'skirmishers', readyOn: 110 },
    ]);
    return { state, ordered };
  }
  const skirmishersAtRoma = {
    kind: 'recruit',
    faction: rome,
    city: 'roma' as CityId,
    troop: 'skirmishers',
  } as const;

  test("names the men already in training, and their day, before what more could be ordered: the tester's second lot", () => {
    expect(lineOf(trainingFor(10).ordered)).toContain(
      'More men lower it, not guards. Skirmishers in training at Roma muster on Year 1, day 110. Besides them, order Skirmishers now for 900 gold; they muster and lower it from Year 1, day 110, but it may declare that same day, before they muster.',
    );
    expect(lineOf(trainingFor(-1).ordered)).toContain(
      'More men lower it, not guards. Skirmishers in training at Roma muster on Year 1, day 110. Besides them, Skirmishers cost 900 gold and train in 10 days.',
    );
    const { state, ordered } = trainingFor(10);
    expect(lineOf(state, ordered)).toContain(
      'Skirmishers in training at Roma muster on Year 1, day 110.',
    );
  });

  test('with the days played to the muster, says what the men in training do to the share, as the game then does', () => {
    for (const left of [10, 20]) {
      const { state } = trainingFor(left);
      let played = tick(state, [skirmishersAtRoma], world).state;
      const forecast = trainingThreats(played, world);
      const muster = forecast.get(carthage);
      if (!muster) throw new Error('no forecast for Carthage');
      const line = standingThreats(played, world, played, forecast).find(
        (t) => t.power === carthage,
      )?.text;
      while (played.day <= 110) played = tick(played, [], world).state;
      expectConsistent(played);
      const real = standingThreats(played, world).find((t) => t.power === carthage)?.readiness ?? 0;
      expect(muster.musters).toBe(110);
      expect(Math.round(muster.mustered * 100)).toBe(Math.round(real * 100));
      expect(real).toBeLessThan(0.8);
      expect(line).toContain(
        `More men lower it, not guards. Skirmishers in training at Roma muster on Year 1, day 110 and take it to ${Math.round(real * 100)}%, ${
          left === 10
            ? 'below 80%, but it may declare that same day, before they muster'
            : 'below 80%, so it may not declare until it has stood at 80% for 30 days'
        }. Besides them, `,
      );
    }
  });

  test("the power decides on its first day of war before that day's recruits muster, so men due that day come too late", () => {
    /** Carthage of 2,500 pressing Rome's 1,000 on day 110, its first day of war, with Skirmishers at Roma due on `readyOn`. */
    const firstDayOfWar = (readyOn: number) => {
      const state = game(2500, 'empty', 109);
      spearmenOf(state, rome).men = 1000;
      const power = state.factions[carthage];
      if (!power) throw new Error('no Carthage');
      power.noticeSince = 80 as Day;
      state.cities['roma' as CityId]?.recruits.push({
        troop: 'skirmishers',
        readyOn: readyOn as Day,
      });
      return tick(state, [], world).state;
    };
    const mustered = firstDayOfWar(109);
    expect(mustered.day).toBe(110);
    expect(decideOrders(mustered, world, carthage)).not.toContainEqual(
      expect.objectContaining({ kind: 'declareWar', against: rome }),
    );
    const due = firstDayOfWar(110);
    const orders = decideOrders(due, world, carthage);
    expect(orders).toContainEqual(expect.objectContaining({ kind: 'declareWar', against: rome }));
    const played = tick(due, orders, world).state;
    expect(played.cities['roma' as CityId]?.recruits).toEqual([]);
    expect(areAtWar(played, carthage, rome)).toBe(true);
    expectConsistent(played);
  });

  test('men who muster on the first day of war are told of in the same words by the line, its advice and the recruit card', () => {
    const { ordered } = trainingFor(10);
    const sameDay = 'but it may declare that same day, before they muster';
    const line =
      standingThreats(ordered, world, ordered, trainingThreats(ordered, world)).find(
        (t) => t.power === carthage,
      )?.text ?? '';
    expect(line).toContain(
      `Skirmishers in training at Roma muster on Year 1, day 110 and take it to 70%, below 80%, ${sameDay}. Besides them, order Skirmishers now for 900 gold; they muster and lower it from Year 1, day 110, ${sameDay}.`,
    );
    expect(line).not.toContain('first day war may come');
    const roma = ordered.cities['roma' as CityId];
    if (!roma) throw new Error('no Roma');
    const [card] =
      recruitThreats(ordered, [], roma, world, ['skirmishers']).get('skirmishers') ?? [];
    expect(card?.text).toMatch(
      new RegExp(
        `once they muster on Year 1, day 110, against \\d+% without them, below 80%, ${sameDay}$`,
      ),
    );
  });

  test('names the day a siege musters the men in training, as the forecast plays it', () => {
    const { ordered } = trainingFor(20);
    ordered.wars[warKey(rome, macedon)] = newWar(macedon, rome, ordered.day);
    const roma = ordered.cities['roma' as CityId];
    const army = Object.values(ordered.armies).find((a) => a.owner === macedon);
    const legion = Object.values(ordered.armies).find((a) => a.owner === rome);
    const capua = ordered.cities['capua' as CityId];
    if (!roma || !army || !legion || !capua) throw new Error('no Roma, Capua or armies');
    army.activity = {
      kind: 'marching',
      position: { x: roma.position.x + 30, y: roma.position.y },
      waypoints: [{ ...roma.position }],
    };
    legion.activity = { kind: 'idle', position: { ...capua.position } };
    const forecast = trainingThreats(ordered, world);
    const muster = forecast.get(carthage);
    if (!muster) throw new Error('no forecast for Carthage');
    let played = ordered;
    while ((played.cities['roma' as CityId]?.recruits.length ?? 0) > 0)
      played = tick(played, [], world).state;
    expect(muster.musters, 'the siege musters them before their day').toBeLessThan(110);
    expect(muster.musters).toBe(played.day - 1);
    expect(
      standingThreats(ordered, world, ordered, forecast).find((t) => t.power === carthage)?.text,
    ).toContain(
      `Skirmishers in training at Roma muster on ${dateText(muster.musters)} and take it to`,
    );
  });

  test('names each city its own muster day when a siege musters one city early and another trains on', () => {
    const { ordered } = trainingFor(20);
    const capua = ordered.cities['capua' as CityId];
    const roma = ordered.cities['roma' as CityId];
    const army = Object.values(ordered.armies).find((a) => a.owner === macedon);
    const legion = Object.values(ordered.armies).find((a) => a.owner === rome);
    if (!roma || !capua || !army || !legion) throw new Error('no Roma, Capua or armies');
    capua.recruits.push({ troop: 'spearmen', readyOn: 115 as Day });
    ordered.wars[warKey(rome, macedon)] = newWar(macedon, rome, ordered.day);
    army.activity = {
      kind: 'marching',
      position: { x: roma.position.x + 30, y: roma.position.y },
      waypoints: [{ ...roma.position }],
    };
    legion.activity = { kind: 'idle', position: { ...capua.position } };
    const forecast = trainingThreats(ordered, world);
    let played = ordered;
    let romaMustered: number | undefined;
    while ((played.cities['capua' as CityId]?.recruits.length ?? 0) > 0) {
      played = tick(played, [], world).state;
      if (romaMustered === undefined && played.cities['roma' as CityId]?.recruits.length === 0)
        romaMustered = played.day - 1;
    }
    expect(romaMustered, 'the siege musters Roma early').toBeLessThan(110);
    expect(played.day - 1, 'Capua trains on to its day').toBe(115);
    expect(forecast.get(carthage)?.musters).toBe(115);
    const line =
      standingThreats(ordered, world, ordered, forecast).find((t) => t.power === carthage)?.text ??
      '';
    expect(line).toContain(
      `Skirmishers in training at Roma muster on ${dateText(romaMustered ?? 0)} and Spearmen at Capua on Year 1, day 115, which take it to`,
    );
  });

  test('the corner says in a few words whether the men in training are enough, as the At peace line says it', () => {
    const corner = (left: number, carthageMen?: number) => {
      const { ordered } = trainingFor(left);
      if (carthageMen !== undefined) spearmenOf(ordered, carthage).men = carthageMen;
      const forecast = trainingThreats(ordered, world);
      const line =
        standingThreats(ordered, world, ordered, forecast).find((t) => t.power === carthage)
          ?.text ?? '';
      const [warning] = threatNewsOfDay(ordered, ordered, world, new Set(), trainingThreats);
      return { line, warning: warning?.text ?? '' };
    };
    const enough = corner(20);
    expect(enough.line).toContain('below 80%, so it may not declare until it has stood at 80%');
    expect(enough.warning).toContain(
      'More men lower it, not guards: Skirmishers in training muster on Year 1, day 110, which is enough. It weighs you so only',
    );
    const late = corner(10);
    expect(late.line).toContain('below 80%, but it may declare that same day, before they muster');
    expect(late.warning).toContain(
      'Skirmishers in training muster on Year 1, day 110, too late. It weighs you',
    );
    const short = corner(20, 4000);
    expect(short.line).toContain('still at 80% or more, so it may still declare');
    expect(short.warning).toContain(
      'Skirmishers in training muster on Year 1, day 110, not enough. It weighs you',
    );
  });

  test('a warning with men in training names them in no more room than the advice it replaces', () => {
    const { state } = trainingFor(10);
    for (const [troop, readyOn] of [
      ['skirmishers', 110],
      ['spearmen', 114],
      ['heavyCavalry', 128],
    ] as const)
      state.cities['capua' as CityId]?.recruits.push({ troop, readyOn: readyOn as Day });
    const [warning] = threatNewsOfDay(state, state, world, new Set());
    expect(warning?.text).toContain(
      'More men lower it, not guards: men in training muster by Year 1, day 128.',
    );
    expect(warning?.text.length ?? 0).toBeLessThanOrEqual(355);
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
    const waiting = structuredClone(state);
    Object.assign(waiting.factions[rome]?.stores ?? {}, { gold: 429, food: 0, manpower: 4000 });
    expect(lineOf(state, waiting)).toContain(
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

describe('a share just under 80%', () => {
  test('reads just under 80% in the warning and the At peace list, as in the guards line', () => {
    const state = game(4690, 'full', 100);
    const readiness =
      standingThreats(state, world).find((t) => t.power === carthage)?.readiness ?? 0;
    expect(readiness).toBeLessThan(0.8);
    expect(Math.round(readiness * 100)).toBe(80);
    expect(standingThreats(state, world).find((t) => t.power === carthage)?.text).toMatch(
      /^Carthage has just under 80% of the strength it needs to declare war on you, /,
    );
    const punic = state.factions[carthage];
    if (!punic) throw new Error('no Carthage');
    punic.noticeSince = 80 as Day;
    const [warning] = threatNewsOfDay(state, state, world, new Set());
    expect(warning?.text).toMatch(
      /^Carthage could soon declare war on you: it has just under 80% of /,
    );
  });
});

describe('a warning soon after a stop for the same power runs the game on', () => {
  /** Carthage's news of a notice that has stood its week on `day`, at a share set by its men. */
  const repeat = (day: number, men: number, told: Set<string>) =>
    stopsOfDay(newsOf(game(men, 'full', day), told), ALL_PAUSES, new Set());

  test("the thirteenth play-through's run: Carthage at Ariminum on Year 5, days 211, 248, 278 and 311 stops the game once", () => {
    const told = new Set<string>();
    const days = [1671, 1708, 1738, 1771];
    const news = days.map((day, n) => repeat(day, [5000, 4900, 5000, 4800][n] ?? 0, told));
    expect(days.map(dateText)).toEqual([
      'Year 5, day 211',
      'Year 5, day 248',
      'Year 5, day 278',
      'Year 5, day 311',
    ]);
    expect(news.map((day) => day.stop)).toEqual([true, false, false, false]);
    expect(news.map((day) => day.news.length)).toEqual([1, 1, 1, 1]);
    expect(news[1]?.news[0]?.text).toMatch(
      /^Carthage could soon declare war on you: 83% of the strength it needs near Roma, from Year 5, day 272\. The game ran on: its stop on Year 5, day 211 was at 85%, and it stands no higher\. See At peace in Wars\.$/,
    );
    expect(news[1]?.news[0]?.pause).toBeUndefined();
  });

  test('a repeat 6 points above the stop stops the game, and one 5 points above runs on and says so', () => {
    const told = new Set<string>();
    expect(repeat(1000, 5000, told).stop).toBe(true);
    const higher = repeat(1040, 5300, told);
    expect(higher.stop).toBe(false);
    expect(higher.news[0]?.text).toContain(
      'The game ran on: its stop on Year 3, day 270 was at 85%, and it stands only 5 points higher.',
    );
    expect(repeat(1080, 5400, told).stop).toBe(true);
  });

  test('a repeat that weighs another front stops the game', () => {
    const told = new Set<string>();
    expect(repeat(1000, 5000, told).stop).toBe(true);
    expect(repeat(1030, 5000, told).stop).toBe(false);
    const field = game(2000, 'full', 1060);
    spearmenOf(field, rome).men = 1000;
    const news = stopsOfDay(newsOf(field, told), ALL_PAUSES, new Set());
    expect(news.news[0]?.text).toContain('against all your armies in the field');
    expect(news.stop).toBe(true);
  });

  test(`a repeat whose war could come more than ${THREAT_SPARE_DAYS} days after the stop stops the game`, () => {
    // A new notice's next reminder is due 84 days after its warning, and no war of it comes later unwarned.
    const spared = new Set<string>();
    expect(repeat(1000, 5000, spared).stop).toBe(true);
    expect(repeat(1000 + THREAT_SPARE_DAYS - 84, 5000, spared).stop).toBe(false);
    const late = new Set<string>();
    expect(repeat(1000, 5000, late).stop).toBe(true);
    expect(repeat(1000 + THREAT_SPARE_DAYS - 83, 5000, late).stop).toBe(true);
  });

  test('a reminder of a notice stops the game, though its warning stopped it within the gap', () => {
    const told = new Set<string>();
    expect(repeat(1000, 5000, told).stop).toBe(true);
    const still = game(5000, 'full', 1084);
    notice(still, world);
    const punic = still.factions[carthage];
    if (!punic) throw new Error('no Carthage');
    punic.noticeSince = 994 as Day;
    const reminder = stopsOfDay(threatNewsOfDay(still, still, world, told), ALL_PAUSES, new Set());
    expect(reminder.news[0]?.text).toMatch(
      /^Carthage still stands near war with you, as warned on /,
    );
    expect(reminder.stop).toBe(true);
  });

  test('a war between them forgets the stop, so the first warning of the next peace stops the game', () => {
    const told = new Set<string>();
    expect(repeat(1000, 5000, told).stop).toBe(true);
    expect(repeat(1030, 5000, told).stop).toBe(false);
    const atWar = game(5000, 'full', 1040);
    executeOrder(atWar, { kind: 'declareWar', faction: carthage, against: rome }, world);
    expect(threatNewsOfDay(atWar, atWar, world, told)).toEqual([]);
    expect(repeat(1070, 5000, told).stop).toBe(true);
  });

  test('the At peace list says the power warned again and the game ran on, with the stop it ran on from', () => {
    const told = new Set<string>();
    repeat(1671, 5000, told);
    const state = game(4900, 'full', 1708);
    newsOf(state, told);
    expect(standingThreats(state, world, state, undefined, told)[0]?.text).toMatch(
      /^Carthage has 83% of the strength .* It warned again on Year 5, day 248 and the game ran on: its stop on Year 5, day 211 was at 85%\.$/,
    );
    const stopped = game(5000, 'full', 1671);
    newsOf(stopped, new Set());
    expect(
      standingThreats(
        stopped,
        world,
        stopped,
        undefined,
        new Set(['threat:carthage:1671', 'threat-stop:carthage:1671:85:roma']),
      )[0]?.text,
    ).not.toContain('warned again');
  });

  test(`over notices that come and go, a war may never come more than ${THREAT_SPARE_DAYS} days after the last stop for its power`, () => {
    const told = new Set<string>();
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    let lastStop: number | undefined;
    let day = 100;
    const late: number[] = [];
    let spared = 0;
    while (day < 4000) {
      const state = game(4800 + 100 * next(7), 'full', day);
      notice(state, world);
      const power = state.factions[carthage];
      if (!power) throw new Error('no Carthage');
      const since = day;
      const stands = 7 + next(200);
      for (; day < since + stands; day++) {
        state.day = day as Day;
        power.noticeSince = since as Day;
        if (
          day >= since + NOTICE_DAYS &&
          (lastStop === undefined || day - lastStop > THREAT_SPARE_DAYS)
        )
          late.push(day);
        const news = stopsOfDay(threatNewsOfDay(state, state, world, told), ALL_PAUSES, new Set());
        if (news.stop) lastStop = day;
        else if (news.news.length > 0) spared++;
      }
      const off = game(2000, 'empty', day);
      notice(off, world);
      day += 8 + next(60);
      threatNewsOfDay(off, off, world, told);
    }
    expect(spared).toBeGreaterThan(10);
    expect(late).toEqual([]);
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
      "Carthage's threat has passed for now: it is at war with Egypt, which ties down all its armies, and Carthage must stand at 80% for 30 days before it may declare.",
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
    expect(news[0]?.text).toBe(
      "Carthage's threat has passed for now: none of its armies stands ready to march, and Carthage must stand at 80% for 30 days before it may declare.",
    );
  });

  test('gives the reason when its armies are ready but no city of yours is in its reach', () => {
    const far = game(5300, 'full', 121);
    for (const city of Object.values(far.cities))
      if (city.owner === rome) changeCityOwner(far, city.id, macedon);
    changeCityOwner(far, 'ekbatana' as CityId, rome);
    const { news } = fading(new Set(['threat:carthage:100']), far);
    expect(news[0]?.text).toBe(
      "Carthage's threat has passed for now: none of its cities is near enough to yours to weigh a war on you, and Carthage must stand at 80% for 30 days before it may declare.",
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
