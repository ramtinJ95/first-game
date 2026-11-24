import type { DeepReadonly } from '../deep-readonly.ts';
import type { FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import type { GameState } from '../state/game-state.ts';
import { afterSpending, tradeReserve } from './budget.ts';
import { sorted } from './situation.ts';
import {
  endShareOf,
  routeSlots,
  routeOpeningCost,
  TRADE_RANGE,
  TRADE_BASE,
  DIFFERENT_GOODS,
  TRADE_PAYBACK_DAYS,
  tradeForecast,
  tradeProblem,
  type TradeMode,
} from '../trade/routes.ts';
import { distance } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import { adminShareOf } from '../systems/economy.ts';

/** One affordable route with the greatest daily return per gold, ties by city id then land. */
export function bestTrade(
  state: DeepReadonly<GameState>,
  world: World,
  faction: FactionId,
  reserve = 0,
): Order | undefined {
  const payer = state.factions[faction];
  const budget = (payer?.stores.gold ?? 0) - reserve;
  // Even a zero-length foreign route costs this much. Do not search roads a
  // faction cannot buy after keeping its military reserve.
  const minimumCost = routeOpeningCost(0, false);
  if (!payer || budget < minimumCost) return undefined;
  const share = adminShareOf(state, faction);
  const cities = Object.values(state.cities).sort((a, b) => a.id.localeCompare(b.id));
  const slots = new Map(cities.map((city) => [city.id, routeSlots(city, world)]));
  for (const route of Object.values(state.tradeRoutes)) {
    if (route.status !== 'running') continue;
    for (const end of [route.from, route.to]) slots.set(end, (slots.get(end) ?? 0) - 1);
  }
  let best: { order: Order; worth: number; income: number } | undefined;
  for (const from of cities) {
    if (from.owner !== faction || (slots.get(from.id) ?? 0) <= 0 || from.unrestDays > 0) continue;
    for (const to of cities) {
      if (
        from.id === to.id ||
        budget < routeOpeningCost(0, to.owner === faction) ||
        distance(from.position, to.position) > 1800 ||
        (slots.get(to.id) ?? 0) <= 0
      )
        continue;
      if (best) {
        const goods =
          state.provinces[from.province]?.good !== state.provinces[to.province]?.good
            ? DIFFERENT_GOODS
            : 1;
        // Distance cancels from return/cost, apart from the opening cost's ceiling.
        // Round the ratio bound upward in floating arithmetic; cap the income with
        // the same multiplication order as the forecast's 1,000 km maximum bonus.
        const domestic = to.owner === faction;
        const ends = domestic
          ? (endShareOf(state, from) + endShareOf(state, to)) / 2
          : endShareOf(state, from);
        const upperWorth =
          Math.round(
            ((goods * share * ends) / TRADE_PAYBACK_DAYS) * (1 + 8 * Number.EPSILON) * 1000000,
          ) / 1000000;
        const endpoint = TRADE_BASE * goods * 2 * share;
        const upperIncome =
          endpoint * endShareOf(state, from) + (domestic ? endpoint * endShareOf(state, to) : 0);
        if (best.worth > upperWorth || (best.worth === upperWorth && best.income >= upperIncome))
          continue;
      }
      for (const mode of ['land', 'sea'] as TradeMode[]) {
        const start = mode === 'land' ? from.position : world.harbours.get(from.id);
        const end = mode === 'land' ? to.position : world.harbours.get(to.id);
        if (!start || !end) continue;
        const direct = distance(start, end);
        if (direct > TRADE_RANGE[mode] || routeOpeningCost(direct, to.owner === faction) > budget)
          continue;
        if (tradeProblem(state, world, faction, from.id, to.id, mode)) continue;
        const f = tradeForecast(state, world, from, to, mode);
        if (!f || f.cost > budget) continue;
        const income = f.fromDaily + (to.owner === faction ? f.toDaily : 0);
        const worth = Math.round((income / f.cost) * 1000000) / 1000000;
        if (!best || worth > best.worth || (worth === best.worth && income > best.income))
          best = {
            order: { kind: 'openTrade', faction, from: from.id, to: to.id, mode },
            worth,
            income,
          };
      }
    }
  }
  return best?.order;
}

/** Monthly, staggered by faction id. Preserve the army's reserve and its next recruit. */
export function trading(
  current: DeepReadonly<GameState>,
  world: World,
  faction: FactionId,
  prior: readonly Order[] = [],
): Order[] {
  let state = current;
  // This runs only for factions decideAll controls. A passive human is skipped,
  // while the all-AI control must give its player faction consent explicitly too.
  const invitation = Object.values(state.tradeRoutes)
    .filter((route) => route.status === 'offered' && route.partner === faction)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (invitation) {
    const problem = tradeProblem(
      state,
      world,
      invitation.owner,
      invitation.from,
      invitation.to,
      invitation.mode,
    );
    return [{ kind: problem ? 'closeTrade' : 'acceptTrade', faction, route: invitation.id }];
  }
  const index = sorted(state.factions).findIndex((record) => record.id === faction);
  if (state.day % 30 !== index % 30) return [];
  if (prior.some((order) => order.kind === 'declareWar')) return [];
  state = afterSpending(current, prior, world);
  if (Object.values(state.tradeRoutes).some((r) => r.owner === faction && r.status === 'offered'))
    return [];
  const order = bestTrade(state, world, faction, tradeReserve(state, faction));
  return order ? [order] : [];
}
