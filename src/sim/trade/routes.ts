import type { DeepReadonly } from '../deep-readonly.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import type { TradeRoute } from '../state/trade-route.ts';
import { adminShareOf, adminShares } from '../systems/economy.ts';
import { areAtWar } from '../wars.ts';
import { distance, findPath } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import { emit } from '../events.ts';
import { removeRecord } from '../records.ts';

type State = DeepReadonly<GameState>;
export type TradeMode = 'land' | 'sea';
export const TRADE_SPEED = { land: 16, sea: 28 } as const;
export const TRADE_RANGE = { land: 1000, sea: 1800 } as const;
export const TRADE_BASE = 1.15;
export const DIFFERENT_GOODS = 1.8;
export const TRADE_PAYBACK_DAYS = 740;
export const RAID_KM = 20;

export function closeRoutesAt(state: GameState, city: CityId): void {
  for (const route of routesAt(state, city)) {
    emit(state, {
      kind: 'tradeClosed',
      route: route.id,
      from: route.from,
      to: route.to,
      owners: [route.owner, route.partner],
      cause: 'a city changed owner',
      position: routePoint(route),
    });
    removeRecord(state.tradeRoutes, route.id);
  }
}

/** Size provides one or two slots; civic markets and a harbour each support one more. */
export function routeSlots(city: DeepReadonly<City>, world: World): number {
  return (
    1 +
    Number(city.population >= 25000) +
    Number(city.buildings.includes('forum')) +
    Number(world.harbours.has(city.id))
  );
}

export function routesAt(state: State, city: CityId): DeepReadonly<TradeRoute>[] {
  return Object.values(state.tradeRoutes).filter((r) => r.from === city || r.to === city);
}

export function freeSlots(state: State, city: DeepReadonly<City>, world: World): number {
  return (
    routeSlots(city, world) - routesAt(state, city.id).filter((r) => r.status === 'running').length
  );
}

interface Geometry {
  path: readonly MapPoint[];
  km: number;
  days: number;
}
const geometries = new WeakMap<World, Map<string, Geometry | undefined>>();

function geometry(
  world: World,
  from: DeepReadonly<City>,
  to: DeepReadonly<City>,
  mode: TradeMode,
): Geometry | undefined {
  let cache = geometries.get(world);
  if (!cache) {
    cache = new Map();
    geometries.set(world, cache);
  }
  const key = JSON.stringify([from.id, from.position, to.id, to.position, mode]);
  if (cache.has(key)) return cache.get(key);
  const start = mode === 'land' ? from.position : world.harbours.get(from.id);
  const end = mode === 'land' ? to.position : world.harbours.get(to.id);
  let found: Geometry | undefined;
  if (start && end && distance(start, end) <= TRADE_RANGE[mode]) {
    const way = findPath(world.mesh, start, end, mode === 'land' ? 'land' : 'sea');
    if (way) {
      const path = [start, ...way];
      const km = path.slice(1).reduce((sum, p, i) => sum + distance(path[i] as MapPoint, p), 0);
      if (km > 0 && km <= TRADE_RANGE[mode])
        found = { path, km, days: Math.ceil(km / TRADE_SPEED[mode]) };
    }
  }
  cache.set(key, found);
  return found;
}

export interface TradeForecast extends Geometry {
  mode: TradeMode;
  daily: number;
  fromDaily: number;
  toDaily: number;
  cost: number;
  paybackDays: number;
  different: boolean;
}

/** A long haul and unlike goods earn more; each end earns, including both ends at home. */
export function tradeForecast(
  state: State,
  world: World,
  from: DeepReadonly<City>,
  to: DeepReadonly<City>,
  mode: TradeMode,
): TradeForecast | undefined {
  const way = geometry(world, from, to, mode);
  if (!way) return undefined;
  const different = state.provinces[from.province]?.good !== state.provinces[to.province]?.good;
  const daily =
    TRADE_BASE * (different ? DIFFERENT_GOODS : 1) * (1 + Math.min(way.km, 1000) / 1000);
  const fromDaily = daily * adminShareOf(state, from.owner);
  const toDaily = daily * adminShareOf(state, to.owner);
  const cost = Math.ceil(
    TRADE_BASE *
      (1 + Math.min(way.km, 1000) / 1000) *
      TRADE_PAYBACK_DAYS *
      (from.owner === to.owner ? 2 : 1),
  );
  return {
    ...way,
    mode,
    daily,
    fromDaily,
    toDaily,
    cost,
    paybackDays: cost / (fromDaily + (from.owner === to.owner ? toDaily : 0)),
    different,
  };
}

