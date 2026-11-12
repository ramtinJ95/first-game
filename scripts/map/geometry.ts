import polygonClipping from 'polygon-clipping';
import type { MapLine, MultiPolygon, Point, Polygon, Ring } from '../../src/sim/map.ts';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boxOf(polygons: MultiPolygon): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [outer = []] of polygons) {
    for (const [x, y] of outer) {
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }
  }
  return box;
}

function boxContains(box: Box, [x, y]: Point): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function boxDistance(a: Box, b: Box): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

/** Shoelace area, positive for a counter-clockwise ring in a y-up frame. */
function ringArea(ring: Ring): number {
  let sum = 0;
  let [px, py] = ring[ring.length - 1] ?? [0, 0];
  for (const [x, y] of ring) {
    sum += px * y - x * py;
    px = x;
    py = y;
  }
  return sum / 2;
}

export function area(polygons: MultiPolygon): number {
  let total = 0;
  for (const [outer = [], ...holes] of polygons) {
    total += Math.abs(ringArea(outer));
    for (const hole of holes) total -= Math.abs(ringArea(hole));
  }
  return total;
}

function ringContains(ring: Ring, [x, y]: Point): boolean {
  let inside = false;
  let [px, py] = ring[ring.length - 1] ?? [0, 0];
  for (const [cx, cy] of ring) {
    if (cy > y !== py > y && x < ((px - cx) * (y - cy)) / (py - cy) + cx) inside = !inside;
    px = cx;
    py = cy;
  }
  return inside;
}

export function polygonContains(polygon: Polygon, point: Point): boolean {
  let inside = false;
  for (const ring of polygon) if (ringContains(ring, point)) inside = !inside;
  return inside;
}

export function contains(polygons: MultiPolygon, point: Point): boolean {
  return polygons.some((polygon) => polygonContains(polygon, point));
}

export function locator<K>(
  regions: { key: K; polygons: MultiPolygon }[],
): (p: Point) => K | undefined {
  const entries = regions.flatMap(({ key, polygons }) =>
    polygons.map((polygon) => ({ key, polygon, box: boxOf([polygon]) })),
  );
  return (point) =>
    entries.find(({ polygon, box }) => boxContains(box, point) && polygonContains(polygon, point))
      ?.key;
}

export interface BoundarySample {
  mid: Point;
  outside: Point;
  length: number;
}

export function* boundarySamples(
  polygons: MultiPolygon,
  offset: number,
): Generator<BoundarySample> {
  for (const polygon of polygons) {
    for (const [index, ring] of polygon.entries()) {
      const interiorOnLeft = (index === 0) === ringArea(ring) > 0;
      let [ax, ay] = ring[ring.length - 1] ?? [0, 0];
      for (const [bx, by] of ring) {
        const length = Math.hypot(bx - ax, by - ay);
        if (length > 0) {
          const side = interiorOnLeft ? offset / length : -offset / length;
          const mid: Point = [(ax + bx) / 2, (ay + by) / 2];
          yield { mid, outside: [mid[0] + (by - ay) * side, mid[1] - (bx - ax) * side], length };
        }
        ax = bx;
        ay = by;
      }
    }
  }
}

function closestOnSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): Point {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return [ax + t * dx, ay + t * dy];
}

export function distance([ax, ay]: Point, [bx, by]: Point): number {
  return Math.hypot(bx - ax, by - ay);
}

function* edges(polygons: MultiPolygon): Generator<[Point, Point]> {
  for (const polygon of polygons) {
    for (const ring of polygon) {
      let a = ring[ring.length - 1];
      for (const b of ring) {
        if (a) yield [a, b];
        a = b;
      }
    }
  }
}

export function closestOnBoundary(polygons: MultiPolygon, point: Point): Point | undefined {
  let best: Point | undefined;
  let bestDistance = Infinity;
  for (const [a, b] of edges(polygons)) {
    const candidate = closestOnSegment(point, a, b);
    const d = distance(point, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

export function distanceToBoundary(polygons: MultiPolygon, point: Point): number {
  const closest = closestOnBoundary(polygons, point);
  return closest ? distance(point, closest) : Infinity;
}

/** Minimum distance between the boundaries of two disjoint areas. */
export function boundaryDistance(a: MultiPolygon, b: MultiPolygon): number {
  let best = Infinity;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const polygon of from) {
      for (const ring of polygon) {
        for (const point of ring) best = Math.min(best, distanceToBoundary(to, point));
      }
    }
  }
  return best;
}

export function clipLine(line: MapLine, ring: Ring): MapLine[] {
  const parts: MapLine[] = [];
  let current: MapLine = [];
  const inside = (point: Point) => ringContains(ring, point);
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Point;
    const b = line[i + 1] as Point;
    const cuts = [0, ...crossings(a, b, ring), 1].sort((s, t) => s - t);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const s = cuts[k] as number;
      const t = cuts[k + 1] as number;
      if (t - s < 1e-12) continue;
      const from = lerp(a, b, s);
      const to = lerp(a, b, t);
      if (inside(lerp(a, b, (s + t) / 2))) {
        if (current.length === 0) current.push(from);
        current.push(to);
      } else if (current.length > 0) {
        parts.push(current);
        current = [];
      }
    }
  }
  if (current.length > 0) parts.push(current);
  return parts.filter((part) => part.length >= 2);
}

function crossings([ax, ay]: Point, [bx, by]: Point, ring: Ring): number[] {
  const out: number[] = [];
  let [cx, cy] = ring[ring.length - 1] ?? [0, 0];
  for (const [dx, dy] of ring) {
    const denominator = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (denominator !== 0) {
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denominator;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t);
    }
    cx = dx;
    cy = dy;
  }
  return out;
}

function lerp([ax, ay]: Point, [bx, by]: Point, t: number): Point {
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

export function intersection(subject: MultiPolygon, ...clips: MultiPolygon[]): MultiPolygon {
  return openRings(polygonClipping.intersection(subject, ...clips));
}

export function union(...parts: MultiPolygon[]): MultiPolygon {
  const [first = [], ...rest] = parts;
  return openRings(polygonClipping.union(first, ...rest));
}

export function xor(a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  return openRings(polygonClipping.xor(a, b));
}

function openRings(polygons: MultiPolygon): MultiPolygon {
  return polygons.map((polygon) => polygon.map((ring) => ring.slice(0, -1)));
}
