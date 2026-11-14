import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { TradeRoute } from '../sim/state/trade-route.ts';
import { routePoint } from '../sim/trade/routes.ts';

/** An arrival changes direction, not position: interpolate to the old crossing's end. */
export function tradePose(
  before: DeepReadonly<TradeRoute> | undefined,
  route: DeepReadonly<TradeRoute>,
  progress: number,
) {
  if (route.status !== 'running' || route.blocked) return undefined;
  const crossing = before && before.returning !== route.returning ? before : route;
  const from = before?.progress ?? route.progress;
  const to = before && before.returning !== route.returning ? 1 : route.progress;
  const at = from + (to - from) * progress;
  const point = routePoint(crossing, at);
  const behind = routePoint(crossing, Math.max(0, at - 0.001));
  const ahead = routePoint(crossing, Math.min(1, at + 0.001));
  const dx = ahead.x - behind.x;
  const dy = ahead.y - behind.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  return { point, heading: { x: dx / length, y: dy / length } };
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
