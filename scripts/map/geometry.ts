import polygonClipping from 'polygon-clipping';
import type { MapLine, MultiPolygon, Point, Polygon, Ring } from '../../src/sim/map.ts';
import { round } from './projection.ts';

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

export function perimeter(polygons: MultiPolygon): number {
  let total = 0;
  for (const [a, b] of edges(polygons)) total += distance(a, b);
  return total;
}

/** Douglas–Peucker on each ring. A ring left with fewer than three points is dropped. */
export function simplify(polygons: MultiPolygon, tolerance: number): MultiPolygon {
  return polygons.flatMap(([outer = [], ...holes]) => {
    const [kept] = simplifyRing(outer, tolerance) ?? [];
    if (!kept) return [];
    return [[kept, ...holes.flatMap((hole) => simplifyRing(hole, tolerance) ?? [])]];
  });
}

function simplifyRing(closed: Ring, tolerance: number): [Ring] | undefined {
  const ring = comparePoints(closed[0], closed[closed.length - 1]) ? closed : closed.slice(0, -1);
  const n = ring.length;
  const first = ring[0];
  if (n < 3 || !first) return undefined;
  let far = 0;
  for (let i = 1; i < n; i++) {
    if (distance(first, ring[i] as Point) > distance(first, ring[far] as Point)) far = i;
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const spans: [number, number][] = [
    [0, far],
    [far, n],
  ];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [from, to] = span;
    const a = ring[from] as Point;
    const b = ring[to % n] as Point;
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = from + 1; i < to; i++) {
      const point = ring[i] as Point;
      const d = distance(point, closestOnSegment(point, a, b));
      if (d > worstDistance) {
        worst = i;
        worstDistance = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      spans.push([from, worst], [worst, to]);
    }
  }
  const out = ring.filter((_, i) => keep[i] === 1);
  return out.length >= 3 ? [out] : undefined;
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function comparePoints(a: Point | undefined, b: Point | undefined): number {
  if (!a || !b) return a ? 1 : b ? -1 : 0;
  return a[0] - b[0] || a[1] - b[1];
}

export function roundPoint([x, y]: Point): Point {
  return [round(x), round(y)];
}

function roundPoints(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const rounded = roundPoint(point);
    if (comparePoints(out[out.length - 1], rounded) !== 0) out.push(rounded);
  }
  return out;
}

export function roundLine(line: MapLine): MapLine[] {
  const out = roundPoints(line);
  return out.length >= 2 ? [out] : [];
}

export function roundRing(ring: Ring): Ring[] {
  const out = roundPoints(ring);
  while (out.length > 1 && comparePoints(out[0], out[out.length - 1]) === 0) out.pop();
  return out.length >= 3 ? [out] : [];
}

export function roundOutline(polygons: MultiPolygon): MultiPolygon {
  return polygons.flatMap(([outer = [], ...holes]) => {
    const [rounded] = roundRing(outer);
    return rounded ? [[rounded, ...holes.flatMap(roundRing)]] : [];
  });
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

export function difference(subject: MultiPolygon, ...clips: MultiPolygon[]): MultiPolygon {
  return openRings(polygonClipping.difference(subject, ...clips));
}

function openRings(polygons: MultiPolygon): MultiPolygon {
  return polygons.map((polygon) => polygon.map((ring) => ring.slice(0, -1)));
}

export interface BorderLengths {
  /** Per region, the length of boundary it shares with each other region, by index. */
  shared: Map<number, number>[];
  /** Per region, the length of boundary that lies on no other region and not on `edge`. */
  open: number[];
}

interface Segment {
  a: Point;
  b: Point;
  box: Box;
}

const EDGE_KEY = -1;

/**
 * Measures where boundaries coincide, within `tolerance`, edge interval by edge interval. A region
 * touching another along part of an edge is credited only that part.
 */
export function borderLengths(
  regions: MultiPolygon[],
  edge: Ring | undefined,
  tolerance: number,
): BorderLengths {
  const segments = regions.map((polygons) => segmentsOf(polygons));
  const boxes = regions.map((polygons) => grow(boxOf(polygons), tolerance));
  const edgeSegments = edge ? segmentsOf([[edge]]) : [];
  const shared = regions.map(() => new Map<number, number>());
  const open = regions.map((_, key) => {
    const others: [number, Segment[]][] = segments.flatMap((list, other): [number, Segment[]][] => {
      const box = boxes[key];
      const otherBox = boxes[other];
      return other !== key && box && otherBox && boxesOverlap(box, otherBox) ? [[other, list]] : [];
    });
    others.push([EDGE_KEY, edgeSegments]);
    let uncovered = 0;
    for (const segment of segments[key] ?? []) {
      const length = distance(segment.a, segment.b);
      if (length === 0) continue;
      const covered: [number, number][] = [];
      for (const [other, list] of others) {
        for (const candidate of list) {
          if (!boxesOverlap(grow(segment.box, tolerance), candidate.box)) continue;
          const overlap = coincidence(segment, candidate, tolerance);
          if (!overlap) continue;
          covered.push(overlap);
          if (other !== EDGE_KEY) {
            const across = shared[key] as Map<number, number>;
            across.set(other, (across.get(other) ?? 0) + (overlap[1] - overlap[0]) * length);
          }
        }
      }
      uncovered += (1 - measure(covered)) * length;
    }
    return uncovered;
  });
  return { shared, open };
}

function segmentsOf(polygons: MultiPolygon): Segment[] {
  return [...edges(polygons)].map(([a, b]) => ({
    a,
    b,
    box: {
      minX: Math.min(a[0], b[0]),
      minY: Math.min(a[1], b[1]),
      maxX: Math.max(a[0], b[0]),
      maxY: Math.max(a[1], b[1]),
    },
  }));
}

function grow({ minX, minY, maxX, maxY }: Box, by: number): Box {
  return { minX: minX - by, minY: minY - by, maxX: maxX + by, maxY: maxY + by };
}

/** The parameter interval of `segment` that `other` lies along, if `other` runs within `tolerance` of it. */
function coincidence(
  segment: Segment,
  other: Segment,
  tolerance: number,
): [number, number] | undefined {
  const [ax, ay] = segment.a;
  const dx = segment.b[0] - ax;
  const dy = segment.b[1] - ay;
  const lengthSquared = dx * dx + dy * dy;
  const length = Math.sqrt(lengthSquared);
  const offLine = ([px, py]: Point) => Math.abs((px - ax) * dy - (py - ay) * dx) / length;
  if (offLine(other.a) > tolerance || offLine(other.b) > tolerance) return undefined;
  const along = ([px, py]: Point) => ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  const ta = along(other.a);
  const tb = along(other.b);
  const start = Math.max(0, Math.min(ta, tb));
  const end = Math.min(1, Math.max(ta, tb));
  return end > start ? [start, end] : undefined;
}

/** Total length of the union of intervals inside [0, 1]. */
function measure(intervals: [number, number][]): number {
  let total = 0;
  let reach = 0;
  for (const [start, end] of intervals.sort((p, q) => p[0] - q[0] || p[1] - q[1])) {
    if (end <= reach) continue;
    total += end - Math.max(start, reach);
    reach = end;
  }
  return total;
}
