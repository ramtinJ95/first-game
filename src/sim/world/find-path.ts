import type { MapPoint } from '../state/map-point.ts';
import { surfaceCode, type NavMesh, type Surface } from './mesh.ts';
import { next, prev } from './triangulate.ts';

/** A point this close to a triangle counts as inside it, so points on a shared edge or the coast are found. */
const ON_EDGE_KM = 1e-6;

/** Straight-line distance. `Math.hypot` may round differently between engines, a square root does not. */
export function distance(a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** The lowest-numbered triangle of the surface that holds the point, or -1. */
export function locate(mesh: NavMesh, point: MapPoint, surface: Surface): number {
  const { index, triangles, points } = mesh;
  const column = Math.floor(point.x / index.cellKm);
  const row = Math.floor(point.y / index.cellKm);
  if (column < 0 || row < 0 || column >= index.columns || row >= index.rows) return -1;
  const cell = row * index.columns + column;
  const code = surfaceCode(surface);
  for (let i = index.start[cell] as number; i < (index.start[cell + 1] as number); i += 1) {
    const t = index.items[i] as number;
    if (mesh.surface[t] !== code) continue;
    let inside = true;
    for (let k = 0; k < 3 && inside; k += 1) {
      const a = triangles[3 * t + k] as number;
      const b = triangles[3 * t + ((k + 1) % 3)] as number;
      const ax = points[2 * a] as number;
      const ay = points[2 * a + 1] as number;
      const ex = (points[2 * b] as number) - ax;
      const ey = (points[2 * b + 1] as number) - ay;
      const cross = ex * (point.y - ay) - ey * (point.x - ax);
      if (cross < -ON_EDGE_KM * Math.sqrt(ex * ex + ey * ey)) inside = false;
    }
    if (inside) return t;
  }
  return -1;
}

/** What lies under a point. A point on the coast counts as land. */
export function surfaceAt(mesh: NavMesh, point: MapPoint): Surface {
  if (locate(mesh, point, 'land') >= 0) return 'land';
  if (locate(mesh, point, 'sea') >= 0) return 'sea';
  return 'offMap';
}

/** Whether a path on the surface joins the two points, without searching for it. */
export function connected(mesh: NavMesh, from: MapPoint, to: MapPoint, surface: Surface): boolean {
  const a = locate(mesh, from, surface);
  const b = locate(mesh, to, surface);
  return a >= 0 && b >= 0 && mesh.component[a] === mesh.component[b];
}

/**
 * The waypoints of a short path from one point to another that stays on the surface,
 * ending with `to` and leaving out `from`. Undefined when either point is off the
 * surface or no path joins them. A* picks the chain of triangles, and the funnel
 * algorithm pulls the path tight inside that chain.
 */
export function findPath(
  mesh: NavMesh,
  from: MapPoint,
  to: MapPoint,
  surface: Surface,
): MapPoint[] | undefined {
  const start = locate(mesh, from, surface);
  const goal = locate(mesh, to, surface);
  if (start < 0 || goal < 0 || mesh.component[start] !== mesh.component[goal]) return undefined;
  if (start === goal) return [{ x: to.x, y: to.y }];

  const { triangles, halfedges, walls, points } = mesh;
  const code = surfaceCode(surface);
  const viaX = new Float64Array(halfedges.length);
  const viaY = new Float64Array(halfedges.length);
  /**
   * The point of edge `e` that makes the way from (px, py) through the edge to the goal
   * shortest. It stands in for where the path crosses the edge, so the search ranks a
   * chain of triangles by a length close to the taut path through it.
   */
  const crossing = (px: number, py: number, e: number): [number, number] => {
    const a = 2 * (triangles[e] as number);
    const b = 2 * (triangles[next(e)] as number);
    const ax = points[a] as number;
    const ay = points[a + 1] as number;
    const ex = (points[b] as number) - ax;
    const ey = (points[b + 1] as number) - ay;
    const side = (x: number, y: number) => ex * (y - ay) - ey * (x - ax);
    let tx = to.x;
    let ty = to.y;
    const length2 = ex * ex + ey * ey;
    if (side(px, py) * side(tx, ty) > 0) {
      const k = (2 * side(tx, ty)) / length2;
      tx += k * ey;
      ty -= k * ex;
    }
    const dx = tx - px;
    const dy = ty - py;
    const denominator = ex * dy - ey * dx;
    const along =
      denominator !== 0
        ? ((px - ax) * dy - (py - ay) * dx) / denominator
        : span(px, py, ax, ay) + span(ax, ay, to.x, to.y) <=
            span(px, py, ax + ex, ay + ey) + span(ax + ex, ay + ey, to.x, to.y)
          ? 0
          : 1;
    const u = Math.min(1, Math.max(0, along));
    return [ax + ex * u, ay + ey * u];
  };
  const span = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const passable = (e: number) => {
    const twin = halfedges[e] as number;
    return twin >= 0 && !walls[e] && mesh.surface[Math.floor(twin / 3)] === code;
  };

  const cost = new Float64Array(halfedges.length).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(halfedges.length).fill(-1);
  const done = new Uint8Array(halfedges.length);
  const heap = new MinHeap();
  const FROM_START = -2;

  for (let k = 0; k < 3; k += 1) {
    const e = 3 * start + k;
    if (!passable(e)) continue;
    const entered = halfedges[e] as number;
    const [x, y] = crossing(from.x, from.y, e);
    const g = span(from.x, from.y, x, y);
    cost[entered] = g;
    viaX[entered] = x;
    viaY[entered] = y;
    parent[entered] = FROM_START;
    heap.push(entered, g + span(x, y, to.x, to.y));
  }

  let best = Number.POSITIVE_INFINITY;
  let last = -1;
  while (heap.size > 0) {
    const f = heap.peekKey();
    if (f >= best) break;
    const e = heap.pop();
    if (done[e]) continue;
    done[e] = 1;
    const g = cost[e] as number;
    const ex = viaX[e] as number;
    const ey = viaY[e] as number;
    if (Math.floor(e / 3) === goal) {
      const total = g + span(ex, ey, to.x, to.y);
      if (total < best) {
        best = total;
        last = e;
      }
      continue;
    }
    for (const out of [next(e), prev(e)]) {
      if (!passable(out)) continue;
      const entered = halfedges[out] as number;
      if (done[entered]) continue;
      const [ox, oy] = crossing(ex, ey, out);
      const ng = g + span(ex, ey, ox, oy);
      if (ng < (cost[entered] as number)) {
        cost[entered] = ng;
        viaX[entered] = ox;
        viaY[entered] = oy;
        parent[entered] = e;
        heap.push(entered, ng + span(ox, oy, to.x, to.y));
      }
    }
  }
  if (last < 0) return undefined;

  const crossed: number[] = [];
  for (let e = last; e !== FROM_START; e = parent[e] as number) crossed.push(e);
  crossed.reverse();
  const vertex = (v: number): MapPoint => ({
    x: points[2 * v] as number,
    y: points[2 * v + 1] as number,
  });
  const portals: [MapPoint, MapPoint][] = [[from, from]];
  for (const entered of crossed) {
    const exit = halfedges[entered] as number;
    portals.push([vertex(triangles[next(exit)] as number), vertex(triangles[exit] as number)]);
  }
  portals.push([to, to]);
  return pullTight(portals);
}

/**
 * The simple stupid funnel algorithm. Each portal is an edge the path crosses, given
 * as its endpoint on the left of the direction of travel and its endpoint on the right.
 */
function pullTight(portals: readonly [MapPoint, MapPoint][]): MapPoint[] {
  const area = (a: MapPoint, b: MapPoint, c: MapPoint) =>
    (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
  const same = (a: MapPoint, b: MapPoint) => a.x === b.x && a.y === b.y;
  const [first] = portals as [[MapPoint, MapPoint]];
  const path: MapPoint[] = [];
  let apex = first[0];
  let left = first[0];
  let right = first[1];
  let leftAt = 0;
  let rightAt = 0;
  for (let i = 1; i < portals.length; i += 1) {
    const [nextLeft, nextRight] = portals[i] as [MapPoint, MapPoint];
    if (area(apex, right, nextRight) <= 0) {
      if (same(apex, right) || area(apex, left, nextRight) > 0) {
        right = nextRight;
        rightAt = i;
      } else {
        path.push(left);
        apex = left;
        right = apex;
        rightAt = leftAt;
        i = leftAt;
        continue;
      }
    }
    if (area(apex, left, nextLeft) >= 0) {
      if (same(apex, left) || area(apex, right, nextLeft) < 0) {
        left = nextLeft;
        leftAt = i;
      } else {
        path.push(right);
        apex = right;
        left = apex;
        leftAt = rightAt;
        i = rightAt;
        continue;
      }
    }
  }
  const end = (portals[portals.length - 1] as [MapPoint, MapPoint])[0];
  path.push(end);
  const out: MapPoint[] = [];
  for (const point of path) {
    const previous = out[out.length - 1];
    if (previous ? same(previous, point) : same(first[0], point)) continue;
    out.push({ x: point.x, y: point.y });
  }
  if (out.length === 0) out.push({ x: end.x, y: end.y });
  return out;
}

/** A binary heap of half-edges keyed by estimated path length. Ties go to the lower half-edge. */
class MinHeap {
  private keys: number[] = [];
  private items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  peekKey(): number {
    return this.keys[0] as number;
  }

  push(item: number, key: number): void {
    const { keys, items } = this;
    let i = items.length;
    keys.push(key);
    items.push(item);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!this.less(i, up)) break;
      this.swap(i, up);
      i = up;
    }
  }

  pop(): number {
    const { keys, items } = this;
    const top = items[0] as number;
    const lastKey = keys.pop() as number;
    const lastItem = items.pop() as number;
    if (items.length > 0) {
      keys[0] = lastKey;
      items[0] = lastItem;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(l, m)) m = l;
        if (r < items.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private less(i: number, j: number): boolean {
    const a = this.keys[i] as number;
    const b = this.keys[j] as number;
    return a < b || (a === b && (this.items[i] as number) < (this.items[j] as number));
  }

  private swap(i: number, j: number): void {
    const { keys, items } = this;
    [keys[i], keys[j]] = [keys[j] as number, keys[i] as number];
    [items[i], items[j]] = [items[j] as number, items[i] as number];
  }
}
