import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMap, type GameMap } from '../../src/sim/map.ts';
import type { MapPoint } from '../../src/sim/state/map-point.ts';
import { distance, findPath } from '../../src/sim/world/find-path.ts';
import { buildNavMesh, type NavMesh } from '../../src/sim/world/mesh.ts';
import { next, prev } from '../../src/sim/world/triangulate.ts';
import { buildWorld } from '../../src/sim/world/world.ts';
import type { CityId } from '../../src/sim/ids.ts';
import { LandOracle } from './land-oracle.ts';

export const ROUTES: [string, string][] = [
  ['roma', 'tarraco'],
  ['gades', 'byzantion'],
  ['olisipo', 'persepolis'],
  ['tingis', 'alexandria'],
  ['lutetia', 'memphis'],
  ['carthago', 'ekbatana'],
];

export function loadMap(): GameMap {
  const file = resolve(import.meta.dirname, '../../data/map/map.json');
  return parseMap(JSON.parse(readFileSync(file, 'utf8')));
}

export function cityAt(map: GameMap, id: string): MapPoint {
  const province = map.provinces.find((p) => p.id === id);
  if (!province) throw new Error(`no city ${id}`);
  return { x: province.city[0], y: province.city[1] };
}

export function pathLength(from: MapPoint, path: readonly MapPoint[]): number {
  let length = 0;
  let at = from;
  for (const point of path) {
    length += distance(at, point);
    at = point;
  }
  return length;
}

function time<T>(run: () => T, repeats: number): { result: T; ms: number } {
  let result = run();
  const started = performance.now();
  for (let i = 0; i < repeats; i += 1) result = run();
  return { result, ms: (performance.now() - started) / repeats };
}

/**
 * The true shortest land path: Dijkstra over the reflex coast vertices, joining two
 * vertices only when the segment is tangent to the coast at both and stays on land.
 */
