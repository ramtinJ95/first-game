import type { GameMap, Point, Ring } from '../map.ts';
import { triangulate } from './triangulate.ts';

/** The map stores coordinates rounded to 0.1 km, so ten lattice steps make a kilometre. */
export const LATTICE_PER_KM = 10;

export const SURFACES = ['offMap', 'land', 'sea'] as const;
export type Surface = (typeof SURFACES)[number];
const SURFACE_CODE: Record<Surface, number> = { offMap: 0, land: 1, sea: 2 };

/** Interior points this far apart, or none at 0. The experiment shows they only lengthen paths. */
export const DEFAULT_STEINER_SPACING_KM = 0;

/**
 * The extent triangulated with the coastline and the map edge as walls. Every
 * triangle lies wholly on land, wholly at sea, or wholly off the map, and a path
 * that crosses only open edges stays on one surface.
 */
export interface NavMesh {
  /** x, y in km per vertex. */
  points: Float64Array;
  /** Three vertex indices per triangle, anticlockwise in map coordinates. */
  triangles: Int32Array;
  /** The opposite half-edge of each half-edge, or -1 at the frame. */
  halfedges: Int32Array;
  /** 1 where a half-edge is coastline or map edge. */
  walls: Uint8Array;
  /** The surface code per triangle: 0 off the map, 1 land, 2 sea. */
  surface: Uint8Array;
  /** Triangles that reach each other across open edges share a component. */
  component: Int32Array;
  index: TriangleIndex;
}

/** A uniform grid of buckets over the map, each listing the triangles that overlap it. */
export interface TriangleIndex {
  cellKm: number;
  columns: number;
  rows: number;
  start: Int32Array;
  items: Int32Array;
}

export function surfaceCode(surface: Surface): number {
  return SURFACE_CODE[surface];
}

