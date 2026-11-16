import type { MapPoint } from '../sim/state/map-point.ts';
import { distance } from '../sim/world/find-path.ts';
import type { Box } from './labels.ts';
import type { AreaIndex } from './terrain/area-index.ts';

/** A trade route's way as the map draws it, and its length in km. */
export interface DrawnLane {
  readonly path: readonly MapPoint[];
  readonly km: number;
}

/** The side of a cell of the search round a stretch on the wrong side, in km. */
const CELL_KM = 0.25;
/**
 * A point counts as on the wrong side only this far past the drawn coast: a lane may
 * touch the coast it follows, and at the closest zoom this is about a pixel.
 */
const TOLERANCE_KM = 0.3;
/** How often a straight way is tested along its length, in km. */
const SAMPLE_KM = 0.1;
/** How far round a stretch the first search looks, in km. Each failure doubles it. */
const FIRST_MARGIN_KM = 12;
const SEARCHES = 3;
/** Dense points added to each end of a run whose search found no way. */
const WIDENINGS = [0, 4, 16];

const AROUND = Array.from({ length: 8 }, (_, k) => [
  TOLERANCE_KM * Math.cos((k * Math.PI) / 4),
  TOLERANCE_KM * Math.sin((k * Math.PI) / 4),
]);

const lanes = new WeakMap<AreaIndex, WeakMap<readonly MapPoint[], DrawnLane>>();

/**
 * The rules find a sea lane on their coastline, and it runs along that coast. The atlas
 * draws a finer coast up to 8 km away, so a lane cut the drawn capes and its ships sailed
 * over land. This keeps the lane on the drawn side of `area`, inside it for a road and
 * outside it for a lane, by searching round every stretch that crosses. The ends stay,
 * since a harbour of the rules can lie a little inside the drawn coast. A route's path
 * never changes, so each is worked out once.
 */
export function drawnLane(path: readonly MapPoint[], area: AreaIndex, inside: boolean): DrawnLane {
  let cache = lanes.get(area);
  if (!cache) {
    cache = new WeakMap();
    lanes.set(area, cache);
  }
  const known = cache.get(path);
  if (known) return known;
  const lane = keepSide(path, area, inside);
  cache.set(path, lane);
  return lane;
}

/** Tests of a point and of a straight way against the drawn side, with the tolerance. */
export function drawnSide(area: AreaIndex, inside: boolean) {
  const wrong = (p: MapPoint) =>
    area.inside(p.x, p.y) !== inside &&
    AROUND.every(([dx, dy]) => area.inside(p.x + (dx as number), p.y + (dy as number)) !== inside);
  const clear = (a: MapPoint, b: MapPoint) => {
    if (area.segmentInside(a.x, a.y, b.x, b.y, inside)) return true;
    const n = Math.ceil(distance(a, b) / SAMPLE_KM);
    for (let k = 0; k <= n; k++)
      if (wrong({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })) return false;
    return true;
  };
  return { wrong, clear };
}

function keepSide(path: readonly MapPoint[], area: AreaIndex, inside: boolean): DrawnLane {
  const { wrong, clear } = drawnSide(area, inside);
  const dense: MapPoint[] = path.slice(0, 1);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as MapPoint;
    const b = path[i] as MapPoint;
    if (clear(a, b)) {
      dense.push(b);
      continue;
    }
    const n = Math.max(1, Math.ceil(distance(a, b) / CELL_KM));
    for (let k = 1; k <= n; k++)
      dense.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const first = dense.findIndex((p) => !wrong(p));
  const last = dense.findLastIndex((p) => !wrong(p));
  if (first < 0 || (first === 0 && last === dense.length - 1 && dense.length === path.length))
    return lengthOf(path);
  const onSide = (p: MapPoint) => area.inside(p.x, p.y) === inside;
  const out: MapPoint[] = dense.slice(0, first + 1);
  // The last dense point a detour reached; those after it are in `out` one by one.
  let anchor = first;
  for (let i = first + 1; i <= last; i++) {
    if (!wrong(dense[i] as MapPoint)) {
      out.push(dense[i] as MapPoint);
      continue;
    }
    let j = i;
    while (wrong(dense[j] as MapPoint)) j++;
    // A run's ends can sit in a pocket of the drawn side; a wider run starts outside it.
    let detour: MapPoint[] | undefined;
    for (const widen of WIDENINGS) {
      const h = Math.max(anchor, i - 1 - widen);
      const k = Math.min(last, j + widen);
      detour = search(
        dense.slice(h, k + 1),
        dense[h] as MapPoint,
        dense[k] as MapPoint,
        onSide,
        clear,
      );
      if (detour) {
        out.length -= i - 1 - h;
        j = k;
        break;
      }
    }
    out.push(...(detour ?? dense.slice(i, j + 1)));
    anchor = j;
    i = j;
  }
  out.push(...dense.slice(last + 1));
  return lengthOf(straighten(out));
}

/** Drops the points that lie on the straight way between their neighbours. */
function straighten(points: readonly MapPoint[]): MapPoint[] {
  const out = points.slice(0, 1);
  for (let i = 1; i < points.length - 1; i++) {
    const a = out.at(-1) as MapPoint;
    const b = points[i] as MapPoint;
    const c = points[i + 1] as MapPoint;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 1e-9 * (1 + distance(a, c) ** 2)) out.push(b);
  }
  if (points.length > 1) out.push(points.at(-1) as MapPoint);
  return out;
}

/** Drops the points of a way that a straight way on the drawn side can skip. */
function pull(
  points: readonly MapPoint[],
  clear: (a: MapPoint, b: MapPoint) => boolean,
): MapPoint[] {
  const out = points.slice(0, 1);
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    while (j + 1 < points.length && clear(points[i] as MapPoint, points[j + 1] as MapPoint)) j++;
    out.push(points[j] as MapPoint);
    i = j;
  }
  return out;
}

