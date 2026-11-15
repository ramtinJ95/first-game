import { expect, test } from 'vitest';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../../src/sim/fixture.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { limitsOf } from '../../src/sim/systems/economy.ts';
import { tick } from '../../src/sim/tick.ts';
import { tradeForecast } from '../../src/sim/trade/routes.ts';
import { settleDay, type Ledger } from './trade-ledger.ts';

const world = fixtureWorld();

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture record');
  return value;
}

test('a route opened and closed on the same day enters the ledger and is lost whole', () => {
  const state = buildFixture();
  const open: Order = {
    kind: 'openTrade',
    faction: f.rome,
    from: f.roma,
    to: f.carthago,
    mode: 'sea',
  };
  const war: Order = { kind: 'declareWar', faction: f.carthage, against: f.rome };
  const cost = need(
    tradeForecast(state, world, need(state.cities[f.roma]), need(state.cities[f.carthago]), 'sea'),
  ).cost;
  const { state: next, events, rejected } = tick(state, [open, war], world);
  expect(rejected).toEqual([]);
  expect(Object.keys(next.tradeRoutes)).toEqual([]);
  const ledger: Ledger = new Map();
  const day = settleDay(ledger, f.rome, state, next, events, [open], new Map([[open, cost]]));
  expect(day.opened).toBe(1);
  expect(day.closed).toEqual([expect.objectContaining({ lost: cost, handedOver: false })]);
  expect(ledger.size).toBe(0);
});

/** Rome's Roma to Capua road, one day short of an arrival, with Rome's treasury full. */
function arrivingAtFullTreasury() {
  const state = buildFixture();
  const open: Order = {
    kind: 'openTrade',
    faction: f.rome,
    from: f.roma,
    to: f.capua,
    mode: 'land',
  };
  const opened = tick(state, [open], world).state;
  const route = need(Object.values(opened.tradeRoutes)[0]);
  route.progress = 1 - 1 / route.days;
  route.departsOn = opened.day;
  need(opened.factions[f.rome]).stores.gold = need(limitsOf(opened).get(f.rome)).gold;
  const ledger: Ledger = new Map([
    [route.id, { paid: route.cost, received: 0, deliveries: 0, kept: 0 }],
  ]);
  return { opened, route, ledger };
}

test('an arrival into a full treasury repays nothing, by the route tally', () => {
  const { opened, route, ledger } = arrivingAtFullTreasury();
  const { state: next, events } = tick(opened, [], world);
  expect(next.tradeRoutes[route.id]?.deliveries).toBe(1);
  settleDay(ledger, f.rome, opened, next, events, [], new Map());
  expect(ledger.get(route.id)?.received).toBe(0);
});

test('on a save with no route tally, the estimate is held to the room under the treasury limit', () => {
  const { opened, route, ledger } = arrivingAtFullTreasury();
  const { state: next, events } = tick(opened, [], world);
  const untallied = (state: GameState): GameState => {
    const copy = structuredClone(state);
    for (const r of Object.values(copy.tradeRoutes)) delete (r as Partial<typeof r>).receipts;
    return copy;
  };
  settleDay(ledger, f.rome, untallied(opened), untallied(next), events, [], new Map());
  expect(ledger.get(route.id)?.deliveries).toBe(1);
  expect(ledger.get(route.id)?.received).toBe(0);
});
