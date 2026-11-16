import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import type { TradeRoute } from '../sim/state/trade-route.ts';
import { routePoint } from '../sim/trade/routes.ts';
import type { Sprite } from './armies/scene.ts';
import { placeLabels, type Box, type LabelRequest } from './labels.ts';

/**
 * One merchant every this many km of a route's round trip, half on the way out and half
 * on the way back, so a road or a lane in view carries one. A route drew one merchant,
 * and at the closest zoom Rome's 971 km road to Mogontiacum showed it a few days in 120.
 */
export const MERCHANT_SPACING_KM = 200;

export interface MerchantPose {
  readonly point: MapPoint;
  readonly heading: MapPoint;
}

/** How far round its trip a route's crossing is: 0 to 1 on the way out, 1 to 2 back. */
const trip = (route: DeepReadonly<TradeRoute>) => (route.returning ? 1 : 0) + route.progress;

function poseAt(route: DeepReadonly<TradeRoute>, round: number): MerchantPose {
  const leg = { ...route, returning: round > 1 };
  const along = leg.returning ? round - 1 : round;
  const point = routePoint(leg, along);
  const behind = routePoint(leg, Math.max(0, along - 0.001));
  const ahead = routePoint(leg, Math.min(1, along + 0.001));
  const dx = ahead.x - behind.x;
  const dy = ahead.y - behind.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  return { point, heading: { x: dx / length, y: dy / length } };
}

/**
 * The merchants of a running route, the first at its crossing. A merchant moves on
 * through the day; an arrival turns it round where it stands, and a raid, which sends
 * the crossing back to its start, moves it there at once. While a raided route waits for
 * its replacement, the one merchant stands at the start.
 */
export function merchantPoses(
  before: DeepReadonly<TradeRoute> | undefined,
  route: DeepReadonly<TradeRoute>,
  progress: number,
  day: number,
): MerchantPose[] {
  if (route.status !== 'running' || route.blocked) return [];
  const now = trip(route);
  const was = before ? trip(before) : now;
  const step = (now - was + 2) % 2;
  const at = step <= 0.5 ? was + step * progress : now;
  const count =
    day < route.departsOn ? 1 : Math.max(1, Math.round((2 * route.km) / MERCHANT_SPACING_KM));
  return Array.from({ length: count }, (_, k) => poseAt(route, (at + (2 * k) / count) % 2));
}

export const GOOD_LABEL_SCALE = 0.9;
export function tradeCityLabel(
  game: DeepReadonly<GameState>,
  city: DeepReadonly<City>,
  scale: number,
): string {
  const name = city.rank === 'capital' ? city.name.toUpperCase() : city.name;
  const good = game.provinces[city.province]?.good;
  return scale >= GOOD_LABEL_SCALE && good ? `${name} · ${good}` : name;
}

/**
 * A merchant that does not fit where its route puts it looks for ground round that
 * spot; a refugee column, the anchor for other carts and walkers, can be far away.
 */
export function anchorOutsideTrade(
  anchor: (sprite: Sprite) => MapPoint | undefined,
): (sprite: Sprite) => MapPoint | undefined {
  return (sprite) => (sprite.trade ? undefined : anchor(sprite));
}

/**
 * Places city names, each with its province's good where that fits. A name that finds
 * no spot with its good is placed again by its plain name, which is shorter, so a good
 * never costs a city the name that main would show.
 */
export function placeNamesWithGoods(
  requests: readonly (LabelRequest & { readonly plainWidth?: number })[],
  markers: readonly Box[],
  viewport: { readonly width: number; readonly height: number },
  land?: (point: MapPoint) => boolean,
): { placed: Map<string, Box>; plain: Set<string> } {
  const placed = placeLabels(requests, markers, viewport, land);
  const plain = new Set(
    requests
      .filter(
        ({ id, width, plainWidth }) =>
          !placed.has(id) && plainWidth !== undefined && plainWidth < width,
      )
      .map(({ id }) => id),
  );
  if (plain.size === 0) return { placed, plain };
  const shorter = requests.map((request) =>
    plain.has(request.id) ? { ...request, width: request.plainWidth ?? request.width } : request,
  );
  return { placed: placeLabels(shorter, markers, viewport, land), plain };
}
