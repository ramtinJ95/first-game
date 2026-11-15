import type { DayEvent } from '../../src/sim/events.ts';
import type { FactionId, TradeRouteId } from '../../src/sim/ids.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import type { TradeRoute } from '../../src/sim/state/trade-route.ts';
import { adminShareOf } from '../../src/sim/systems/economy.ts';
import * as routes from '../../src/sim/trade/routes.ts';

/** What one faction has put into a route and what it has kept from it. */
export interface Entry {
  paid: number;
  received: number;
  deliveries: number;
  /** The route's own tally of the faction's receipts when the entry began, on saves that keep one. */
  kept: number;
}

export type Ledger = Map<TradeRouteId, Entry>;

/** A route that left the faction's hands before its receipts repaid what it put in. */
export interface EarlyClose {
  route: TradeRouteId;
  lost: number;
  /** The route still runs, under another owner. */
  handedOver: boolean;
}

/** A route's gold a day at each end before administration, on the rules of whichever checkout runs this. */
export const rateOf = (route: TradeRoute): number =>
  'routeRate' in routes && typeof routes.routeRate === 'function'
    ? (routes.routeRate as (r: TradeRoute) => number)(route)
    : route.daily;

export const improveCost = (route: TradeRoute): number | undefined =>
  'improvementCost' in routes && typeof routes.improvementCost === 'function'
    ? (routes.improvementCost as (r: TradeRoute) => number)(route)
    : undefined;

/** The faction's kept receipts by the route's own tally, or undefined on a save from before routes kept one. */
const tally = (route: TradeRoute, faction: FactionId): number | undefined =>
  'receipts' in route
    ? ((route.receipts as Partial<Record<FactionId, number>>)[faction] ?? 0)
    : undefined;

/**
 * Settles one day of the faction's trade. An opening counts from its `tradeOpened` event, so a
 * route the same tick closes still enters, at the price its order was quoted. Receipts come from
 * the route's tally where the save keeps one. On an older save they are an estimate: each new
 * arrival's pay, but no more than the treasury's gain that day, which a full treasury holds at 0.
 */
export function settleDay(
  ledger: Ledger,
  faction: FactionId,
  before: GameState,
  after: GameState,
  events: readonly DayEvent[],
  accepted: readonly Order[],
  quoted: ReadonlyMap<Order, number>,
): { opened: number; closed: EarlyClose[] } {
  let opened = 0;
  for (const event of events) {
    if (event.kind !== 'tradeOpened' || event.owners[0] !== faction) continue;
    const order = accepted.find(
      (o) =>
        o.kind === 'openTrade' &&
        o.from === event.from &&
        o.to === event.to &&
        !ledger.has(event.route),
    );
    if (!order) continue;
    ledger.set(event.route, { paid: quoted.get(order) ?? 0, received: 0, deliveries: 0, kept: 0 });
    opened++;
  }
  for (const order of accepted) {
    if (order.kind === 'acceptTrade' && after.tradeRoutes[order.route]?.status === 'running')
      ledger.set(order.route, { paid: 0, received: 0, deliveries: 0, kept: 0 });
    if (order.kind !== 'improveTrade') continue;
    const entry = ledger.get(order.route);
    const route = before.tradeRoutes[order.route];
    const cost = route && improveCost(route);
    if (entry && cost) entry.paid += cost;
  }
  for (const route of Object.values(after.tradeRoutes))
    if (
      route.status === 'running' &&
      (route.owner === faction || route.partner === faction) &&
      !ledger.has(route.id)
    )
      ledger.set(route.id, {
        paid: 0,
        received: 0,
        deliveries: route.deliveries,
        kept: tally(route, faction) ?? 0,
      });

  let room = Math.max(
    0,
    (after.factions[faction]?.stores.gold ?? 0) - (before.factions[faction]?.stores.gold ?? 0),
  );
  const closed: EarlyClose[] = [];
  for (const [id, entry] of ledger) {
    const route = after.tradeRoutes[id] ?? before.tradeRoutes[id];
    if (route) {
      const kept = tally(route, faction);
      if (kept !== undefined) entry.received = kept - entry.kept;
      else if (route.deliveries > entry.deliveries) {
        const ends = Number(route.owner === faction) + Number(route.partner === faction);
        const pay =
          (route.deliveries - entry.deliveries) *
          rateOf(route) *
          route.days *
          adminShareOf(after, faction) *
          ends;
        const credited = Math.min(pay, room);
        room -= credited;
        entry.received += credited;
      }
      entry.deliveries = route.deliveries;
    }
    const still = after.tradeRoutes[id];
    if (still && (still.owner === faction || still.partner === faction)) continue;
    if (entry.received < entry.paid)
      closed.push({ route: id, lost: entry.paid - entry.received, handedOver: !!still });
    ledger.delete(id);
  }
  return { opened, closed };
}
