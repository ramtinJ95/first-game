import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { warReadiness } from '../sim/ai/war.ts';
import { GUARD_DAYS, GUARD_DETER_DAYS } from '../sim/guards.ts';
import { changeCityOwner } from '../sim/cities.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import { parseMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import { expectConsistent } from '../sim/references.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import { tick } from '../sim/tick.ts';
import { troopsFor, type Troop } from '../sim/troops.ts';
import { buildWorld } from '../sim/world/world.ts';
import { share } from '../app/threat-news.ts';
import { recruitThreats } from './recruit-threats.ts';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const carthage = 'carthage' as FactionId;
const ALL = troopsFor(rome);

/**
 * Rome with 4,000 spearmen and a full treasury beside a Carthage of twelve cities at peace
 * with every minor, with `men` spearmen, on notice since `since`.
 */
function game(men: number, since: number | null = 0): GameState {
  const state = newGame(map, { seed: 1, player: 'rome' });
  for (const id of [
    'caralis',
    'cirta',
    'iol-caesarea',
    'cidamus',
    'tarraco',
    'carthago-nova',
    'numantia',
    'burdigala',
  ] as CityId[])
    changeCityOwner(state, id, carthage);
  for (const faction of Object.values(state.factions))
    if (faction.kind === 'minor')
      state.truces[warKey(carthage, faction.id)] = { since: state.day, endsOn: 365 as Day };
  const formation = (owner: FactionId) => {
    const army = Object.values(state.armies).find((a) => a.owner === owner);
    const found = army && state.formations[army.formations[0] as never];
    if (!found) throw new Error(`no army of ${owner}`);
    return found;
  };
  formation(carthage).men = men;
  formation(rome).men = 4000;
  const romans = state.factions[rome];
  const punic = state.factions[carthage];
  if (!romans || !punic) throw new Error('no Rome or Carthage');
  romans.stores.gold = limitsOf(state).get(rome)?.gold ?? 0;
  romans.stores.manpower = 10_000;
  punic.noticeSince = since as Day | null;
  return state;
}

const cityOf = (state: GameState, id: string) => {
  const city = state.cities[id as CityId];
  if (!city) throw new Error(`no ${id}`);
  return city;
};

const percent = (n: number) => Math.round(Math.min(1, n) * 100);

/** Carthage's share as the At peace list reckons it on the state. */
const shareOf = (state: GameState) => warReadiness(state, world, carthage, rome)?.readiness ?? 0;

/** Orders the troop and plays the rules to the day after the men muster, with Carthage's share the day after the order and then. */
function play(state: GameState, city: string, troop: Troop) {
  let played = tick(
    state,
    [{ kind: 'recruit', faction: rome, city: city as CityId, troop }],
    world,
  ).state;
  const paid = shareOf(played);
  const musters = played.cities[city as CityId]?.recruits.at(-1)?.readyOn;
  if (musters === undefined) throw new Error('no recruit in training');
  while (played.day <= musters) played = tick(played, [], world).state;
  expectConsistent(played);
  return { paid, mustered: shareOf(played), musters };
}