export function exactPath(
  mesh: NavMesh,
  oracle: LandOracle,
  from: MapPoint,
  to: MapPoint,
  on: 'land' | 'sea' = 'land',
): number {
  const code = on === 'land' ? 1 : 2;
  const clear = (p: MapPoint) => (on === 'land' ? oracle.pointOnLand(p) : oracle.pointAtSea(p));
  const { points, triangles, halfedges, walls, surface } = mesh;
  const vertexCount = points.length / 2;
  const landAngle = new Float64Array(vertexCount);
  const wallNeighbours: number[][] = Array.from({ length: vertexCount }, () => []);
  for (let e = 0; e < triangles.length; e += 1) {
    const t = Math.floor(e / 3);
    const v = triangles[e] as number;
    if (surface[t] === code) {
      const a = triangles[next(e)] as number;
      const b = triangles[prev(e)] as number;
      const ux = (points[2 * a] as number) - (points[2 * v] as number);
      const uy = (points[2 * a + 1] as number) - (points[2 * v + 1] as number);
      const wx = (points[2 * b] as number) - (points[2 * v] as number);
      const wy = (points[2 * b + 1] as number) - (points[2 * v + 1] as number);
      landAngle[v] =
        (landAngle[v] as number) + Math.abs(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy));
      if (walls[e]) {
        (wallNeighbours[v] as number[]).push(a);
        (wallNeighbours[a] as number[]).push(v);
      }
    }
  }
  const at = (v: number): MapPoint => ({
    x: points[2 * v] as number,
    y: points[2 * v + 1] as number,
  });
  const candidates: number[] = [];
  for (let v = 0; v < vertexCount; v += 1) {
    if ((wallNeighbours[v] as number[]).length >= 2 && (landAngle[v] as number) > Math.PI + 1e-9) {
      candidates.push(v);
    }
  }
  const tangent = (from: MapPoint, v: number) => {
    const p = at(v);
    let side = 0;
    for (const n of new Set(wallNeighbours[v])) {
      const q = at(n);
      const s = Math.sign((p.x - from.x) * (q.y - from.y) - (p.y - from.y) * (q.x - from.x));
      if (s === 0) continue;
      if (side !== 0 && s !== side) return false;
      side = s;
    }
    return true;
  };
  const wallCell = 50;
  const wallBuckets = new Map<number, number[]>();
  const key = (c: number, r: number) => r * 1000 + c;
  for (let e = 0; e < triangles.length; e += 1) {
    if (!walls[e] || (halfedges[e] as number) > e) continue;
    const a = at(triangles[e] as number);
    const b = at(triangles[next(e)] as number);
    for (
      let r = Math.floor(Math.min(a.y, b.y) / wallCell);
      r <= Math.floor(Math.max(a.y, b.y) / wallCell);
      r += 1
    ) {
      for (
        let c = Math.floor(Math.min(a.x, b.x) / wallCell);
        c <= Math.floor(Math.max(a.x, b.x) / wallCell);
        c += 1
      ) {
        const list = wallBuckets.get(key(c, r)) ?? [];
        list.push(e);
        wallBuckets.set(key(c, r), list);
      }
    }
  }
  const orient = (a: MapPoint, b: MapPoint, c: MapPoint) => {
    const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return Math.abs(value) < 1e-6 ? 0 : Math.sign(value);
  };
  const crossesWall = (p: MapPoint, q: MapPoint) => {
    const seen = new Set<number>();
    const steps = Math.ceil(distance(p, q) / (wallCell / 2));
    for (let i = 0; i <= steps; i += 1) {
      const x = p.x + ((q.x - p.x) * i) / steps;
      const y = p.y + ((q.y - p.y) * i) / steps;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          for (const e of wallBuckets.get(
            key(Math.floor(x / wallCell) + dc, Math.floor(y / wallCell) + dr),
          ) ?? []) {
            if (seen.has(e)) continue;
            seen.add(e);
            const a = at(triangles[e] as number);
            const b = at(triangles[next(e)] as number);
            if (orient(p, q, a) * orient(p, q, b) < 0 && orient(a, b, p) * orient(a, b, q) < 0)
              return true;
          }
        }
      }
    }
    return false;
  };
  const nodes: MapPoint[] = [from, ...candidates.map(at), to];
  const ids = [-1, ...candidates, -1];
  const goal = nodes.length - 1;
  const cost = new Float64Array(nodes.length).fill(Number.POSITIVE_INFINITY);
  const done = new Uint8Array(nodes.length);
  cost[0] = 0;
  for (;;) {
    let u = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < nodes.length; i += 1) {
      const f = (cost[i] as number) + distance(nodes[i] as MapPoint, to);
      if (!done[i] && f < best) {
        best = f;
        u = i;
      }
    }
    if (u < 0) return Number.POSITIVE_INFINITY;
    if (u === goal) return cost[u] as number;
    done[u] = 1;
    const p = nodes[u] as MapPoint;
    for (let v = 1; v < nodes.length; v += 1) {
      if (done[v]) continue;
      const q = nodes[v] as MapPoint;
      const g = (cost[u] as number) + distance(p, q);
      if (g >= (cost[v] as number)) continue;
      const uid = ids[u] as number;
      const vid = ids[v] as number;
      if (uid >= 0 && !tangent(q, uid)) continue;
      if (vid >= 0 && !tangent(p, vid)) continue;
      if (crossesWall(p, q) || !clear({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })) {
        continue;
      }
      cost[v] = g;
    }
  }
}

/** Land cells on a square raster, filled province by province along scanlines. */
function rasterize(map: GameMap, cellKm: number) {
  const columns = Math.ceil(map.width / cellKm);
  const rows = Math.ceil(map.height / cellKm);
  const land = new Uint8Array(columns * rows);
  for (let r = 0; r < rows; r += 1) {
    const y = (r + 0.5) * cellKm;
    for (const province of map.provinces) {
      const xs: number[] = [];
      for (const polygon of province.outline) {
        for (const ring of polygon) {
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
            const [xi, yi] = ring[i] as [number, number];
            const [xj, yj] = ring[j] as [number, number];
            if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
          }
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.ceil((xs[k] as number) / cellKm - 0.5);
        const c1 = Math.floor((xs[k + 1] as number) / cellKm - 0.5);
        for (let c = Math.max(0, c0); c <= Math.min(columns - 1, c1); c += 1)
          land[r * columns + c] = 1;
      }
    }
  }
  return { columns, rows, cellKm, land };
}

type Raster = ReturnType<typeof rasterize>;

