import { readFileSync } from 'node:fs';
import { decideAll } from '../src/sim/ai/decide.ts';
import type { CityId, FactionId, TradeRouteId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { DayEvent } from '../src/sim/events.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { adminShareOf } from '../src/sim/systems/economy.ts';
import { tick } from '../src/sim/tick.ts';
import * as routes from '../src/sim/trade/routes.ts';
import { areAtWar } from '../src/sim/wars.ts';
import { distance } from '../src/sim/world/find-path.ts';
import { buildWorld, type World } from '../src/sim/world/world.ts';

export const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
export const world: World = buildWorld(map);
export const rome = 'rome' as FactionId;
const MODES = ['land', 'sea'] as const;
const IMPROVE_PAYBACK_DAYS = 3 * 365;
const TRADE_FLOOR = 600;

export interface CautiousDay {
  before: GameState;
  after: GameState;
  events: readonly DayEvent[];
  /** Rome's orders the rules took today, its trade and the AI's spending for it alike. */
  accepted: readonly Order[];
}

/**
 * The cautious Rome of `scripts/sim/trade-judge.ts --heed --improve`: every faction plays
 * the AI, Rome included, except Rome's trade, which accepts every invitation the AI would,
 * opens its best route by return per gold monthly, improves the route that repays soonest
 * with no route to open, skips a partner at war or a besieged end, and declares no war on
 * a partner whose routes have not repaid. With `peaceful`, Rome declares no war at all,
 * as the tester's cautious Rome did. Unlike trade-judge, a war Rome holds back does not
 * also hold back its trade that month. Plays until the years are out or Rome falls.
 */
export function playCautiousRome(
  seed: number,
  years: number,
  onDay: (day: CautiousDay) => void,
  { peaceful = false }: { peaceful?: boolean } = {},
): GameState {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const ledger = new Map<TradeRouteId, { paid: number; received: number; deliveries: number }>();
  for (let day = 0; day < years * 365; day++) {
    const ai = decideAll(state, world, []);
    const owing = (faction: FactionId) =>
      [...ledger].some(([id, entry]) => {
        const route = state.tradeRoutes[id];
        const other = route?.owner === rome ? route.partner : route?.owner;
        return other === faction && entry.received < entry.paid;
      });
    const held = (o: Order) =>
      o.faction === rome && o.kind === 'declareWar' && (peaceful || owing(o.against));
    const orders: Order[] = ai.filter(
      (o) =>
        !held(o) &&
        (o.faction !== rome ||
          !['openTrade', 'acceptTrade', 'closeTrade', 'improveTrade'].includes(o.kind)),
    );
    orders.unshift(
      ...tradeOrders(
        state,
        ai.filter((o) => o.faction === rome && !held(o)),
      ),
    );
    const before = new Set(Object.keys(state.tradeRoutes));
    const { state: next, rejected, events } = tick(state, orders, world);
    const accepted = orders.filter(
      (o) => o.faction === rome && !rejected.some((r) => r.order === o),
    );
    for (const order of accepted) {
      if (order.kind === 'acceptTrade' && next.tradeRoutes[order.route]?.status === 'running')
        ledger.set(order.route, { paid: 0, received: 0, deliveries: 0 });
      const entry = order.kind === 'improveTrade' ? ledger.get(order.route) : undefined;
      const route = order.kind === 'improveTrade' ? state.tradeRoutes[order.route] : undefined;
      const cost = route && routes.improvementCost(route);
      if (entry && cost) entry.paid += cost;
    }
    for (const route of Object.values(next.tradeRoutes)) {
      if (before.has(route.id) || route.owner !== rome || route.status !== 'running') continue;
      if (accepted.some((o) => o.kind === 'openTrade'))
        ledger.set(route.id, { paid: route.cost, received: 0, deliveries: 0 });
    }
    for (const route of Object.values(next.tradeRoutes))
      if (
        route.status === 'running' &&
        (route.owner === rome || route.partner === rome) &&
        !ledger.has(route.id)
      )
        ledger.set(route.id, { paid: 0, received: 0, deliveries: route.deliveries });
    for (const [id, entry] of ledger) {
      const route = next.tradeRoutes[id];
      if (route && route.deliveries > entry.deliveries) {
        const ends = Number(route.owner === rome) + Number(route.partner === rome);
        entry.received +=
          (route.deliveries - entry.deliveries) *
          routes.routeRate(route) *
          route.days *
          adminShareOf(next, rome) *
          ends;
        entry.deliveries = route.deliveries;
      }
      if (!route || (route.owner !== rome && route.partner !== rome)) ledger.delete(id);
    }
    onDay({ before: state, after: next, events, accepted });
    state = next;
    if (state.factions[rome]?.defeatedOn !== null) break;
  }
  return state;
}

function tradeOrders(state: GameState, ai: readonly Order[]): Order[] {
  const invitation = Object.values(state.tradeRoutes).find(
    (r) => r.status === 'offered' && r.partner === rome,
  );
  if (invitation) {
    const from = state.cities[invitation.from];
    const to = state.cities[invitation.to];
    const accept =
      ai.some((o) => o.kind === 'acceptTrade') && !(from && to && risky(state, from.id, to.id));
    return [{ kind: accept ? 'acceptTrade' : 'closeTrade', faction: rome, route: invitation.id }];
  }
  if (state.day % 30 !== 0 || ai.some((o) => o.kind === 'declareWar')) return [];
  const budget = (state.factions[rome]?.stores.gold ?? 0) - TRADE_FLOOR;
  const best = quotes(state).filter((q) => q.cost <= budget)[0];
  if (best) return [best.order];
  return improvement(state, budget);
}

function improvement(state: GameState, budget: number): Order[] {
  const share = adminShareOf(state, rome);
  let pick: { order: Order; days: number } | undefined;
  for (const route of Object.values(state.tradeRoutes)) {
    const cost = routes.improvementCost(route);
    if (route.status !== 'running' || cost === undefined || cost > budget) continue;
    if (route.owner !== rome && route.partner !== rome) continue;
    if (route.improvedBy.length >= 2) continue;
    const ends = Number(route.owner === rome) + Number(route.partner === rome);
    const days = cost / (route.daily * 0.25 * ends * share);
    if (days <= IMPROVE_PAYBACK_DAYS && (!pick || days < pick.days))
      pick = { order: { kind: 'improveTrade', faction: rome, route: route.id }, days };
  }
  return pick ? [pick.order] : [];
}

function quotes(state: GameState) {
  const found: { order: Order; cost: number; income: number }[] = [];
  for (const from of Object.values(state.cities)) {
    if (from.owner !== rome) continue;
    for (const to of Object.values(state.cities)) {
      if (to.id === from.id || distance(from.position, to.position) > routes.TRADE_RANGE.sea)
        continue;
      if (risky(state, from.id, to.id)) continue;
      for (const mode of MODES) {
        if (routes.tradeProblem(state, world, rome, from.id, to.id, mode, false)) continue;
        const f = routes.tradeForecast(state, world, from, to, mode);
        if (!f) continue;
        const income = f.fromDaily + (to.owner === rome ? f.toDaily : 0);
        found.push({
          order: { kind: 'openTrade', faction: rome, from: from.id, to: to.id, mode },
          cost: f.cost,
          income,
        });
      }
    }
  }
  return found.sort((a, b) => b.income / b.cost - a.income / a.cost || b.income - a.income);
}

function risky(state: GameState, from: CityId, to: CityId): boolean {
  const partner = state.cities[to];
  if (!partner) return true;
  const atWar = Object.values(state.factions).some(
    (f) => f.id !== partner.owner && areAtWar(state, partner.owner, f.id),
  );
  const besieged = Object.values(state.sieges).some((s) => s.city === from || s.city === to);
  return atWar || besieged;
}