export function buildNavMesh(map: GameMap, steinerSpacingKm = DEFAULT_STEINER_SPACING_KM): NavMesh {
  const { extent, coastline } = closeCoastline(map);
  const points: [number, number][] = [];
  const ids = new Map<string, number>();
  const idOf = ([x, y]: readonly [number, number]): number => {
    const key = `${x},${y}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = points.length;
      ids.set(key, id);
      points.push([x, y]);
    }
    return id;
  };
  const segments: [number, number][] = [];
  const addLine = (line: readonly (readonly [number, number])[], closed: boolean) => {
    const count = closed ? line.length : line.length - 1;
    for (let i = 0; i < count; i += 1) {
      const a = idOf(line[i] as [number, number]);
      const b = idOf(line[(i + 1) % line.length] as [number, number]);
      if (a !== b) segments.push([a, b]);
    }
  };
  addLine(extent, true);
  for (const line of coastline) addLine(line, false);

  if (steinerSpacingKm > 0) {
    const step = Math.round(steinerSpacingKm * LATTICE_PER_KM);
    const width = Math.round(map.width * LATTICE_PER_KM);
    const height = Math.round(map.height * LATTICE_PER_KM);
    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) {
        idOf([Math.round(x), Math.round(y)]);
      }
    }
  }

  const triangulation = triangulate(points, segments);
  const { coords, triangles, halfedges, constrained } = triangulation;
  const vertexCount = coords.length / 2;
  const km = new Float64Array(coords.length);
  for (let i = 0; i < coords.length; i += 1) km[i] = (coords[i] as number) / LATTICE_PER_KM;

  const triangleCount = triangles.length / 3;
  const component = new Int32Array(triangleCount).fill(-1);
  const surface = new Uint8Array(triangleCount);
  const frame = vertexCount - 4;
  let components = 0;
  for (let seed = 0; seed < triangleCount; seed += 1) {
    if ((component[seed] as number) >= 0) continue;
    const id = components;
    components += 1;
    const members = [seed];
    component[seed] = id;
    let touchesFrame = false;
    let largest = seed;
    let largestArea = -1;
    for (let i = 0; i < members.length; i += 1) {
      const t = members[i] as number;
      for (let k = 0; k < 3; k += 1) {
        const e = 3 * t + k;
        if ((triangles[e] as number) >= frame) touchesFrame = true;
        const twin = halfedges[e] as number;
        if (twin < 0 || constrained[e]) continue;
        const u = Math.floor(twin / 3);
        if ((component[u] as number) < 0) {
          component[u] = id;
          members.push(u);
        }
      }
      const area = triangleArea(km, triangles, t);
      if (area > largestArea) {
        largestArea = area;
        largest = t;
      }
    }
    let code = SURFACE_CODE.offMap;
    if (!touchesFrame) {
      code = onProvince(map, centroid(km, triangles, largest))
        ? SURFACE_CODE.land
        : SURFACE_CODE.sea;
    }
    for (const t of members) surface[t] = code;
  }

  return {
    points: km,
    triangles,
    halfedges,
    walls: constrained,
    surface,
    component,
    index: indexTriangles(map, km, triangles, surface),
  };
}

/**
 * The map writes the coastline clipped to the extent and rounded, so the ends of an
 * open coast line sit just inside or just outside the map edge. Each end is joined to
 * the edge at the lattice point nearest the true meeting point, so the coast and the
 * edge together close every land and sea region.
 */
function closeCoastline(map: GameMap): {
  extent: [number, number][];
  coastline: [number, number][][];
} {
  const lattice = ([x, y]: Point): [number, number] => [
    Math.round(x * LATTICE_PER_KM),
    Math.round(y * LATTICE_PER_KM),
  ];
  const extent = map.extent.map(lattice);
  const joins: { segment: number; along: number; at: [number, number] }[] = [];
  const coastline: [number, number][][] = [];
  for (const line of map.coastline) {
    let points = line.map(lattice);
    const first = points[0] as [number, number];
    const last = points[points.length - 1] as [number, number];
    if (first[0] === last[0] && first[1] === last[1]) {
      coastline.push(points);
      continue;
    }
    points = joinEnd(points, extent, joins);
    points = joinEnd(points.reverse(), extent, joins).reverse();
    coastline.push(points);
  }
  const bySegment = new Map<number, { along: number; at: [number, number] }[]>();
  for (const join of joins) {
    const list = bySegment.get(join.segment) ?? [];
    list.push(join);
    bySegment.set(join.segment, list);
  }
  const closed: [number, number][] = [];
  for (const [i, point] of extent.entries()) {
    closed.push(point);
    const list = (bySegment.get(i) ?? []).sort((a, b) => a.along - b.along);
    for (const { at } of list) {
      const previous = closed[closed.length - 1] as [number, number];
      const following = extent[(i + 1) % extent.length] as [number, number];
      if (samePoint(previous, at) || samePoint(following, at)) continue;
      closed.push(at);
    }
  }
  return { extent: closed, coastline };
}

/** Lattice steps between an open coast end and the map edge that rounding can explain. */
const MAX_COAST_GAP = 5;

/** Ends the line at the map edge: cut where it crosses the edge, or extend it to the edge. */
function joinEnd(
  points: [number, number][],
  extent: [number, number][],
  joins: { segment: number; along: number; at: [number, number] }[],
): [number, number][] {
  {
    const k = points.length - 1;
    const a = points[k - 1] as [number, number];
    const b = points[k] as [number, number];
    for (let i = 0; i < extent.length; i += 1) {
      const p = extent[i] as [number, number];
      const q = extent[(i + 1) % extent.length] as [number, number];
      const hit = segmentIntersection(a, b, p, q);
      if (hit === undefined) continue;
      const at: [number, number] = [
        Math.round(p[0] + (q[0] - p[0]) * hit),
        Math.round(p[1] + (q[1] - p[1]) * hit),
      ];
      joins.push({ segment: i, along: hit, at });
      const kept = points.slice(0, k);
      if (!samePoint(kept[kept.length - 1] as [number, number], at)) kept.push(at);
      return kept;
    }
  }
  const end = points[points.length - 1] as [number, number];
  let best = { segment: 0, along: 0, distance: Number.POSITIVE_INFINITY };
  for (let i = 0; i < extent.length; i += 1) {
    const p = extent[i] as [number, number];
    const q = extent[(i + 1) % extent.length] as [number, number];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const along = Math.min(
      1,
      Math.max(0, ((end[0] - p[0]) * dx + (end[1] - p[1]) * dy) / (dx * dx + dy * dy)),
    );
    const distance = Math.hypot(p[0] + dx * along - end[0], p[1] + dy * along - end[1]);
    if (distance < best.distance) best = { segment: i, along, distance };
  }
  if (best.distance > MAX_COAST_GAP) {
    throw new Error(`a coast line ends ${best.distance / LATTICE_PER_KM} km from the map edge`);
  }
  const p = extent[best.segment] as [number, number];
  const q = extent[(best.segment + 1) % extent.length] as [number, number];
  const at: [number, number] = [
    Math.round(p[0] + (q[0] - p[0]) * best.along),
    Math.round(p[1] + (q[1] - p[1]) * best.along),
  ];
  joins.push({ segment: best.segment, along: best.along, at });
  if (!samePoint(end, at)) points.push(at);
  return points;
}

/** Where segment ab meets segment pq, as a fraction along pq, if they meet. */
function segmentIntersection(
  a: [number, number],
  b: [number, number],
  p: [number, number],
  q: [number, number],
): number | undefined {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = q[0] - p[0];
  const sy = q[1] - p[1];
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return undefined;
  const t = ((p[0] - a[0]) * sy - (p[1] - a[1]) * sx) / denominator;
  const u = ((p[0] - a[0]) * ry - (p[1] - a[1]) * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return u;
}

function samePoint(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function ringContains(
  ring: readonly (readonly [number, number])[] | Ring,
  [x, y]: readonly [number, number],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as readonly [number, number];
    const [xj, yj] = ring[j] as readonly [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function onProvince(map: GameMap, point: [number, number]): boolean {
  return map.provinces.some((province) =>
    province.outline.some(
      ([outer, ...holes]) =>
        ringContains(outer as Ring, point) && !holes.some((hole) => ringContains(hole, point)),
    ),
  );
}

function centroid(points: Float64Array, triangles: Int32Array, t: number): [number, number] {
  let x = 0;
  let y = 0;
  for (let k = 0; k < 3; k += 1) {
    const v = triangles[3 * t + k] as number;
    x += points[2 * v] as number;
    y += points[2 * v + 1] as number;
  }
  return [x / 3, y / 3];
}

function triangleArea(points: Float64Array, triangles: Int32Array, t: number): number {
  const a = triangles[3 * t] as number;
  const b = triangles[3 * t + 1] as number;
  const c = triangles[3 * t + 2] as number;
  const ax = points[2 * a] as number;
  const ay = points[2 * a + 1] as number;
  return (
    Math.abs(
      ((points[2 * b] as number) - ax) * ((points[2 * c + 1] as number) - ay) -
        ((points[2 * b + 1] as number) - ay) * ((points[2 * c] as number) - ax),
    ) / 2
  );
}

const INDEX_CELL_KM = 40;

function indexTriangles(
  map: GameMap,
  points: Float64Array,
  triangles: Int32Array,
  surface: Uint8Array,
): TriangleIndex {
  const columns = Math.ceil(map.width / INDEX_CELL_KM) + 1;
  const rows = Math.ceil(map.height / INDEX_CELL_KM) + 1;
  const buckets: number[][] = Array.from({ length: columns * rows }, () => []);
  const clampColumn = (x: number) =>
    Math.min(columns - 1, Math.max(0, Math.floor(x / INDEX_CELL_KM)));
  const clampRow = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / INDEX_CELL_KM)));
  for (let t = 0; t < triangles.length / 3; t += 1) {
    if (surface[t] === SURFACE_CODE.offMap) continue;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < 3; k += 1) {
      const v = triangles[3 * t + k] as number;
      const x = points[2 * v] as number;
      const y = points[2 * v + 1] as number;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let r = clampRow(minY - 0.01); r <= clampRow(maxY + 0.01); r += 1) {
      for (let c = clampColumn(minX - 0.01); c <= clampColumn(maxX + 0.01); c += 1) {
        (buckets[r * columns + c] as number[]).push(t);
      }
    }
  }
  const start = new Int32Array(buckets.length + 1);
  for (const [i, bucket] of buckets.entries()) start[i + 1] = (start[i] as number) + bucket.length;
  const items = new Int32Array(start[buckets.length] as number);
  for (const [i, bucket] of buckets.entries()) items.set(bucket, start[i] as number);
  return { cellKm: INDEX_CELL_KM, columns, rows, start, items };
}
