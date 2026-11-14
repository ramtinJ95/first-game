import type { DeepReadonly } from '../deep-readonly.ts';
import type { FactionId } from '../ids.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import type { GameState } from '../state/game-state.ts';
import { mostNeeded } from './budget.ts';
import { reserveOf, sorted } from './situation.ts';
import { TROOPS } from '../troops.ts';
import { routeSlots, tradeForecast, tradeProblem, type TradeMode } from '../trade/routes.ts';
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
        distance(from.position, to.position) > 1800 ||
        (slots.get(to.id) ?? 0) <= 0
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

/** Monthly, staggered by faction id. Preserve the army's reserve and its next recruit. */
export function trading(
  current: DeepReadonly<GameState>,
  world: World,
  faction: FactionId,
  prior: readonly Order[] = [],
): Order[] {
  let state = current;
  const index = sorted(state.factions).findIndex((record) => record.id === faction);
  if (state.day % 30 !== index % 30) return [];
  if (prior.some((order) => order.kind === 'declareWar')) return [];
  const spending = prior.filter((order) =>
    ['recruit', 'build', 'cancelBuilding', 'sack', 'enslave', 'acceptPeace'].includes(order.kind),
  );
  if (spending.length) {
    const copy = JSON.parse(JSON.stringify(current)) as GameState;
    for (const order of spending) executeOrder(copy, order, world);
    state = copy;
  }
  if (Object.values(state.tradeRoutes).some((r) => r.owner === faction && r.status === 'offered'))
    return [];
  const next =
    state.factions[faction]?.kind === 'greatPower'
      ? TROOPS[mostNeeded(state, faction)].recruit.gold
      : Math.min(...Object.values(TROOPS).map((troop) => troop.recruit.gold));
  const order = bestTrade(
    state,
    world,
    faction,
    Math.max(600, reserveOf(state, faction, 'gold')) + next,
  );
  return order ? [order] : [];
}
