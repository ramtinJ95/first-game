import type { MapPoint } from '../../sim/state/map-point.ts';

/** Points in km from the back of a march to its head. */
export type Trail = readonly MapPoint[];

export interface OnTrail {
  readonly point: MapPoint;
  /** A unit vector along the trail towards its head. */
  readonly heading: MapPoint;
}

const length = (a: MapPoint, b: MapPoint) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * The path walked between the two days: from where the mover stood, along the path it
 * had ahead, to where it stands now. Movement follows that path, so the result passes
 * through every corner the mover turned during the day.
 */
export function dayPath(from: MapPoint, ahead: readonly MapPoint[], to: MapPoint): MapPoint[] {
  const path = [from];
  let best = { index: 0, gap: length(from, to) };
  let previous = from;
  for (const [i, point] of ahead.entries()) {
    const gap = segmentGap(previous, point, to);
    if (gap < best.gap - 1e-9) best = { index: i + 1, gap };
    previous = point;
  }
  for (let i = 0; i < best.index - 1; i++) path.push(ahead[i] as MapPoint);
  path.push(to);
  return path;
}

function segmentGap(a: MapPoint, b: MapPoint, p: MapPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / span));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

export function trailLength(trail: Trail): number {
  let total = 0;
  for (let i = 1; i < trail.length; i++)
    total += length(trail[i - 1] as MapPoint, trail[i] as MapPoint);
  return total;
}

/**
 * The point `distance` km from the back of the trail, and the way the trail runs there.
 * Before the back the trail runs straight on behind it, and past the head straight on ahead.
 */
export function alongTrail(
  trail: Trail,
  distance: number,
  fallback: MapPoint = { x: 1, y: 0 },
): OnTrail {
  const first = trail[0] ?? { x: 0, y: 0 };
  let segments = 0;
  let walked = 0;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1] as MapPoint;
    const b = trail[i] as MapPoint;
    const span = length(a, b);
    if (span < 1e-9) continue;
    const heading = { x: (b.x - a.x) / span, y: (b.y - a.y) / span };
    const last = i === trail.length - 1;
    if (segments === 0 && distance < 0) {
      return { point: { x: a.x + heading.x * distance, y: a.y + heading.y * distance }, heading };
    }
    segments++;
    if (distance <= walked + span || last) {
      const t = distance - walked;
      return { point: { x: a.x + heading.x * t, y: a.y + heading.y * t }, heading };
    }
    walked += span;
  }
  return {
    point: { x: first.x + fallback.x * distance, y: first.y + fallback.y * distance },
    heading: fallback,
  };
}
