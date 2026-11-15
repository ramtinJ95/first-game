import type { DeepReadonly } from '../deep-readonly.ts';
import type { FactionId, TradeRouteId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import { areAtWar } from '../wars.ts';
import { improvementCost, MAX_IMPROVEMENTS } from './routes.ts';

export interface ImproveTrade {
  kind: 'improveTrade';
  faction: FactionId;
  route: TradeRouteId;
}

/** Why the faction cannot improve the route now, or undefined when it can. */
export function improveProblem(
  state: DeepReadonly<GameState>,
  order: ImproveTrade,
): string | undefined {
  const route = state.tradeRoutes[order.route];
  if (!route || route.status !== 'running') return 'that route is not running';
  if (order.faction !== route.owner && order.faction !== route.partner)
    return 'neither end is yours';
  if (route.improvedBy.length >= MAX_IMPROVEMENTS)
    return `this route is improved ${MAX_IMPROVEMENTS} times already`;
  if (areAtWar(state, route.owner, route.partner)) return 'the two ends are at war';
  const gold = state.factions[order.faction]?.stores.gold;
  if (gold === undefined) return `faction ${order.faction} does not exist`;
  const cost = improvementCost(route);
  if (gold < cost) return `improving this route needs ${cost} gold`;
  return undefined;
}

/**
 * Either end of a running route pays half its opening price to raise its rate at both
 * ends by IMPROVE_STEP, up to MAX_IMPROVEMENTS times. The gold is not refunded on closing.
 */
export function improveTrade(state: GameState, order: ImproveTrade): string | undefined {
  const problem = improveProblem(state, order);
  const route = state.tradeRoutes[order.route];
  const payer = state.factions[order.faction];
  if (problem || !route || !payer) return problem ?? 'that route is not running';
  payer.stores.gold -= improvementCost(route);
  route.improvedBy.push(order.faction);
  return undefined;
}