/** 8-connected A* over land cells, then string pulling by line of sight over land cells. */
function gridPath(grid: Raster, from: MapPoint, to: MapPoint): MapPoint[] | undefined {
  const { columns, rows, cellKm, land } = grid;
  const cellOf = (p: MapPoint) => Math.floor(p.y / cellKm) * columns + Math.floor(p.x / cellKm);
  const nearestLand = (p: MapPoint) => {
    const c = cellOf(p);
    if (land[c]) return c;
    const cx = c % columns;
    const cy = Math.floor(c / columns);
    for (let ring = 1; ring <= 2; ring += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          const n = (cy + dy) * columns + cx + dx;
          if (land[n]) return n;
        }
      }
    }
    return -1;
  };
  const start = nearestLand(from);
  const goal = nearestLand(to);
  if (start < 0 || goal < 0) return undefined;
  const gx = goal % columns;
  const gy = Math.floor(goal / columns);
  const h = (c: number) => {
    const dx = Math.abs((c % columns) - gx);
    const dy = Math.abs(Math.floor(c / columns) - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const g = new Float64Array(land.length).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(land.length).fill(-1);
  const heapKeys: number[] = [];
  const heapItems: number[] = [];
  const push = (item: number, key: number) => {
    let i = heapItems.length;
    heapKeys.push(key);
    heapItems.push(item);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if ((heapKeys[up] as number) <= key) break;
      heapKeys[i] = heapKeys[up] as number;
      heapItems[i] = heapItems[up] as number;
      i = up;
    }
    heapKeys[i] = key;
    heapItems[i] = item;
  };
  const pop = () => {
    const top = heapItems[0] as number;
    const key = heapKeys.pop() as number;
    const item = heapItems.pop() as number;
    if (heapItems.length > 0) {
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= heapItems.length) break;
        if (m + 1 < heapItems.length && (heapKeys[m + 1] as number) < (heapKeys[m] as number))
          m += 1;
        if ((heapKeys[m] as number) >= key) break;
        heapKeys[i] = heapKeys[m] as number;
        heapItems[i] = heapItems[m] as number;
        i = m;
      }
      heapKeys[i] = key;
      heapItems[i] = item;
    }
    return top;
  };
  g[start] = 0;
  push(start, h(start));
  const closed = new Uint8Array(land.length);
  while (heapItems.length > 0) {
    const c = pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === goal) break;
    const cx = c % columns;
    const cy = Math.floor(c / columns);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        const n = ny * columns + nx;
        if (!land[n]) continue;
        if (dx !== 0 && dy !== 0 && (!land[cy * columns + nx] || !land[ny * columns + cx]))
          continue;
        const ng = (g[c] as number) + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        if (ng < (g[n] as number)) {
          g[n] = ng;
          parent[n] = c;
          push(n, ng + h(n));
        }
      }
    }
  }
  if (!closed[goal]) return undefined;
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = parent[c] as number) cells.push(c);
  cells.reverse();
  const centre = (c: number): MapPoint => ({
    x: ((c % columns) + 0.5) * cellKm,
    y: (Math.floor(c / columns) + 0.5) * cellKm,
  });
  const sight = (a: number, b: number) => {
    const p = centre(a);
    const q = centre(b);
    const steps = Math.ceil((distance(p, q) / cellKm) * 4);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / Math.max(1, steps);
      if (!land[cellOf({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })]) return false;
    }
    return true;
  };
  const pulled: MapPoint[] = [];
  let anchor = 0;
  for (let i = 2; i < cells.length; i += 1) {
    if (!sight(cells[anchor] as number, cells[i] as number)) {
      pulled.push(centre(cells[i - 1] as number));
      anchor = i - 1;
    }
  }
  pulled.push(to);
  return pulled;
}

/** The chosen method against the exact path over seeded random pairs of cities that land joins. */
function sampleExcess(map: GameMap, oracle: LandOracle, mesh: NavMesh): string {
  let seed = 12345;
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 0x100000000;
  };
  const excesses: number[] = [];
  while (excesses.length < 100) {
    const a = map.provinces[Math.floor(random() * map.provinces.length)];
    const b = map.provinces[Math.floor(random() * map.provinces.length)];
    if (!a || !b || a === b) continue;
    const from = cityAt(map, a.id);
    const to = cityAt(map, b.id);
    const path = findPath(mesh, from, to, 'land');
    if (!path) continue;
    excesses.push(pathLength(from, path) / exactPath(mesh, oracle, from, to) - 1);
  }
  excesses.sort((x, y) => x - y);
  const mean = excesses.reduce((sum, x) => sum + x, 0) / excesses.length;
  const at = (q: number) =>
    excesses[Math.min(excesses.length - 1, Math.floor(q * excesses.length))] as number;
  const pct = (x: number) => `${(100 * x).toFixed(3)}%`;
  return `Navmesh against exact over 100 random city pairs joined by land: mean ${pct(mean)}, median ${pct(at(0.5))}, 95th percentile ${pct(at(0.95))}, worst ${pct(at(1))}, lowest ${pct(at(0))}, within 0.001% in ${excesses.filter((x) => Math.abs(x) < 1e-5).length} of 100.`;
}