export function cityTradeProblem(state: State, city: DeepReadonly<City>): string | undefined {
  if (city.unrestDays > 0) return `${city.name} is in unrest`;
  if (Object.values(state.sieges).some((s) => s.city === city.id))
    return `${city.name} is besieged`;
  return undefined;
}

/** Consent is the same profitable, peaceful, free-slot rule for every AI and minor. */
export function tradeConsent(
  state: State,
  world: World,
  from: DeepReadonly<City>,
  to: DeepReadonly<City>,
): string | undefined {
  if (areAtWar(state, from.owner, to.owner)) return 'the two ends are at war';
  const problem = cityTradeProblem(state, to);
  if (problem) return problem;
  if (freeSlots(state, to, world) <= 0) return `${to.name} has no free route slot`;
  return undefined;
}

export function tradeProblem(
  state: State,
  world: World,
  faction: FactionId,
  from: CityId,
  to: CityId,
  mode: TradeMode,
  requireGold = true,
): string | undefined {
  const a = state.cities[from];
  const b = state.cities[to];
  if (!a || !b) return 'a trade city does not exist';
  if (a.owner !== faction) return 'the starting city is not yours';
  if (from === to) return 'a route needs two different cities';
  const problem = cityTradeProblem(state, a) ?? tradeConsent(state, world, a, b);
  if (problem) return problem;
  if (freeSlots(state, a, world) <= 0) return `${a.name} has no free route slot`;
  if (
    Object.values(state.tradeRoutes).some(
      (r) =>
        r.status === 'running' &&
        ((r.from === from && r.to === to) || (r.from === to && r.to === from)),
    )
  )
    return 'these cities already trade';
  const forecast = tradeForecast(state, world, a, b, mode);
  if (!forecast) return `no ${mode} trade path within ${TRADE_RANGE[mode]} km joins these cities`;
  if (requireGold && (state.factions[faction]?.stores.gold ?? 0) < forecast.cost)
    return `opening this route needs ${forecast.cost} gold`;
  return undefined;
}

/** Expected income, not a daily payment: the caravan system alone pays arrivals. */
export function tradeIncome(state: State): Map<FactionId, number> {
  const income = new Map<FactionId, number>();
  const shares = adminShares(state);
  for (const route of Object.values(state.tradeRoutes)) {
    if (
      route.status !== 'running' ||
      route.blocked !== null ||
      areAtWar(state, route.owner, route.partner)
    )
      continue;
    for (const owner of [route.owner, route.partner]) {
      const share = shares.get(owner) ?? 1;
      income.set(owner, (income.get(owner) ?? 0) + route.daily * share);
    }
  }
  return income;
}

export function routePoint(route: DeepReadonly<TradeRoute>, progress = route.progress): MapPoint {
  const path = route.returning ? [...route.path].reverse() : route.path;
  let left = progress * route.km;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as MapPoint;
    const b = path[i] as MapPoint;
    const length = distance(a, b);
    if (left <= length) {
      const t = length === 0 ? 0 : left / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= length;
  }
  return { ...(path.at(-1) as MapPoint) };
}

export function distanceToRoute(point: MapPoint, route: DeepReadonly<TradeRoute>): number {
  let best = Infinity;
  for (let i = 1; i < route.path.length; i++) {
    const a = route.path[i - 1] as MapPoint;
    const b = route.path[i] as MapPoint;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    );
    best = Math.min(best, distance(point, { x: a.x + t * dx, y: a.y + t * dy }));
  }
  return best;
}
