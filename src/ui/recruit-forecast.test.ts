import { expect, it } from 'vitest';
import { trainingDaysAt } from '../sim/buildings/buildings.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import { UNREST_DAYS } from '../sim/cities.ts';
import { expectConsistent } from '../sim/references.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { dailyBalances, economy, limitsOf } from '../sim/systems/economy.ts';
import { tick } from '../sim/tick.ts';
import { recruitForecast, RECRUIT_WARNING_DAYS } from './recruit-forecast.ts';
import { TROOPS } from '../sim/troops.ts';

it('warns for a gold-only shortfall even before the new formation musters', () => {
  const state = goldOnly();
  const forecast = recruitForecast(state, [], 'spearmen');
  expect(forecast.after.food).toBeGreaterThan(0);
  expect(forecast.warning).not.toContain('Food shortfall');
  expect(forecast.warning).toContain('Gold shortfall');
  expect(forecast.lasts.gold).toBeLessThan(15);
  expect(forecast.lasts.gold).toBe(firstShortfall(state, 'gold'));
});

it.each([365, 366])('warns through the one-year boundary, not beyond it (%i days)', (days) => {
  const state = goldOnly();
  const current = required(dailyBalances(state).get(f.rome));
  const final = recruitForecast(state, [], 'spearmen').after;
  required(state.factions[f.rome]).stores.gold =
    TROOPS.spearmen.recruit.gold - current.gold * 15 - final.gold * (days - 15 - 0.5);
  const forecast = recruitForecast(state, [], 'spearmen');
  expect(RECRUIT_WARNING_DAYS).toBe(365);
  expect(forecast.lasts.gold).toBe(days);
  expect(forecast.runway.find((store) => store.key === 'gold')).toMatchObject({
    urgent: days <= 365,
    text: `about ${days} days left`,
  });
  if (days <= 365) expect(forecast.warning).toContain('Gold shortfall');
  else expect(forecast.warning).toBeUndefined();
  expect(forecast.after.gold).toBeLessThan(0);
  expectConsistent(state);
});

it('gives the realm forecast without adding a hypothetical troop, and keeps card text troop-specific', () => {
  const state = buildFixture();
  const balance = required(dailyBalances(state).get(f.rome));
  const pending = [{ kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' }] as const;
  const realm = recruitForecast(state, pending);
  expect(realm.after.food).toBeCloseTo(balance.food - 6);
  expect(realm.after.gold).toBeCloseTo(balance.gold - 10);
  expect(realm.upkeep).toEqual({ food: 0, gold: 0 });
  const card = recruitForecast(state, pending, 'archers');
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
    const forecast = recruitForecast(state, [], 'spearmen', trainingDaysAt(city, 15));
    expect(forecast.lasts.food).toBe(firstShortfall(state, 'food'));
  },
);

function firstShortfall(initial: GameState, store: 'food' | 'gold') {
  let state = initial;
  for (let day = 1; day <= 2000; day++) {
    const result = tick(
      state,
      day === 1 ? [{ kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' }] : [],
      fixtureWorld(),
      [
        economy,
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
