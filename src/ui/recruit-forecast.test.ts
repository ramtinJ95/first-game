import { BUILDINGS } from '../sim/buildings/buildings.ts';
import { expect, it } from 'vitest';
import { trainingDaysAt } from '../sim/buildings/buildings.ts';
import { buildFixture, FIXTURE as f, fixtureWorld, growRome } from '../sim/fixture.ts';
import { newGame } from '../sim/new-game.ts';
import { changeCityOwner, UNREST_DAYS } from '../sim/cities.ts';
import { expectConsistent } from '../sim/references.ts';
import type { Day } from '../sim/state/day.ts';
import { dateText } from '../app/names.ts';
import type { GameState } from '../sim/state/game-state.ts';
import {
  ADMIN_CITIES,
  dailyBalances,
  economy,
  limitsOf,
  UPKEEP_PER_MAN,
} from '../sim/systems/economy.ts';
import { tick } from '../sim/tick.ts';
import { MOVED_DAYS, movedText, recruitForecast } from './recruit-forecast.ts';
import { TROOP_NAMES } from '../app/names.ts';
import { population } from '../sim/systems/population.ts';
import { construction } from '../sim/systems/construction.ts';
import { TROOPS } from '../sim/troops.ts';
import { executeOrder } from '../sim/orders/orders.ts';
import { recruit } from '../sim/orders/recruit.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import type { Order } from '../sim/orders/orders.ts';

const world = fixtureWorld();

it('warns for a gold-only shortfall even before the new formation musters', () => {
  const state = goldOnly();
  const forecast = recruitForecast(state, [], world, 'spearmen');
  expect(forecast.after.food).toBeGreaterThan(0);
  expect(forecast.warning).not.toContain('Food shortfall');
  expect(forecast.warning).toContain('Gold shortfall');
  expect(forecast.lasts.gold).toBeLessThan(15);
  expect(forecast.lasts.gold).toBe(firstShortfall(state, 'gold'));
});

it('warns of a lasting deficit years away, which the people grow too slowly to close', () => {
  const state = foodDeficitAfterSpearmen(-30);
  const forecast = recruitForecast(state, [], world, 'spearmen');
  expect(forecast.lasts.food).toBeGreaterThan(365);
  expect(forecast.short.food).toBeGreaterThan(365);
  expect(forecast.warning).toContain(
    `stores last about ${((forecast.short.food ?? 0) - 1).toLocaleString('en-US')} days`,
  );
  expect(forecast.runway.find((store) => store.key === 'food')).toMatchObject({
    urgent: true,
    text: `about ${((forecast.short.food ?? 0) - 1).toLocaleString('en-US')} days left as the people grow`,
  });
  expect(forecast.short.food).toBe(firstShortfall(state, 'food', true));
  expectConsistent(state);
});

it('names the wait after which stores carry the raise until the people feed it, to the day', () => {
  const state = foodDeficitAfterSpearmen(-8, 0.1);
  const forecast = recruitForecast(state, [], world, 'spearmen');
  const wait = required(forecast.holdsAfter);
  expect(forecast.short.food).toBeDefined();
  expect(wait).toBeGreaterThan(30);
  expect(forecast.warning).toContain(
    `raised in about ${wait.toLocaleString('en-US')} days, on ${dateText(state.day + wait)}, these men are fed as the people grow, if you raise no other troops and lose no city before then. Raise now only if you need them sooner.`,
  );
  expect(forecast.warning).not.toContain('Raise fewer troops');
  expect(() => firstShortfall(state, 'food', true, 1 + wait)).toThrow('Stores never ran short');
  expect(firstShortfall(state, 'food', true, wait)).toBeGreaterThan(wait);
  expectConsistent(state);
});

