import type { MapPoint } from '../sim/state/map-point.ts';

export interface RouteBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const DASH = 7;
const PERIOD = DASH + 5;

/** Keep phase from the route's start, clipping before dashing when a view is given. */
export function routeDashes(
  points: readonly MapPoint[],
  bounds?: RouteBounds,
): [MapPoint, MapPoint][] {
  const dashes: [MapPoint, MapPoint][] = [];
  let along = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as MapPoint;
    const b = points[i] as MapPoint;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    let enter = 0;
    let leave = 1;
    if (bounds)
      for (const [origin, delta, low, high] of [
        [a.x, dx, bounds.left, bounds.right],
        [a.y, dy, bounds.top, bounds.bottom],
      ] as const) {
        if (delta === 0) {
          if (origin < low || origin > high) leave = -1;
        } else {
          const lo = (low - origin) / delta;
          const hi = (high - origin) / delta;
          enter = Math.max(enter, Math.min(lo, hi));
          leave = Math.min(leave, Math.max(lo, hi));
        }
      }
    const first = along + enter * length;
    const last = along + leave * length;
    for (
      let start = Math.floor(first / PERIOD) * PERIOD;
      enter <= leave && start < last;
      start += PERIOD
    ) {
      const from = Math.max(first, start);
      const to = Math.min(last, start + DASH);
      if (to <= from) continue;
      const point = (distance: number) => ({
        x: a.x + (dx * (distance - along)) / length,
        y: a.y + (dy * (distance - along)) / length,
      });
      dashes.push([point(from), point(to)]);
    }
    along += length;
  }
  return dashes;
}

/** Conservative ink bounds, including the round halo and antialiasing fringe. */
export function routeInkBounds(
  paths: readonly (readonly MapPoint[])[],
  bounds: RouteBounds,
): RouteBounds | undefined {
  const pad = 4;
  const clip = {
    left: bounds.left - pad,
    top: bounds.top - pad,
    right: bounds.right + pad,
    bottom: bounds.bottom + pad,
  };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const path of paths)
    for (const dash of routeDashes(path, clip))
      for (const point of dash) {
        left = Math.min(left, point.x - pad);
        top = Math.min(top, point.y - pad);
        right = Math.max(right, point.x + pad);
        bottom = Math.max(bottom, point.y + pad);
      }
  left = Math.max(bounds.left, Math.floor(left));
  top = Math.max(bounds.top, Math.floor(top));
  right = Math.min(bounds.right, Math.ceil(right));
  bottom = Math.min(bounds.bottom, Math.ceil(bottom));
  return right > left && bottom > top ? { left, top, right, bottom } : undefined;
}
