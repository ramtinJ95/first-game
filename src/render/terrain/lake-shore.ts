import type { MultiPolygon, Point, Ring } from '../../sim/map.ts';
import { hash01 } from './random.ts';

/** Sub-km drawing detail, not a change to a lake's geographic control points. */
export const LAKE_SHORE = { step: 0.65, handle: 0.45, ripple: 0.22, wavelength: 2.8 } as const;

function smooth(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

function distance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

interface Edge {
  ring: Ring;
  index: number;
  a: Point;
  b: Point;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function shore(ring: Ring, edges: readonly Edge[]): Point[] {
  return ring.flatMap((a, i) => {
    const previous = ring[(i + ring.length - 1) % ring.length] as Point;
    const b = ring[(i + 1) % ring.length] as Point;
    const next = ring[(i + 2) % ring.length] as Point;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) return [];
    // Cap displacement from each sample's base at 0.72 km, tighter near other shores.
    // An edge over 3 km away cannot tighten that quarter-clearance limit. Cull those
    // once per source edge instead of measuring every edge against every sample.
    const reach = 3;
    const nearby = edges.filter(
      (edge) =>
        !(
          edge.ring === ring &&
          [i, (i + 1) % ring.length, (i + ring.length - 1) % ring.length].includes(edge.index)
        ) &&
        edge.left <= Math.max(a[0], b[0]) + reach &&
        edge.right >= Math.min(a[0], b[0]) - reach &&
        edge.top <= Math.max(a[1], b[1]) + reach &&
        edge.bottom >= Math.min(a[1], b[1]) - reach,
    );
    const handle = (from: Point, via: Point, to: Point): Point => {
      const dx = to[0] - from[0],
        dy = to[1] - from[1];
      const size = Math.min(
        LAKE_SHORE.handle,
        Math.hypot(via[0] - from[0], via[1] - from[1]) / 3,
        Math.hypot(to[0] - via[0], to[1] - via[1]) / 3,
      );
      const d = Math.hypot(dx, dy) || 1;
      return [(dx / d) * size, (dy / d) * size];
    };
    const ta = handle(previous, a, b),
      tb = handle(a, b, next);
    const phase = hash01(Math.round((a[0] + b[0]) * 10), Math.round((a[1] + b[1]) * 10), 1321);
    const side = phase < 0.5 ? -1 : 1;
    const steps = Math.ceil((length + 2 * LAKE_SHORE.handle) / LAKE_SHORE.step);
    const baseAt = (n: number): Point => [
      a[0] + ((b[0] - a[0]) * n) / steps,
      a[1] + ((b[1] - a[1]) * n) / steps,
    ];
    // Clearance is measured over each entire chord, not just its sampled ends.
    // Both ends keep to a quarter of its gap to any other shore, including islands.
    // A tiny inlet near one end does not flatten an otherwise broad 15 km shore.
    const clearances = Array.from({ length: steps }, (_, n) => {
      const from = baseAt(n),
        to = baseAt(n + 1);
      let gap = reach;
      for (const edge of nearby) {
        if (
          edge.left > Math.max(from[0], to[0]) + gap ||
          edge.right < Math.min(from[0], to[0]) - gap ||
          edge.top > Math.max(from[1], to[1]) + gap ||
          edge.bottom < Math.min(from[1], to[1]) - gap
        )
          continue;
        gap = Math.min(
          gap,
          distance(from, edge.a, edge.b),
          distance(to, edge.a, edge.b),
          distance(edge.a, from, to),
          distance(edge.b, from, to),
        );
      }
      return gap;
    });
    return Array.from({ length: steps }, (_, n): Point => {
      if (n === 0) return a;
      const t = n / steps,
        u = 1 - t;
      // Cubic tangents and the ripple start smoothly. Tight inlets deliberately limit
      // that drawing before it can cross another shore: geography wins there.
      const fade = smooth((t * length) / 0.7) * smooth((u * length) / 0.7);
      const ripple =
        side *
        LAKE_SHORE.ripple *
        fade *
        (0.65 + 0.35 * Math.sin(2 * Math.PI * ((t * length) / LAKE_SHORE.wavelength + phase)));
      const candidate: Point = [
        u ** 3 * a[0] +
          3 * u * u * t * (a[0] + ta[0]) +
          3 * u * t * t * (b[0] - tb[0]) +
          t ** 3 * b[0] -
          ((b[1] - a[1]) / length) * ripple,
        u ** 3 * a[1] +
          3 * u * u * t * (a[1] + ta[1]) +
          3 * u * t * t * (b[1] - tb[1]) +
          t ** 3 * b[1] +
          ((b[0] - a[0]) / length) * ripple,
      ];
      const base = baseAt(n);
      const dx = candidate[0] - base[0],
        dy = candidate[1] - base[1];
      const limit =
        0.24 *
        Math.min(
          clearances[n - 1] as number,
          clearances[n] as number,
          distance(base, previous, a),
          distance(base, b, next),
        );
      const share = Math.min(1, limit / (Math.hypot(dx, dy) || 1));
      return [base[0] + dx * share, base[1] + dy * share];
    });
  });
}

/** Every lake, island and inlet uses one shore for its fill, mask, ink and water lines. */
export function naturalLakeOutline(outline: MultiPolygon): MultiPolygon {
  const edges = outline.flat().flatMap((ring) =>
    ring.map((a, index): Edge => ({
      ring,
      index,
      a,
      b: ring[(index + 1) % ring.length] as Point,
      left: Math.min(a[0], (ring[(index + 1) % ring.length] as Point)[0]),
      right: Math.max(a[0], (ring[(index + 1) % ring.length] as Point)[0]),
      top: Math.min(a[1], (ring[(index + 1) % ring.length] as Point)[1]),
      bottom: Math.max(a[1], (ring[(index + 1) % ring.length] as Point)[1]),
    })),
  );
  return outline.map((polygon) => polygon.map((ring) => shore(ring, edges)));
}