it('pays a delayed raise on the day it is given, after the treasury has refilled to its limit', () => {
  const state = buildFixture();
  for (const city of Object.values(state.cities))
    if (city.owner === f.rome) {
      city.population = 20_000;
      city.buildings = ['canals'];
    }
  required(state.formations[f.hastati]).men = 700;
  Object.assign(required(state.factions[f.rome]).stores, {
    gold: 4032,
    food: required(limitsOf(state).get(f.rome)).food,
    manpower: 2000,
  });
  const forecast = recruitForecast(state, [], world, 'spearmen');
  const wait = required(forecast.holdsAfter);
  expect(forecast.short.gold).toBeDefined();
  expect(forecast.warning).toContain(
    `on ${dateText(state.day + wait)}, these men are fed as the people grow, if you raise no other troops, spend no gold, and your income holds until then, though trade gold comes as each caravan arrives and can move the day by some weeks.`,
  );
  expect(() => firstShortfall(state, ['gold', 'food'], true, 1 + wait)).toThrow(
    'Stores never ran short',
  );
  expect(firstShortfall(state, 'gold', true, wait)).toBeGreaterThan(wait);
  expectConsistent(state);
});

it('names no wait on which the treasury could not pay the raise before the day’s income', () => {
  const state = buildFixture();
  for (const city of Object.values(state.cities))
    if (city.owner === f.rome) {
      city.population = 500_000;
      city.buildings = ['canals'];
    }
  required(state.formations[f.hastati]).men = 42_700;
  Object.assign(required(state.factions[f.rome]).stores, {
    gold: 2400,
    food: 200_000,
    manpower: 50_000,
  });
  const forecast = recruitForecast(state, [], world, 'spearmen');
  expect(forecast.holdsAfter).toBe(438);
  expect(() => firstShortfall(state, 'gold', true, 439)).toThrow('Stores never ran short');
  expectConsistent(state);
});

it('tries each wait while other recruits are still training, since a later muster can lose granary room', () => {
  const state = buildFixture();
  for (const city of Object.values(state.cities))
    if (city.owner === f.rome) city.population = 39_848;
  required(state.formations[f.hastati]).men = 760;
  Object.assign(required(state.factions[f.rome]).stores, {
    gold: 100_000,
    food: 3200,
    manpower: 100_000,
  });
  for (let i = 0; i < 3; i++)
    expect(
      recruit(state, { kind: 'recruit', faction: f.rome, city: f.capua, troop: 'heavyCavalry' }),
    ).toBeUndefined();
  const forecast = recruitForecast(state, [], world, 'spearmen');
  expect(forecast.short.food).toBeDefined();
  expect(forecast.holdsAfter).toBe(11);
  expect(() => firstShortfall(state, 'food', true, 12)).toThrow('Stores never ran short');
  expect(firstShortfall(state, 'food', true, 13)).toBeGreaterThan(13);
  expectConsistent(state);
});

it('asks for better income instead of a wait when waiting would not let the stores carry the raise', () => {
  const state = foodDeficitAfterSpearmen(-20, 0.1);
  const forecast = recruitForecast(state, [], world, 'spearmen');
  expect(forecast.short.food).toBeDefined();
  expect(forecast.holdsAfter).toBeUndefined();
  expect(forecast.warning).toContain('Raise fewer troops or improve income first.');
  expectConsistent(state);
});

it('stays plain for a small deficit that the growing people close before the stores run out', () => {
  const state = foodDeficitAfterSpearmen(-1);
  const forecast = recruitForecast(state, [], world, 'spearmen');
  expect(forecast.lasts.food).toBeGreaterThan(2000);
  expect(forecast.short.food).toBeUndefined();
  expect(forecast.warning).toBeUndefined();
  expect(forecast.runway.find((store) => store.key === 'food')).toMatchObject({
    urgent: false,
    text: `stores last about ${((forecast.lasts.food ?? 0) - 1).toLocaleString('en-US')} days at today's yields, but the people's growth closes the gap first`,
  });
  expect(() => firstShortfall(state, 'food', true)).toThrow('Stores never ran short');
  expectConsistent(state);
});

it('still warns of a deficit that outlasts a century, with no horizon to hide it', () => {
  const state = goldOnly();
  required(state.cities[f.roma]).population = 200;
  required(state.cities[f.capua]).population = 200;
  required(state.factions[f.rome]).stores.gold = 2_000_000;
  const forecast = recruitForecast(state, [], world, 'spearmen');
  expect(forecast.short.gold).toBeGreaterThan(100 * 365);
  expect(forecast.warning).toContain('Gold shortfall');
  expectConsistent(state);
});