describe('what a troop does to a threat, on its recruit card', () => {
  test('says nothing while no power stands near war', () => {
    const state = game(2000, null);
    expect(recruitThreats(state, [], cityOf(state, 'roma'), world, ALL).size).toBe(0);
  });

  test('each forecast is what the game then does: the share once the gold is paid and once the men muster, on their day', () => {
    const state = game(5300);
    const forecasts = recruitThreats(state, [], cityOf(state, 'roma'), world, ALL);
    expect([...forecasts.keys()]).toEqual(ALL);
    for (const troop of ALL) {
      const [forecast] = forecasts.get(troop) ?? [];
      const real = play(state, 'roma', troop);
      expect(forecast?.musters, `${troop} muster day`).toBe(real.musters);
      expect(percent(forecast?.paid ?? 0), `${troop} once paid`).toBe(percent(real.paid));
      expect(percent(forecast?.mustered ?? 0), `${troop} once mustered`).toBe(
        percent(real.mustered),
      );
    }
  });

  test("the tester's case: the gold and the men each lower the share, and the card names both and the day", () => {
    const state = game(5300);
    const [spearmen] = recruitThreats(state, [], cityOf(state, 'roma'), world, ['spearmen']).get(
      'spearmen',
    ) ?? [undefined];
    if (!spearmen) throw new Error('no forecast');
    expect(spearmen.paid).toBeLessThan(spearmen.now);
    expect(spearmen.mustered).toBeLessThan(spearmen.paid);
    expect(spearmen.text).toMatch(
      /^Carthage (\d+%|100%) now, \d+% once paid, \d+% once they muster on Year 1, day 16, against \d+% without them, (still at 80% or more, so it may still declare from Year 1, day 30|below 80%, so it may not declare until it has stood at 80% for 30 days)$/,
    );
  });

  test('says whether a troop leaves the power at 80% or more, from its named day, or takes it below', () => {
    const strong = game(9000);
    const [held] = recruitThreats(strong, [], cityOf(strong, 'roma'), world, ['skirmishers']).get(
      'skirmishers',
    ) ?? [undefined];
    expect(held?.text).toMatch(
      /, still at 80% or more, so it may still declare from Year 1, day 30$/,
    );
    const weak = game(5300);
    const [answer] = recruitThreats(weak, [], cityOf(weak, 'roma'), world, ['spearmen']).get(
      'spearmen',
    ) ?? [undefined];
    expect(answer?.text).toMatch(
      /below 80%, so it may not declare until it has stood at 80% for 30 days/,
    );
  });

  test('men that muster on or after the first day of war are said to come too late', () => {
    const state = game(5300, -20);
    const [late] = recruitThreats(state, [], cityOf(state, 'roma'), world, ['spearmen']).get(
      'spearmen',
    ) ?? [undefined];
    expect(late?.text).toBe(
      'Carthage 90% now, 82% once paid, 71% once they muster on Year 1, day 16, against 89% without them, below 80%, but it may declare from Year 1, day 10, before they muster',
    );
  });

  test('a power not yet on notice comes on notice the day the order is played, so men who muster 30 days later come too late', () => {
    const state = game(5300, null);
    const [late] = recruitThreats(state, [], cityOf(state, 'roma'), world, ['heavyCavalry']).get(
      'heavyCavalry',
    ) ?? [undefined];
    expect(late?.text).toBe(
      'Carthage 90% now, 81% once paid, 75% once they muster on Year 1, day 31, against 89% without them, below 80%, but it may declare that same day, before they muster',
    );
  });

  test('men raised beyond reach of the city a power weighs do not count, and the card says so', () => {
    const state = game(5300);
    changeCityOwner(state, 'antiocheia' as CityId, rome);
    const city = cityOf(state, 'antiocheia');
    city.unrestDays = 0;
    const [far] = recruitThreats(state, [], city, world, ['spearmen']).get('spearmen') ?? [
      undefined,
    ];
    expect(far?.counted).toBe(false);
    const real = play(state, 'antiocheia', 'spearmen');
    expect(far?.musters).toBe(real.musters);
    expect(percent(far?.paid ?? 0)).toBe(percent(real.paid));
    expect(percent(far?.mustered ?? 0)).toBe(percent(real.mustered));
    expect(far?.text).toMatch(
      new RegExp(
        `[,;] ${share(real.mustered)} once they muster on Year 1, day ${real.musters}, beyond 1,500 km of Roma, where they do not count`,
      ),
    );
  });

  test('a power that weighs the field armies counts the men wherever they muster', () => {
    const state = game(8000);
    const roma = cityOf(state, 'roma');
    roma.garrison = 80_000;
    const [field] = recruitThreats(state, [], roma, world, ['spearmen']).get('spearmen') ?? [
      undefined,
    ];
    expect(field?.counted).toBe(true);
    expect(field?.mustered).toBeLessThan(field?.paid ?? 0);
  });

  test('a store that runs short makes men desert in the forecast as in the game', () => {
    const state = game(5600);
    const romans = state.factions[rome];
    if (!romans) throw new Error('no Rome');
    romans.stores.food = 0;
    const [forecast] = recruitThreats(state, [], cityOf(state, 'roma'), world, ['spearmen']).get(
      'spearmen',
    ) ?? [undefined];
    const real = play(state, 'roma', 'spearmen');
    expect(percent(forecast?.paid ?? 0)).toBe(percent(real.paid));
    expect(percent(forecast?.mustered ?? 0)).toBe(percent(real.mustered));
  });

  test('men raised far away do not count, though men already in training at the front muster first', () => {
    const state = game(5300);
    changeCityOwner(state, 'antiocheia' as CityId, rome);
    cityOf(state, 'antiocheia').unrestDays = 0;
    cityOf(state, 'roma').recruits.push({ troop: 'spearmen', readyOn: 5 as Day });
    const [far] = recruitThreats(state, [], cityOf(state, 'antiocheia'), world, ['spearmen']).get(
      'spearmen',
    ) ?? [undefined];
    expect(far?.counted).toBe(false);
  });

  test("the tester's day 217: a fall that comes without the troop is said to come with or without it, on every card", () => {
    const state = game(5300, -20);
    cityOf(state, 'roma').recruits.push({ troop: 'spearmen', readyOn: 2 as Day });
    let alone = state;
    while (alone.factions[carthage]?.noticeSince === -20 && alone.day <= 10)
      alone = tick(alone, [], world).state;
    expect(alone.day - 1, 'with no order the notice ends on day 2').toBe(2);
    const cards = recruitThreats(state, [], cityOf(state, 'roma'), world, ALL);
    for (const troop of ALL) {
      const [card] = cards.get(troop) ?? [undefined];
      const sooner = (card?.ended ?? 2) < 2;
      expect(card?.text, troop).toMatch(
        sooner
          ? /; it falls below 80% on Year 1, day 1, not until Year 1, day 2 without them, so it may not declare until it has stood at 80% for 30 days$/
          : /; it falls below 80% on Year 1, day 2 with or without them, so it may not declare until it has stood at 80% for 30 days$/,
      );
      expect(card?.text, troop).not.toMatch(/, below 80%|, still at/);
      expect(card?.without.ended, troop).toBe(2);
    }
  });

  test('what a card says it changes is the difference from the same days played with no order', () => {
    const state = game(5300);
    const cards = recruitThreats(state, [], cityOf(state, 'roma'), world, ALL);
    for (const troop of ALL) {
      const [card] = cards.get(troop) ?? [undefined];
      if (!card) throw new Error(`no card for ${troop}`);
      let alone = state;
      while (alone.day <= card.musters) alone = tick(alone, [], world).state;
      expect(percent(card.without.mustered), troop).toBe(percent(shareOf(alone)));
      expect(card.text, troop).toContain(`, against ${share(shareOf(alone))} without them`);
    }
  });

  test('an army that regains its morale while the men train is counted as the game counts it', () => {
    const state = game(6625);
    for (const formation of Object.values(state.formations)) formation.morale = 0.8;
    const [forecast] = recruitThreats(state, [], cityOf(state, 'roma'), world, ['spearmen']).get(
      'spearmen',
    ) ?? [undefined];
    const real = play(state, 'roma', 'spearmen');
    expect(percent(forecast?.mustered ?? 0)).toBe(percent(real.mustered));
  });

  test('a notice that a falling treasury ends before the named day is not said to give war that day', () => {
    const state = game(5170, -20);
    const endings: Troop[] = [];
    for (const troop of ALL) {
      const [card] = recruitThreats(state, [], cityOf(state, 'roma'), world, [troop]).get(
        troop,
      ) ?? [undefined];
      let played = tick(
        state,
        [{ kind: 'recruit', faction: rome, city: 'roma' as CityId, troop }],
        world,
      ).state;
      while (played.day <= 10) played = tick(played, [], world).state;
      const ended = played.factions[carthage]?.noticeSince !== -20;
      if (ended) endings.push(troop);
      expect(/may (still )?declare from Year 1, day 10/.test(card?.text ?? ''), troop).toBe(!ended);
    }
    expect(
      endings.length,
      'some troop leaves the notice to end on a falling treasury',
    ).toBeGreaterThan(0);
    expect(endings.length, 'and some do not').toBeLessThan(ALL.length);
  });

  /**
   * Orders the troop and plays the rules day by day to the muster: the card's shares are the
   * game's, and it says the power may declare from its day exactly when the rules keep its
   * notice to that day or to the muster.
   */
  function agrees(state: GameState, city: string, troop: Troop) {
    const [card] = recruitThreats(state, [], cityOf(state, city), world, [troop]).get(troop) ?? [
      undefined,
    ];
    if (!card) throw new Error(`no card for ${troop}`);
    const since = state.factions[carthage]?.noticeSince ?? state.day;
    let played = tick(
      state,
      [{ kind: 'recruit', faction: rome, city: city as CityId, troop }],
      world,
    ).state;
    expect(percent(shareOf(played)), `${troop} once paid`).toBe(percent(card.paid));
    let held = played.factions[carthage]?.noticeSince === since;
    while (played.day <= card.musters) {
      played = tick(played, [], world).state;
      if (played.day - 1 < since + 30) held &&= played.factions[carthage]?.noticeSince === since;
    }
    expect(percent(shareOf(played)), `${troop} once mustered`).toBe(percent(card.mustered));
    expect(/may (still )?declare from/.test(card.text), `${troop}: ${card.text}`).toBe(held);
  }

  test('a garrison that refills in peace while the men train is counted as the game counts it', () => {
    const state = game(4600);
    cityOf(state, 'roma').garrison = 750;
    for (const troop of ALL) agrees(state, 'roma', troop);
  });

  test('a band of guards that stops counting the day after the order is counted on its day', () => {
    const state = game(5175, -20);
    const roma = cityOf(state, 'roma');
    roma.garrison = 3500;
    roma.guards.push({ until: (2 + GUARD_DAYS - GUARD_DETER_DAYS) as Day });
    for (const troop of ALL) agrees(state, 'roma', troop);
  });

  test('men a siege musters at once are said to muster that day, as the game musters them', () => {
    const state = game(5300);
    const macedon = 'macedon' as FactionId;
    state.wars[warKey(rome, macedon)] = newWar(macedon, rome, state.day);
    const roma = cityOf(state, 'roma');
    const army = Object.values(state.armies).find((a) => a.owner === macedon);
    if (!army) throw new Error('no Macedonian army');
    army.activity = {
      kind: 'marching',
      position: { x: roma.position.x + 30, y: roma.position.y },
      waypoints: [{ ...roma.position }],
    };
    const legion = Object.values(state.armies).find((a) => a.owner === rome);
    if (!legion) throw new Error('no Roman army');
    legion.activity = { kind: 'idle', position: { ...cityOf(state, 'capua').position } };
    const [card] = recruitThreats(state, [], roma, world, ['spearmen']).get('spearmen') ?? [
      undefined,
    ];
    let played = tick(
      state,
      [{ kind: 'recruit', faction: rome, city: 'roma' as CityId, troop: 'spearmen' }],
      world,
    ).state;
    while ((played.cities['roma' as CityId]?.recruits.length ?? 0) > 0)
      played = tick(played, [], world).state;
    expect(Object.values(played.sieges).map((siege) => siege.city)).toEqual(['roma']);
    expect(played.day - 1, 'the siege mustered them early').toBeLessThan(16);
    expect(card?.musters).toBe(played.day - 1);
    expect(percent(card?.mustered ?? 0)).toBe(percent(shareOf(played)));
  });
});
