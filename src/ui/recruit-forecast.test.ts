import { expect, it } from 'vitest';
import { trainingDaysAt } from '../sim/buildings/buildings.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import { newGame } from '../sim/new-game.ts';
import { changeCityOwner, UNREST_DAYS } from '../sim/cities.ts';
import { expectConsistent } from '../sim/references.ts';
import type { Day } from '../sim/state/day.ts';
import { dateText } from '../app/names.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { dailyBalances, economy, limitsOf, UPKEEP_PER_MAN } from '../sim/systems/economy.ts';
import { tick } from '../sim/tick.ts';
import { MOVED_DAYS, movedText, recruitForecast } from './recruit-forecast.ts';
import { TROOP_NAMES } from '../app/names.ts';
import { population } from '../sim/systems/population.ts';
import { construction } from '../sim/systems/construction.ts';
import { TROOPS } from '../sim/troops.ts';
import { executeOrder } from '../sim/orders/orders.ts';
import { recruit } from '../sim/orders/recruit.ts';

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
    const forecast = recruitForecast(state, [], world, 'spearmen', trainingDaysAt(city, 15));
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

/** The day Rome's food first runs short when it starts Canals at Roma on day 1 and raises Spearmen on `raiseOn`. */
function shortWithCanals(initial: GameState, raiseOn: number) {
  let state = initial;
  for (let day = 1; day <= 6000; day++) {
    const orders = [
      ...(day === 1
        ? [{ kind: 'build', faction: f.rome, city: f.roma, building: 'canals' } as const]
        : []),
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
function canalWait(state: GameState): number {
  const canal = required(recruitForecast(state, [], world, 'spearmen', 15, f.roma).canal);
  const wait = Number(/in about ([\d,]+) days/.exec(canal)?.[1]?.replace(',', ''));
  expect(canal).toBe(
    `Or build Canals at Roma for 4,000 gold, which grow 5 more food a day once built in 45 days: with them these men are fed if raised in about ${wait.toLocaleString('en-US')} days, on ${dateText(state.day + wait)}.`,
  );
  expect(shortWithCanals(state, wait + 1)).toBeUndefined();
  expect(shortWithCanals(state, wait)).toBeDefined();
  return wait;
}

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