it('takes a balance that rounds to zero for no deficit, and returns', () => {
  const state = newGame(world.map, { seed: 1, player: 'rome' });
  required(state.factions[f.rome]).stores.gold = 20_000;
  const to = Object.values(state.cities).find((c) => c.owner === f.rome && c.id !== f.roma);
  if (!to) throw new Error('Rome needs a second city');
  const pending = [
    { kind: 'evacuate', faction: f.rome, city: f.roma, to: to.id, share: 0.25 },
  ] as const;
  const forecast = recruitForecast(state, pending, world, 'spearmen');
  expect(forecast.short).toEqual({ food: undefined, gold: undefined });
  expect(forecast.warning).toBeUndefined();
  expectConsistent(state);
});

it('gives the realm forecast without adding a hypothetical troop, and keeps card text troop-specific', () => {
  const state = buildFixture();
  const balance = required(dailyBalances(state).get(f.rome));
  const pending = [{ kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' }] as const;
  const realm = recruitForecast(state, pending, world);
  expect(realm.after.food).toBeCloseTo(balance.food - 6);
  expect(realm.after.gold).toBeCloseTo(balance.gold - 10);
  expect(realm.upkeep).toEqual({ food: 0, gold: 0 });
  const card = recruitForecast(state, pending, world, 'archers');
  expect(card.upkeepText).toBe('Upkeep −3.0 food, −5.0 gold/day');
  expect(card.upkeepText).not.toContain('Realm');
  expectConsistent(state);
});

it.each([false, true])(
  'predicts the economy runway with barracks=%s and capped pre-muster gains',
  (barracks) => {
    const state = buildFixture();
    const city = required(state.cities[f.roma]);
    if (barracks) city.buildings.push('barracks');
    required(state.factions[f.rome]).stores.food = required(limitsOf(state).get(f.rome)).food - 1;
    const forecast = recruitForecast(
      state,
      [],
      world,
      'spearmen',
      trainingDaysAt(city, 'spearmen'),
    );
    expect(forecast.lasts.food).toBe(firstShortfall(state, 'food'));
  },
);

it('projects a queued trade with its world before quoting recruitment, without changing live state', () => {
  const state = buildFixture();
  required(state.factions[f.rome]).stores.gold = 10000;
  const before = structuredClone(state);
  const order = {
    kind: 'openTrade',
    faction: f.rome,
    from: f.roma,
    to: f.capua,
    mode: 'land',
  } as const;
  const projected = structuredClone(state);
  expect(executeOrder(projected, order, world)).toBeUndefined();
  expect(recruitForecast(state, [order], world, 'spearmen')).toEqual(
    recruitForecast(projected, [], world, 'spearmen'),
  );
  expect(state).toEqual(before);
  expectConsistent(state);
  expectConsistent(projected);
});

type Store = 'food' | 'gold';

/** The first day any of `stores` runs short, playing one game for all of them. */
function firstShortfall(
  initial: GameState,
  stores: Store | readonly Store[],
  growing = false,
  raiseOn = 1,
) {
  const watched = typeof stores === 'string' ? [stores] : stores;
  let state = initial;
  for (let day = 1; day <= 6000; day++) {
    const result = tick(
      state,
      day === raiseOn
        ? [{ kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' }]
        : [],
      fixtureWorld(),
      [
        economy,
        ...(growing ? [population] : []),
        (state) => {
          state.day = (state.day + 1) as Day;
        },
      ],
    );
    if (result.rejected.length > 0) expect(result.rejected).toEqual([]);
    state = result.state;
    expectConsistent(state);
    const held = required(state.factions[f.rome]).stores;
    if (watched.some((store) => held[store] < 0)) return day;
  }
  throw new Error('Stores never ran short');
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Recruit fixture record missing');
  return value;
}

function goldOnly(): GameState {
  const state = buildFixture();
  required(state.cities[f.roma]).population = 2000;
  const capua = required(state.cities[f.capua]);
  capua.population = 200_000;
  capua.unrestDays = UNREST_DAYS;
  required(state.factions[f.rome]).stores.gold = 2500;
  for (const id of required(state.armies[f.romanArmy]).formations)
    required(state.formations[id]).men = 2000;
  return state;
}

/** Rome's two cities of 200,000, or Capua of `capua`, its granary `full`, with one army sized so the food balance after a spearmen raise is `after`. */
function foodDeficitAfterSpearmen(after: number, full = 1, capua = 200_000): GameState {
  const state = buildFixture();
  for (const city of Object.values(state.cities))
    if (city.owner === f.rome) city.population = city.id === f.capua ? capua : 200_000;
  const formations = required(state.armies[f.romanArmy]).formations;
  const first = required(state.formations[required(formations[0])]);
  const now = required(dailyBalances(state).get(f.rome)).food;
  const raised = now - TROOPS.spearmen.recruit.men * UPKEEP_PER_MAN.food;
  first.men += Math.round((raised - after) / UPKEEP_PER_MAN.food);
  const stores = required(state.factions[f.rome]).stores;
  stores.food = full * required(limitsOf(state).get(f.rome)).food;
  stores.gold = 100_000;
  stores.manpower = 100_000;
  return state;
}

it('says what moved the named day: the troops raised since, who are fed first', () => {
  const state = foodDeficitAfterSpearmen(-8, 0.1);
  const before = recruitForecast(state, [], world, 'spearmen').named;
  const skirmishers = {
    kind: 'recruit',
    faction: f.rome,
    city: f.roma,
    troop: 'skirmishers',
  } as const;
  expect(recruitForecast(state, [], world, 'skirmishers').warning).toBeUndefined();
  const now = recruitForecast(state, [skirmishers], world, 'spearmen').named;
  if (!before || !now) throw new Error('the card names no wait');
  expect(now.named).toBeGreaterThan(before.named + MOVED_DAYS);
  expect(movedText(before, now, TROOP_NAMES)).toBe(
    `Now ${dateText(now.named)}, not ${dateText(before.named)} as this card said on ${dateText(state.day)}: since then you raised 500 Skirmishers, who are fed first.`,
  );
  expect(movedText(before, before, TROOP_NAMES)).toBeUndefined();
});

it('says a lost city moved the named day', () => {
  const state = foodDeficitAfterSpearmen(-5, 0.1, 10_000);
  const before = recruitForecast(state, [], world, 'spearmen').named;
  const lost = structuredClone(state);
  changeCityOwner(lost, f.capua, f.carthage);
  const now = recruitForecast(lost, [], world, 'spearmen').named;
  if (!before || !now) throw new Error('the card names no wait');
  expect(now.named).toBeGreaterThan(before.named + MOVED_DAYS);
  expect(movedText(before, now, TROOP_NAMES)).toBe(
    `Now ${dateText(now.named)}, not ${dateText(before.named)} as this card said on ${dateText(state.day)}: since then you lost Capua.`,
  );
});

it('says the stores it counted on changed when no troop was raised and no city lost', () => {
  const state = foodDeficitAfterSpearmen(-8, 0.1);
  const before = recruitForecast(state, [], world, 'spearmen').named;
  const emptier = structuredClone(state);
  required(emptier.factions[f.rome]).stores.food /= 2;
  const now = recruitForecast(emptier, [], world, 'spearmen').named;
  if (!before || !now) throw new Error('the card names no wait');
  expect(now.named).toBeGreaterThan(before.named + MOVED_DAYS);
  expect(movedText(before, now, TROOP_NAMES)).toBe(
    `Now ${dateText(now.named)}, not ${dateText(before.named)} as this card said on ${dateText(state.day)}: the stores or income it counted on changed since then.`,
  );
});

/** The day Rome's food first runs short when it starts Canals (or `building`) at Roma on day 1 and raises Spearmen on `raiseOn`. */
function shortWithCanals(
  initial: GameState,
  raiseOn: number,
  building: 'canals' | 'reservoirs' = 'canals',
) {
  let state = initial;
  for (let day = 1; day <= 6000; day++) {
    const orders = [
      ...(day === 1 ? [{ kind: 'build', faction: f.rome, city: f.roma, building } as const] : []),
      ...(day === raiseOn
        ? [{ kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' } as const]
        : []),
    ];
    const result = tick(state, orders, fixtureWorld(), [
      economy,
      construction,
      population,
      (state) => {
        state.day = (state.day + 1) as Day;
      },
    ]);
    if (result.rejected.length > 0) expect(result.rejected).toEqual([]);
    state = result.state;
    if (required(state.factions[f.rome]).stores.food < 0) return day;
  }
  return undefined;
}

/** The wait the card's Canals line names, checked against the played days: a raise then is fed, a day sooner is not. */
function canalWait(state: GameState, building: 'canals' | 'reservoirs' = 'canals'): number {
  const canal = required(recruitForecast(state, [], world, 'spearmen', 15, f.roma).canal);
  const wait = Number(/in about ([\d,]+) days/.exec(canal)?.[1]?.replace(',', ''));
  const { name, gold, food, days } = BUILDINGS[building];
  expect(canal).toBe(
    `Or build ${name} at Roma for ${gold.toLocaleString('en-US')} gold, which grow ${food} more food a day once built in ${days} days: with them these men are fed if raised in about ${wait.toLocaleString('en-US')} days, on ${dateText(state.day + wait)}.`,
  );
  expect(shortWithCanals(state, wait + 1, building)).toBeUndefined();
  expect(shortWithCanals(state, wait, building)).toBeDefined();
  return wait;
}

it('names Reservoirs in a city that has Canals, and holds their day against the played days', () => {
  const state = foodDeficitAfterSpearmen(-12 - BUILDINGS.canals.food, 0.1);
  required(state.cities[f.roma]).buildings = ['canals'];
  const without = required(recruitForecast(state, [], world, 'spearmen', 15, f.roma).holdsAfter);
  expect(canalWait(state, 'reservoirs')).toBeLessThan(without);
  expectConsistent(state);
});

it('names Canals and the sooner day they feed a raise that food delays, to the day', () => {
  const state = foodDeficitAfterSpearmen(-12, 0.1);
  const without = required(recruitForecast(state, [], world, 'spearmen', 15, f.roma).holdsAfter);
  expect(canalWait(state)).toBeLessThan(without);
  expectConsistent(state);
});

it('names Canals and the day they feed a raise that no wait carries without them', () => {
  const state = foodDeficitAfterSpearmen(-14, 0.1);
  expect(recruitForecast(state, [], world, 'spearmen', 15, f.roma).holdsAfter).toBeUndefined();
  expect(canalWait(state)).toBeGreaterThan(0);
  expectConsistent(state);
});

it('names Canals in another city of the player when the city raising cannot start them', () => {
  const state = foodDeficitAfterSpearmen(-12, 0.1);
  required(state.cities[f.roma]).construction = { building: 'forum', daysLeft: 30 };
  expect(recruitForecast(state, [], world, 'spearmen', 15, f.roma).canal).toContain(
    'Or build Canals at Capua for 4,000 gold',
  );
  required(state.cities[f.capua]).construction = { building: 'temple', daysLeft: 30 };
  const forecast = recruitForecast(state, [], world, 'spearmen', 15, f.roma);
  expect(forecast.short.food).toBeDefined();
  expect(forecast.canal).toBeUndefined();
});

it('names a later day for Canals when the gold pays for them but not for the raise as well', () => {
  const state = foodDeficitAfterSpearmen(-8, 0.1);
  required(state.factions[f.rome]).stores.gold = 4000;
  const canal = required(recruitForecast(state, [], world, 'spearmen', 15, f.roma).canal);
  expect(canal).not.toContain('raised now');
  const wait = Number(/in about ([\d,]+) days/.exec(canal)?.[1]?.replace(',', ''));
  expect(shortWithCanals(state, wait + 1)).toBeUndefined();
  required(state.factions[f.rome]).stores.gold = 6400;
  expect(recruitForecast(state, [], world, 'spearmen', 15, f.roma).canal).toContain(
    'fed if raised now',
  );
});

it('names no Canals when food does not hold the raise back', () => {
  const state = goldOnly();
  const forecast = recruitForecast(state, [], world, 'spearmen', 15, f.roma);
  expect(forecast.short.food).toBeUndefined();
  expect(forecast.canal).toBeUndefined();
});

/** Plays `days` days of Rome's economy, construction and people, with the orders on the first. */
function playEconomy(initial: GameState, days: number, first: Order[] = []) {
  let state = initial;
  for (let day = 1; day <= days; day++) {
    const result = tick(state, day === 1 ? first : [], fixtureWorld(), [
      economy,
      construction,
      population,
      (state) => {
        state.day = (state.day + 1) as Day;
      },
    ]);
    expect(result.rejected).toEqual([]);
    state = result.state;
  }
  return state;
}

const canalsAtRoma = { kind: 'build', faction: f.rome, city: f.roma, building: 'canals' } as const;

it("the tester's Canals: a player who builds them finds a card that agrees on the day the line named", () => {
  const state = foodDeficitAfterSpearmen(-13, 0.16);
  const wait = canalWait(state);
  expect(wait, 'the Canals are still at work on the named day').toBeLessThan(45);
  const ordered = recruitForecast(state, [canalsAtRoma], world, 'spearmen', 15, f.roma);
  expect(ordered.holdsAfter, 'the waiting order counts its Canals').toBe(wait);
  const dayBefore = playEconomy(state, wait - 1, [canalsAtRoma]);
  expect(required(dayBefore.cities[f.roma]).construction?.building).toBe('canals');
  const before = recruitForecast(dayBefore, [], world, 'spearmen', 15, f.roma);
  expect(before.warning).toContain(`on ${dateText(state.day + wait)}`);
  const named = playEconomy(dayBefore, 1);
  expect(named.day).toBe(state.day + wait);
  const card = recruitForecast(named, [], world, 'spearmen', 15, f.roma);
  expect(card.short.food).toBeUndefined();
  expect(card.warning).toBeUndefined();
  expectConsistent(named);
});

it('counts a Forum at work, with the people it grows with, as the days played count it', () => {
  const state = goldOnly();
  const roma = required(state.cities[f.roma]);
  roma.population = 40_000;
  roma.construction = { building: 'forum', daysLeft: 20 };
  required(state.factions[f.rome]).stores.gold = 6000;
  const forecast = recruitForecast(state, [], world, 'spearmen');
  const without = structuredClone(state);
  required(without.cities[f.roma]).construction = null;
  const unbuilt = required(recruitForecast(without, [], world, 'spearmen').short.gold);
  expect(unbuilt, 'the stores last past the Forum').toBeGreaterThan(21);
  let played = state;
  let short: number | undefined;
  for (let day = 1; day <= 6000 && short === undefined; day++) {
    played = playEconomy(
      played,
      1,
      day === 1 ? [{ kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' }] : [],
    );
    if (required(played.factions[f.rome]).stores.gold < 0) short = day;
  }
  expect(forecast.short.gold).toBe(short);
  expectConsistent(state);
});

it('counts no building whose city has an enemy at its walls, which works no day until it leaves', () => {
  const state = foodDeficitAfterSpearmen(-13, 0.16);
  const atPeace = structuredClone(state);
  const capua = required(state.cities[f.capua]);
  capua.construction = { building: 'canals', daysLeft: 1 };
  state.wars[warKey(f.rome, f.carthage)] = newWar(f.carthage, f.rome, state.day);
  for (const army of Object.values(state.armies))
    if (army.owner === f.carthage)
      army.activity = { kind: 'idle', position: { ...capua.position } };
  const unbuilt = recruitForecast(atPeace, [], world, 'spearmen', 15, f.roma).short.food;
  expect(unbuilt).toBeDefined();
  expect(recruitForecast(state, [], world, 'spearmen', 15, f.roma).short.food).toBe(unbuilt);
  expect(required(playEconomy(state, 5).cities[f.capua]).construction?.daysLeft).toBe(1);
});

/** Rome's two cities of `people` each, fed by Canals, with 30,000 gold, a full granary and `manpower` men to call up. */
function shortOfMen(people: number, manpower: number, gold = 30_000): GameState {
  const state = buildFixture();
  for (const city of Object.values(state.cities))
    if (city.owner === f.rome) {
      city.population = people;
      city.buildings = ['canals'];
    }
  Object.assign(required(state.factions[f.rome]).stores, {
    gold,
    manpower,
    food: required(limitsOf(state).get(f.rome)).food,
  });
  return state;
}

const barracksAtRoma = {
  kind: 'build',
  faction: f.rome,
  city: f.roma,
  building: 'barracks',
} as const;

/** Whether Spearmen ordered at Roma on day `raiseOn` are taken, with Barracks (or a Drill field on Barracks) at Roma ordered on day 1 or not. */
function raisedOn(initial: GameState, raiseOn: number, barracks: boolean) {
  let state = initial;
  const yard = required(initial.cities[f.roma]).buildings.includes('barracks')
    ? ({ ...barracksAtRoma, building: 'drillField' } as const)
    : barracksAtRoma;
  for (let day = 1; day <= raiseOn; day++) {
    const result = tick(
      state,
      [
        ...(barracks && day === 1 ? [yard] : []),
        ...(day === raiseOn
          ? [{ kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' } as const]
          : []),
      ],
      fixtureWorld(),
      [
        economy,
        construction,
        population,
        (state) => {
          state.day = (state.day + 1) as Day;
        },
      ],
    );
    if (day < raiseOn) expect(result.rejected).toEqual([]);
    else return result.rejected.length === 0;
    state = result.state;
  }
  return false;
}

/** The wait the card's Barracks line names, held against the played days: a raise then is taken, a day sooner is not. */
function barracksWait(state: GameState): number {
  const line = required(recruitForecast(state, [], world, 'spearmen', 15, f.roma).barracks);
  const wait = Number(/in about ([\d,]+) days/.exec(line)?.[1]?.replace(',', ''));
  const second = required(state.cities[f.roma]).buildings.includes('barracks');
  const { gold, days } = BUILDINGS[second ? 'drillField' : 'barracks'];
  expect(line).toMatch(
    new RegExp(
      `^Or build ${second ? 'a Drill field' : 'Barracks'} at Roma for ${gold.toLocaleString('en-US')} gold, which ${second ? 'gives' : 'give'} [\\d,]+ more men to call up and \\d+\\.\\d more a day once built in ${days} days: with them these men can be raised in about ${wait.toLocaleString('en-US')} days, on ${dateText(state.day + wait)}\\.$`,
    ),
  );
  expect(raisedOn(state, wait + 1, true), 'raised on the named day').toBe(true);
  expect(raisedOn(state, wait, true), 'raised a day sooner').toBe(false);
  return wait;
}

it('names a Drill field in a city that has Barracks, and holds its day against the played days', () => {
  const state = shortOfMen(40_000, 100);
  required(state.cities[f.roma]).buildings.push('barracks');
  const wait = barracksWait(state);
  expect(raisedOn(state, wait + 1, false), 'without it, not yet on that day').toBe(false);
  expectConsistent(state);
});

it('names Barracks and the day they let a raise that the call-up limit holds back for good', () => {
  const state = shortOfMen(20_000, 100);
  required(state.formations[f.hastati]).men += 1500;
  expect(required(limitsOf(state).get(f.rome)).manpower).toBeLessThan(0);
  expect(recruitForecast(state, [], world, 'spearmen', 15, f.roma).barracks).toBeUndefined();
  required(state.formations[f.hastati]).men -= 1000;
  const wait = barracksWait(state);
  expect(raisedOn(state, 3650, false), 'without them, not in ten years').toBe(false);
  expect(wait).toBeGreaterThan(40);
  expectConsistent(state);
});

it('names Barracks and the sooner day they let a raise that wants men', () => {
  const state = shortOfMen(40_000, 500);
  const wait = barracksWait(state);
  expect(raisedOn(state, wait + 1, false), 'without them, not yet on that day').toBe(false);
});

it('waits for the gold of both the Barracks and the raise', () => {
  const poor = shortOfMen(40_000, 100, 7400);
  expect(barracksWait(poor)).toBeGreaterThan(barracksWait(shortOfMen(40_000, 100)));
});

it('names no Barracks when they would not bring the raise sooner', () => {
  const state = shortOfMen(80_000, 500);
  expect(recruitForecast(state, [], world, 'spearmen', 15, f.roma).barracks).toBeUndefined();
});

it('counts Barracks at work toward the men to call up, and names none to build again', () => {
  const state = shortOfMen(40_000, 500);
  const wait = barracksWait(state);
  const atWork = playEconomy(state, 1, [barracksAtRoma]);
  expect(required(atWork.cities[f.roma]).construction?.building).toBe('barracks');
  const card = recruitForecast(atWork, [], world, 'spearmen', 15, f.roma);
  expect(card.barracks ?? '').not.toContain('Barracks at Roma');
  let played = atWork;
  for (let day = 2; day <= wait; day++) played = playEconomy(played, 1);
  expect(required(played.factions[f.rome]).stores.manpower).toBeGreaterThanOrEqual(1000);
});

it('names the day Barracks let the raise while the treasury still holds its gold, though it falls after', () => {
  const state = shortOfMen(40_000, 500, 10_000);
  const army = required(state.armies[f.romanArmy]);
  const men = army.formations.reduce((sum, id) => sum + required(state.formations[id]).men, 0);
  required(state.formations[f.hastati]).men += 4000 - men;
  const wait = barracksWait(state);
  expect(raisedOn(state, wait + 1, false), 'without them, not yet on that day').toBe(false);
});

it('names no day past the day the stores run out before the raise, when men desert', () => {
  const state = buildFixture();
  for (const city of Object.values(state.cities))
    if (city.owner === f.rome) city.population = 20_000;
  Object.assign(required(state.factions[f.rome]).stores, { gold: 30_000, manpower: 0, food: 0 });
  const line = recruitForecast(state, [], world, 'spearmen', 15, f.roma).barracks;
  if (line !== undefined) barracksWait(state);
});

function largeRome(): GameState {
  const state = buildFixture();
  growRome(state, 2 * ADMIN_CITIES);
  const rome = state.factions[f.rome];
  if (!rome) throw new Error('fixture');
  rome.stores = { gold: 50_000, food: 50_000, manpower: 50_000 };
  return state;
}

it('tells a realm past ADMIN_CITIES the gold its men are paid, less than the full upkeep', () => {
  const state = largeRome();
  const balance = dailyBalances(state).get(f.rome);
  if (!balance) throw new Error('fixture');
  const forecast = recruitForecast(state, [], world, 'spearmen');
  const men = TROOPS.spearmen.recruit.men;
  expect(forecast.upkeep.gold / (men * UPKEEP_PER_MAN.gold)).toBeCloseTo(0.878, 3);
  expect(forecast.after.gold).toBeCloseTo(balance.gold - forecast.upkeep.gold, 9);
});

it('prices the upkeep at the pay of the realm a queued peace leaves', () => {
  const state = largeRome();
  executeOrder(state, { kind: 'declareWar', faction: f.rome, against: f.carthage }, world);
  const ceded = Object.values(state.cities)
    .filter((city) => city.owner === f.rome && city.id !== f.roma)
    .slice(0, ADMIN_CITIES)
    .map((city) => city.id);
  const terms = { kind: 'payment', payer: f.rome, gold: 0, cities: ceded } as const;
  expect(
    executeOrder(state, { kind: 'offerPeace', faction: f.carthage, to: f.rome, terms }, world),
  ).toBeUndefined();
  const accept: Order = { kind: 'acceptPeace', faction: f.rome, from: f.carthage, terms };
  const forecast = recruitForecast(state, [accept], world, 'spearmen');
  expect(forecast.upkeep.gold).toBeCloseTo(TROOPS.spearmen.recruit.men * UPKEEP_PER_MAN.gold, 9);
  expect(recruitForecast(state, [], world, 'spearmen').upkeep.gold).toBeLessThan(
    forecast.upkeep.gold,
  );
});
