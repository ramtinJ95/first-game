import { expect, it } from 'vitest';
import { trainingDaysAt } from '../sim/buildings/buildings.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import { newGame } from '../sim/new-game.ts';
import { UNREST_DAYS } from '../sim/cities.ts';
import { expectConsistent } from '../sim/references.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { dailyBalances, economy, limitsOf, UPKEEP_PER_MAN } from '../sim/systems/economy.ts';
import { tick } from '../sim/tick.ts';
import { recruitForecast } from './recruit-forecast.ts';
import { population } from '../sim/systems/population.ts';
import { TROOPS } from '../sim/troops.ts';
import { executeOrder } from '../sim/orders/orders.ts';

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
  const state = foodDeficitAfterSpearmen(-20);
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
  const state = foodDeficitAfterSpearmen(-5, 0.1);
  const forecast = recruitForecast(state, [], world, 'spearmen');
  const wait = required(forecast.holdsAfter);
  expect(forecast.short.food).toBeDefined();
  expect(wait).toBeGreaterThan(30);
  expect(forecast.warning).toContain(
    `raised in about ${wait.toLocaleString('en-US')} days, these men are fed as the people grow. Raise now only if you need them sooner.`,
  );
  expect(forecast.warning).not.toContain('Raise fewer troops');
  expect(() => firstShortfall(state, 'food', true, 1 + wait)).toThrow('Stores never ran short');
  expect(firstShortfall(state, 'food', true, wait)).toBeGreaterThan(wait);
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
  required(state.cities[f.capua]).population = 2000;
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

function firstShortfall(initial: GameState, store: 'food' | 'gold', growing = false, raiseOn = 1) {
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
    expect(result.rejected).toEqual([]);
    state = result.state;
    expectConsistent(state);
    if (required(state.factions[f.rome]).stores[store] < 0) return day;
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

/** Rome's people as they are and its granary `full`, with one army sized so the food balance after a spearmen raise is `after`. */
function foodDeficitAfterSpearmen(after: number, full = 1): GameState {
  const state = buildFixture();
  for (const city of Object.values(state.cities))
    if (city.owner === f.rome) city.population = 200_000;
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
