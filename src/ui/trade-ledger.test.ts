import { describe, expect, test } from 'vitest';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../sim/fixture.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warKey } from '../sim/state/war.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import { acceptTrade, openTrade } from '../sim/trade/orders.ts';
import { whole } from '../app/names.ts';
import { closeText, warJoiners, warTradeLines } from './trade-ledger.ts';

const world = fixtureWorld();

/** Rome's route from Roma, after `deliveries` arrivals. */
function trading(state: GameState, to: typeof f.roma, mode: 'land' | 'sea', deliveries = 2) {
  const order = { kind: 'openTrade', faction: f.rome, from: f.roma, to, mode } as const;
  expect(openTrade(state, order, world)).toBeUndefined();
  const route = Object.values(state.tradeRoutes).find((r) => r.to === to);
  if (!route) throw new Error('expected a route');
  route.deliveries = deliveries;
  return route;
}

describe('what closing trade costs the player', () => {
  test('Close route tells the price, an estimate of the arrivals and of what is unpaid, and the price to reopen', () => {
    const state = buildFixture();
    const route = trading(state, f.carthago, 'sea');
    const worth = 2 * route.daily * route.days;
    expect(closeText(state, route)).toBe(
      `Close Roma to Carthago by sea? It cost ${whole(route.cost)} gold, arrivals worth about ${whole(worth)} gold, about ${whole(route.cost - worth)} still unpaid. Receipts that came while your treasury was full were not kept, so you may have received less than that. Closing gives no refund, and opening it again costs the full price, ${whole(route.cost)} gold.`,
    );
  });

  test('the ledger always says a full treasury kept no receipts, also after the gold is spent', () => {
    const state = buildFixture();
    const route = trading(state, f.carthago, 'sea');
    const rome = state.factions[f.rome];
    if (!rome) throw new Error('missing Rome');
    rome.stores.gold = limitsOf(state).get(f.rome)?.gold ?? Infinity;
    const full = 'Your treasury is full, and receipts above a full treasury are not kept';
    expect(closeText(state, route)).toContain(full);
    expect(warTradeLines(state, f.carthage)).toContain(
      `${full}, so you may have received less than that.`,
    );
    rome.stores.gold -= 100;
    const spent = 'Receipts that came while your treasury was full were not kept';
    expect(closeText(state, route)).toContain(spent);
    expect(warTradeLines(state, f.carthage)).toContain(
      `${spent}, so you may have received less than that.`,
    );
  });

  test('a route the partner paid for cost the player nothing, and a paid-off route owes nothing', () => {
    const state = buildFixture();
    const carthage = state.factions[f.carthage];
    if (!carthage) throw new Error('missing Carthage');
    carthage.stores.gold = 10000;
    const invite = {
      kind: 'openTrade',
      faction: f.carthage,
      from: f.carthago,
      to: f.roma,
      mode: 'sea',
    } as const;
    expect(openTrade(state, invite, world)).toBeUndefined();
    const route = Object.values(state.tradeRoutes)[0];
    if (!route) throw new Error('expected an invitation');
    expect(
      acceptTrade(state, { kind: 'acceptTrade', faction: f.rome, route: route.id }, world),
    ).toBeUndefined();
    route.deliveries = 1;
    expect(closeText(state, route)).toContain(
      `It cost you nothing, as Carthage paid, arrivals worth about ${whole(route.daily * route.days)} gold, about 0 still unpaid.`,
    );
  });

  test('the war confirmation lists each route the war closes and the roads it exposes', () => {
    const state = buildFixture();
    const sea = trading(state, f.carthago, 'sea');
    trading(state, f.capua, 'land', 0);
    const worth = 2 * sea.daily * sea.days;
    expect(warTradeLines(state, f.carthage)).toEqual([
      `It closes Roma to Carthago by sea: cost ${whole(sea.cost)} gold, arrivals worth about ${whole(worth)} gold, about ${whole(sea.cost - worth)} still unpaid.`,
      'Receipts that came while your treasury was full were not kept, so you may have received less than that.',
      'Their armies could then raid your other land road.',
    ]);
    expect(warTradeLines(state, f.syracusaeFaction)).toEqual([
      'Their armies could then raid your other land road.',
    ]);
  });

  test("a minor's league partner joins at once, so its routes are listed too, unless a truce holds it", () => {
    const state = buildFixture();
    const syracusae = state.factions[f.syracusaeFaction];
    const carthage = state.factions[f.carthage];
    if (!syracusae || !carthage) throw new Error('missing factions');
    syracusae.league = f.carthage;
    carthage.league = f.syracusaeFaction;
    trading(state, f.carthago, 'sea', 0);
    expect(warJoiners(state, f.syracusaeFaction)).toEqual([f.syracusaeFaction, f.carthage]);
    expect(warTradeLines(state, f.syracusaeFaction)).toEqual([
      expect.stringMatching(
        /^It closes Roma to Carthago by sea: cost [\d,]+ gold, arrivals worth about 0 gold/,
      ),
      'Receipts that came while your treasury was full were not kept, so you may have received less than that.',
      "Carthage joins as Syracusae's league partner, so its routes close too.",
    ]);
    state.truces[warKey(f.carthage, f.rome)] = {
      since: state.day,
      endsOn: (state.day + 100) as Day,
    };
    expect(warJoiners(state, f.syracusaeFaction)).toEqual([f.syracusaeFaction]);
  });
});