/** A way of cells on the drawn side from one point to another, round the stretch between. */
function search(
  stretch: readonly MapPoint[],
  from: MapPoint,
  to: MapPoint,
  onSide: (p: MapPoint) => boolean,
  clear: (a: MapPoint, b: MapPoint) => boolean,
): MapPoint[] | undefined {
  for (let k = 0, margin = FIRST_MARGIN_KM; k < SEARCHES; k++, margin *= 2) {
    const found = searchWithin(stretch, from, to, margin, onSide, clear);
    if (found) return found;
  }
  return undefined;
}

/**
 * A* over cells whose centres lie on the drawn side, eight ways from each. The way leaves
 * `from` for a cell beside it and reaches `to` from one, each by a straight way that is
 * clear, and is then pulled tight.
 */
function searchWithin(
  stretch: readonly MapPoint[],
  from: MapPoint,
  to: MapPoint,
  margin: number,
  onSide: (p: MapPoint) => boolean,
  clear: (a: MapPoint, b: MapPoint) => boolean,
): MapPoint[] | undefined {
  const xs = stretch.map((p) => p.x);
  const ys = stretch.map((p) => p.y);
  const left = Math.min(...xs) - margin;
  const top = Math.min(...ys) - margin;
  const columns = Math.ceil((Math.max(...xs) + margin - left) / CELL_KM) + 1;
  const rows = Math.ceil((Math.max(...ys) + margin - top) / CELL_KM) + 1;
  const count = columns * rows;
  const centre = (c: number): MapPoint => ({
    x: left + (c % columns) * CELL_KM,
    y: top + Math.floor(c / columns) * CELL_KM,
  });
  const side = new Int8Array(count);
  const open = (c: number) => {
    if (side[c] === 0) side[c] = onSide(centre(c)) ? 1 : -1;
    return side[c] === 1;
  };
  const beside = (p: MapPoint) => {
    const column = Math.floor((p.x - left) / CELL_KM);
    const row = Math.floor((p.y - top) / CELL_KM);
    const cells: number[] = [];
    for (let dy = -1; dy <= 2; dy++)
      for (let dx = -1; dx <= 2; dx++) {
        const x = column + dx;
        const y = row + dy;
        if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
        const c = y * columns + x;
        if (open(c)) cells.push(c);
      }
    return cells;
  };
  const cost = new Float64Array(count).fill(Infinity);
  const parent = new Int32Array(count).fill(-1);
  const goals = new Set(beside(to).filter((c) => clear(centre(c), to)));
  if (goals.size === 0) return undefined;
  const heap = new MinHeap();
  const guess = (c: number) => distance(centre(c), to);
  for (const c of beside(from)) {
    const p = centre(c);
    if (!clear(from, p)) continue;
    cost[c] = distance(from, p);
    heap.push(c, (cost[c] as number) + guess(c));
  }
  let reached = -1;
  while (heap.size > 0) {
    const c = heap.pop();
    if (goals.has(c)) {
      reached = c;
      break;
    }
    const column = c % columns;
    const row = Math.floor(c / columns);
    for (const [dx, dy] of STEPS) {
      const x = column + dx;
      const y = row + dy;
      if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
      const n = y * columns + x;
      if (!open(n)) continue;
      // A diagonal step past a cell on the other side may clip a corner of it.
      if (dx && dy && !(open(row * columns + x) && open(y * columns + column))) {
        if (!clear(centre(c), centre(n))) continue;
      }
      const next = (cost[c] as number) + CELL_KM * (dx && dy ? Math.SQRT2 : 1);
      if (next < (cost[n] as number)) {
        cost[n] = next;
        parent[n] = c;
        heap.push(n, next + guess(n));
      }
    }
  }
  if (reached < 0) return undefined;
  const cells: MapPoint[] = [to];
  for (let c = reached; c !== -1; c = parent[c] as number) cells.push(centre(c));
  cells.push(from);
  cells.reverse();
  const way = pull(cells, clear);
  if (!way.every((p, i) => i === 0 || clear(way[i - 1] as MapPoint, p))) return undefined;
  return way.slice(1);
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

class MinHeap {
  readonly #items: number[] = [];
  readonly #keys: number[] = [];
  get size() {
    return this.#items.length;
  }
  push(item: number, key: number) {
    const items = this.#items;
    const keys = this.#keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if ((keys[up] as number) <= key) break;
      items[i] = items[up] as number;
      keys[i] = keys[up] as number;
      i = up;
    }
    items[i] = item;
    keys[i] = key;
  }
  pop(): number {
    const items = this.#items;
    const keys = this.#keys;
    const top = items[0] as number;
    const item = items.pop() as number;
    const key = keys.pop() as number;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && (keys[r] as number) < (keys[l] as number) ? r : l;
        if ((keys[m] as number) >= key) break;
        items[i] = items[m] as number;
        keys[i] = keys[m] as number;
        i = m;
      }
      items[i] = item;
      keys[i] = key;
    }
    return top;
  }
}

function lengthOf(path: readonly MapPoint[]): DrawnLane {
  let km = 0;
  for (let i = 1; i < path.length; i++)
    km += distance(path[i - 1] as MapPoint, path[i] as MapPoint);
  return { path, km };
}

const boxes = new WeakMap<readonly MapPoint[], Box>();

/** The box round a path, kept for each path, which never changes. */
export function pathBox(path: readonly MapPoint[]): Box {
  let box = boxes.get(path);
  if (!box) {
    const xs = path.map((p) => p.x);
    const ys = path.map((p) => p.y);
    box = {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };
    boxes.set(path, box);
  }
  return box;
}
