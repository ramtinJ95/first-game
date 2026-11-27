import { describe, expect, test } from 'vitest';
import { ADVANCES } from '../sim/advances/advances.ts';
import { BUILDINGS } from '../sim/buildings/buildings.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import { guardGoldOf } from '../sim/guards.ts';
import type { Order } from '../sim/orders/orders.ts';
import { expectConsistent } from '../sim/references.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { tick } from '../sim/tick.ts';
import { openTrade } from '../sim/trade/orders.ts';
import { improvementCost } from '../sim/trade/routes.ts';
import { TROOPS } from '../sim/troops.ts';
import { whole } from './names.ts';
import { unpaidNewsOfDay } from './unpaid-news.ts';

const world = fixtureWorld();

/** Rome with a running route from Roma to Capua, the order that improves it, and its cost. */
function withRoute() {
  const state = buildFixture();
  const opening = {
    kind: 'openTrade',
    faction: FIXTURE.rome,
    from: FIXTURE.roma,
    to: FIXTURE.capua,
    mode: 'land',
  } as const;
  expect(openTrade(state, opening, world)).toBeUndefined();
  const route = Object.values(state.tradeRoutes)[0];
  if (!route) throw new Error('expected a route');
  const improve: Order = { kind: 'improveTrade', faction: FIXTURE.rome, route: route.id };
  return { state, improve, cost: improvementCost(route) };
}

function newsOf(before: GameState, orders: readonly Order[]) {
  const result = tick(before, orders, world);
  expectConsistent(result.state);
  return unpaidNewsOfDay(before, result.state, result.events);
}

function setGold(state: GameState, gold: number) {
  const rome = state.factions[FIXTURE.rome];
  if (!rome) throw new Error('expected Rome');
  rome.stores.gold = gold;
}

describe('the news of an order the treasury could not pay', () => {
  test('a study after an improvement says what failed, its price, and what the treasury held after what', () => {
    const { state, improve, cost } = withRoute();
    const price = ADVANCES.citizenRolls.gold;
    setGold(state, cost + price - 300);
    const news = newsOf(state, [
      improve,
      { kind: 'study', faction: FIXTURE.rome, advance: 'citizenRolls' },
    ]);
    expect(news.map((alert) => alert.text)).toEqual([
      `Citizen rolls was not begun: it costs ${whole(price)} gold and the treasury held ${whole(price - 300)} after the route from Roma to Capua.`,
    ]);
    expect(news[0]).toMatchObject({ kind: 'orderUnpaid', tone: 'bad', opens: 'advances' });
  });

  test('buildings, recruits and guards that cannot be paid say so at their city', () => {
    const { state, improve, cost } = withRoute();
    const roma = state.cities[FIXTURE.roma];
    if (!roma) throw new Error('expected Roma');
    roma.population = 30_000;
    setGold(state, cost + 100);
    const news = newsOf(state, [
      improve,
      { kind: 'build', faction: FIXTURE.rome, city: FIXTURE.roma, building: 'forum' },
      { kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.roma, troop: 'spearmen' },
      { kind: 'hireGuards', faction: FIXTURE.rome, city: FIXTURE.roma },
    ]);
    expect(news.map((alert) => alert.text)).toEqual([
      `Forum at Roma was not begun: it costs ${whole(BUILDINGS.forum.gold)} gold and the treasury held 100 after the route from Roma to Capua.`,
      `Spearmen at Roma were not raised: they cost ${whole(TROOPS.spearmen.recruit.gold)} gold and the treasury held 100 after the route from Roma to Capua.`,
      `Guards at Roma were not hired: they cost ${whole(guardGoldOf(FIXTURE.rome))} gold and the treasury held 100 after the route from Roma to Capua.`,
    ]);
    expect(news[0]?.focus?.at).toEqual(roma.position);
  });

  test('tells nothing of an order refused for another reason, or of another power', () => {
    const { state } = withRoute();
    setGold(state, 50_000);
    const rome = state.factions[FIXTURE.rome];
    if (rome) rome.study = { advance: 'clemency', daysLeft: 10, paid: 1000 };
    expect(
      newsOf(state, [
        { kind: 'study', faction: FIXTURE.rome, advance: 'citizenRolls' },
        { kind: 'study', faction: FIXTURE.carthage, advance: 'drillmasters' },
      ]),
    ).toEqual([]);
  });
});