/** Sea paths between harbours against the visibility-graph reference, which is only approximate at sea. */
function seaExcess(map: GameMap, oracle: LandOracle): string {
  const world = buildWorld(map);
  const ports = [...world.harbours.keys()].sort();
  const excesses: number[] = [];
  const times: number[] = [];
  let wet = 0;
  for (let i = 0; i < ports.length; i += 1) {
    const a = world.harbours.get(ports[i] as CityId) as MapPoint;
    const b = world.harbours.get(ports[(i * 7 + 11) % ports.length] as CityId) as MapPoint;
    if (a === b) continue;
    const { result: path, ms } = time(() => findPath(world.mesh, a, b, 'sea'), 5);
    if (!path) throw new Error(`no sea path from ${ports[i]}`);
    times.push(ms);
    let at = a;
    for (const point of path) {
      if (!oracle.segmentAtSea(at, point)) wet += 1;
      at = point;
    }
    excesses.push(pathLength(a, path) / exactPath(world.mesh, oracle, a, b, 'sea') - 1);
  }
  const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  return `Sea paths between ${excesses.length} pairs of harbours: against the reference mean ${pct(mean(excesses))}, lowest ${pct(Math.min(...excesses))}, highest ${pct(Math.max(...excesses))}; mean query ${mean(times).toFixed(2)} ms, worst ${Math.max(...times).toFixed(2)} ms; legs over land ${wet}.`;
}

function main() {
  const map = loadMap();
  const oracle = new LandOracle(map);
  const reference = buildNavMesh(map, 0);
  const rows: string[] = [];
  const notes: string[] = [];
  const exact = new Map<string, number>();
  for (const [a, b] of ROUTES) {
    exact.set(`${a}-${b}`, exactPath(reference, oracle, cityAt(map, a), cityAt(map, b)));
  }

  rows.push(
    '| Method | Build | Mean query | Worst query | Mean excess over exact | Worst excess | Water crossings | Roma to Syracusae |',
  );
  rows.push('|---|---|---|---|---|---|---|---|');
  const report = (
    name: string,
    buildMs: number,
    find: (from: MapPoint, to: MapPoint) => MapPoint[] | undefined,
  ) => {
    let totalMs = 0;
    let worstMs = 0;
    let totalExcess = 0;
    let worstExcess = 0;
    let wet = 0;
    const missing: string[] = [];
    for (const [a, b] of ROUTES) {
      const from = cityAt(map, a);
      const to = cityAt(map, b);
      const { result, ms } = time(() => find(from, to), 10);
      totalMs += ms;
      worstMs = Math.max(worstMs, ms);
      if (!result) {
        missing.push(`${a}-${b}`);
        continue;
      }
      const excess = pathLength(from, result) / (exact.get(`${a}-${b}`) as number) - 1;
      totalExcess += excess;
      worstExcess = Math.max(worstExcess, excess);
      let at = from;
      for (const point of result) {
        if (!oracle.segmentOnLand(at, point)) wet += 1;
        at = point;
      }
    }
    const island = find(cityAt(map, 'roma'), cityAt(map, 'syracusae'))
      ? 'reached (wrong)'
      : 'unreachable';
    const pct = (x: number) => `${(100 * x).toFixed(3)}%`;
    const found = ROUTES.length - missing.length;
    if (missing.length > 0) notes.push(`${name} found no path for ${missing.join(', ')}.`);
    rows.push(
      `| ${name} | ${buildMs.toFixed(0)} ms | ${totalMs / ROUTES.length < 1 ? (totalMs / ROUTES.length).toFixed(2) : (totalMs / ROUTES.length).toFixed(1)} ms | ${worstMs.toFixed(2)} ms | ${pct(totalExcess / Math.max(1, found))} | ${pct(worstExcess)} | ${wet} | ${island} |`,
    );
  };

  for (const cellKm of [10, 5]) {
    const { result: grid, ms } = time(() => rasterize(map, cellKm), 1);
    report(`grid ${cellKm} km`, ms, (from, to) => gridPath(grid, from, to));
  }
  for (const spacing of [0, 100, 50]) {
    const { result: mesh, ms } = time(() => buildNavMesh(map, spacing), 2);
    const label =
      spacing === 0
        ? 'navmesh, coast vertices only'
        : `navmesh, interior points every ${spacing} km`;
    report(label, ms, (from, to) => findPath(mesh, from, to, 'land'));
  }
  console.log(rows.join('\n'));
  console.log(`\n${sampleExcess(map, oracle, reference)}`);
  console.log(`\n${seaExcess(map, oracle)}`);
  if (notes.length > 0) console.log(`\n${notes.join('\n')}`);
  console.log(
    '\nExact lengths (km):',
    [...exact].map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '),
  );
}

if (import.meta.main) main();
