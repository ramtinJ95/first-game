import type { DeepReadonly } from '../deep-readonly.ts';
import type { FactionId } from '../ids.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import type { GameState } from '../state/game-state.ts';
import { dailyBalances } from '../systems/economy.ts';
import { freeSlots, tradeForecast, tradeProblem, type TradeMode } from '../trade/routes.ts';
import { distance } from '../world/find-path.ts';
import type { World } from '../world/world.ts';

/** One affordable route with the greatest daily return per gold, ties by city id then land. */
export function bestTrade(
  state: DeepReadonly<GameState>,
  world: World,
  faction: FactionId,
  reserve = 0,
): Order | undefined {
  const cities = Object.values(state.cities).sort((a, b) => a.id.localeCompare(b.id));
  let best: { order: Order; worth: number; income: number } | undefined;
  for (const from of cities) {
    if (from.owner !== faction || freeSlots(state, from, world) <= 0 || from.unrestDays > 0)
      continue;
    for (const to of cities) {
      if (
        from.id === to.id ||
        distance(from.position, to.position) > 1800 ||
        freeSlots(state, to, world) <= 0
      )
        continue;
      for (const mode of ['land', 'sea'] as TradeMode[]) {
        if (tradeProblem(state, world, faction, from.id, to.id, mode)) continue;
        const f = tradeForecast(state, world, from, to, mode);
        const payer = state.factions[faction];
        if (!f || !payer || payer.stores.gold - f.cost < reserve) continue;
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

/** Monthly, staggered by faction id. No dice, and soldiers retain a two-month reserve. */
export function trading(
  current: DeepReadonly<GameState>,
  world: World,
  faction: FactionId,
  prior: readonly Order[] = [],
): Order[] {
  let state = current;
  const index = Object.keys(state.factions).sort().indexOf(faction);
  if (state.day % 30 !== index % 30) return [];
  if (prior.some((order) => order.kind === 'declareWar')) return [];
  if (prior.length) {
    const copy = JSON.parse(JSON.stringify(current)) as GameState;
    for (const order of prior) executeOrder(copy, order, world);
    state = copy;
  }
  if (Object.values(state.tradeRoutes).some((r) => r.owner === faction && r.status === 'offered'))
    return [];
  const balance = dailyBalances(state).get(faction)?.gold ?? 0;
  const order = bestTrade(state, world, faction, Math.max(600, balance * 60));
  return order ? [order] : [];
}
