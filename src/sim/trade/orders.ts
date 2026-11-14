import { emit } from '../events.ts';
import { allocateId, type CityId, type FactionId, type TradeRouteId } from '../ids.ts';
import { removeRecord } from '../records.ts';
import type { GameState } from '../state/game-state.ts';
import type { TradeRoute } from '../state/trade-route.ts';
import type { World } from '../world/world.ts';
import { tradeForecast, tradeProblem, type TradeMode } from './routes.ts';

interface OpenTrade {
  kind: 'openTrade';
  faction: FactionId;
  from: CityId;
  to: CityId;
  mode: TradeMode;
}
export function openTrade(state: GameState, order: OpenTrade, world: World): string | undefined {
  const problem = tradeProblem(state, world, order.faction, order.from, order.to, order.mode);
  if (problem) return problem;
  const from = state.cities[order.from];
  const to = state.cities[order.to];
  const payer = state.factions[order.faction];
  if (!from || !to || !payer) return 'a trade participant does not exist';
  const offered = to.owner === state.player && order.faction !== state.player;
  if (
    offered &&
    Object.values(state.tradeRoutes).some(
      (r) => r.status === 'offered' && r.owner === order.faction,
    )
  )
    return 'your invitation already waits for consent';
  const forecast = tradeForecast(state, world, from, to, order.mode);
  if (!forecast) return 'the trade path does not exist';
  const id = allocateId(state, 'tradeRoute');
  const route: TradeRoute = {
    id,
    from: from.id,
    to: to.id,
    owner: from.owner,
    partner: to.owner,
    mode: order.mode,
    status: offered ? 'offered' : 'running',
    path: forecast.path.map((p) => ({ ...p })),
    km: forecast.km,
    days: forecast.days,
    daily: forecast.daily,
    cost: forecast.cost,
    progress: 0,
    returning: false,
    deliveries: 0,
    openedOn: state.day,
    departsOn: state.day,
    blocked: null,
    raid: null,
  };
  state.tradeRoutes[id] = route;
  if (!offered) payer.stores.gold -= forecast.cost;
  emit(state, {
    kind: offered ? 'tradeOffered' : 'tradeOpened',
    route: id,
    from: from.id,
    to: to.id,
    owners: [from.owner, to.owner],
    position: { ...to.position },
  });
  return undefined;
}

interface AcceptTrade {
  kind: 'acceptTrade';
  faction: FactionId;
  route: TradeRouteId;
}
export function acceptTrade(
  state: GameState,
  order: AcceptTrade,
  world: World,
): string | undefined {
  const route = state.tradeRoutes[order.route];
  if (!route || route.status !== 'offered') return 'that trade invitation no longer waits';
  if (route.partner !== order.faction) return 'this invitation is not yours';
  const problem = tradeProblem(state, world, route.owner, route.from, route.to, route.mode);
  if (problem) return problem;
  const destination = state.cities[route.to];
  const payer = state.factions[route.owner];
  if (!destination || destination.owner !== route.partner) return 'the destination changed owner';
  if (!payer) return 'the trade payer does not exist';
  route.status = 'running';
  route.openedOn = state.day;
  route.departsOn = state.day;
  payer.stores.gold -= route.cost;
  emit(state, {
    kind: 'tradeOpened',
    route: route.id,
    from: route.from,
    to: route.to,
    owners: [route.owner, route.partner],
    position: { ...destination.position },
  });
  return undefined;
}

interface CloseTrade {
  kind: 'closeTrade';
  faction: FactionId;
  route: TradeRouteId;
}
export function closeTrade(state: GameState, order: CloseTrade): string | undefined {
  const route = state.tradeRoutes[order.route];
  if (!route) return 'that route no longer exists';
  if (order.faction !== route.owner && order.faction !== route.partner)
    return 'neither end is yours';
  removeRecord(state.tradeRoutes, route.id);
  return undefined;
}
