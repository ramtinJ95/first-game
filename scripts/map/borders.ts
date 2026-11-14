import type { MapLine, MultiPolygon, Point, Polygon, Ring } from '../../src/sim/map.ts';
import { area, boxOf, type Box } from './geometry.ts';
import { round } from './projection.ts';

/** What a border follows besides the coast: the rivers and the lie of the ground. */
export interface BorderTerrain {
  readonly rivers: readonly MapLine[];
  /** Metres above the sea at a map point, 0 at sea. */
  height(point: Point): number;
  /** The map's edge, where the land ends but no coast runs. */
  readonly extent: Ring;
}

/** The side of a cell of the raster the land is re-cut on, in km. */
export const BORDER_CELL_KM = 2;
/**
 * Only land this close to a straight border may change province, so no border moves
 * farther than this from the line it replaces and every province keeps its core.
 */
export const MAX_BORDER_MOVE_KM = 50;
/**
 * A province gives up land only this share of the side of a square of its area from a
 * straight border, at most MAX_BORDER_MOVE_KM, so a small province keeps most of its land.
 */
export const REACH_SHARE = 0.2;
/**
 * Along the border of two provinces, one claim starts late by MEANDER_KM times one plus
 * a seeded noise of that pair and the other by MEANDER_KM times one minus it, so their
 * line meanders either way as a pen does, by as much as one side gains further on. A
 * pair whose smaller province reaches less than MAX_BORDER_MOVE_KM meanders less.
 */
export const MEANDER_KM = 60;
const MEANDER_OCTAVES: readonly (readonly [km: number, weight: number])[] = [
  [120, 0.55],
  [48, 0.3],
  [20, 0.15],
];
const MEANDER_SEED = 101;
/** What crossing a river adds to the way, so a border near a river runs along it. */
export const RIVER_CROSSING_KM = 70;
/**
 * What each metre of climb adds to the way. The claims of two cities climb a range from
 * both sides and meet near its crest, so a border near a range follows the watershed.
 */
export const CLIMB_KM_PER_M = 0.05;
/**
 * How much a seeded noise speeds or slows the way, as the exponent of a factor: a claim
 * runs ahead where the ground is quick and lags where it is slow, so the line where two
 * claims meet bends every few km. Each octave is a wavelength in km and a weight.
 */
export const WANDER = 0.5;
const WANDER_OCTAVES: readonly (readonly [km: number, weight: number])[] = [
  [40, 0.5],
  [16, 0.3],
  [7, 0.2],
];
const WANDER_SEED = 7;
/** A city keeps the land this close to it, so no border passes at its gate. */
export const CITY_KEEP_KM = 6;
/** Passes of a 1-2-1 average over each border's points, which round off the raster's steps. */
const SMOOTH_PASSES = 3;
/**
 * Every border point is then moved by a smooth seeded noise of up to this many km on each
 * axis, the waver of a hand that draws the line. The noise changes too slowly to fold the
 * plane, so borders that did not cross still do not, and a point two borders share moves
 * the same way in both.
 */
export const TREMOR_KM = 3;
const TREMOR_OCTAVES: readonly (readonly [km: number, weight: number])[] = [
  [18, 0.45],
  [8, 0.3],
  [4, 0.25],
];
const TREMOR_SEEDS = [301, 302] as const;
/** The tolerance each smoothed border is simplified to, in km. */
export const BORDER_SIMPLIFY_KM = 0.35;

const OUTSIDE = -1;

/** The two labels of a border as one number, the lower first, the same from either side. */
function pairOf(a: number, b: number): number {
  return Math.min(a, b) * 1024 + Math.max(a, b);
}

/**
 * The steps from a cell to the cells after it: the four of the eight round it, and the
 * four knight's moves. With the knight's moves a claim spreads as a sixteen-sided figure,
 * not an octagon, so it gains land at nearly the same pace in every direction.
 */
const FORWARD: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
  [2, 1],
  [1, 2],
  [-1, 2],
  [-2, 1],
];
const COAST_BITS = 0;
const RIVER_BITS = 8;

export interface Territory {
  /** The seed whose city the land belongs to. */
  readonly owner: number;
  readonly polygon: Polygon;
}

export interface Recut {
  /**
   * The component with a vertex added where each border meets the coast, on the map's
   * 0.1 km lattice and in the border too, so the provinces' coasts are the coastline.
   */
  readonly land: Polygon;
  /** One area per member seed, which reaches over the sea; clip it to `land`. */
  readonly regions: Map<number, MultiPolygon>;
}

/**
 * Re-cuts the land of one component among its cities along the ground. The straight
 * borders are rasterised, and the land within MAX_BORDER_MOVE_KM of one is handed out
 * again by a race on the raster: each province's claim spreads from the land it keeps,
 * and a cell goes to whichever claim reaches it at the lowest cost. A claim starts late
 * by its pair's meander. The cost is the distance, slowed or sped by a seeded noise,
 * plus a toll for each river crossed and for each metre climbed, and no claim crosses
 * the sea. The borders of the raster are then traced once, smoothed, and simplified, so
 * two provinces share each border point for point.
 */
export function recut(
  component: Polygon,
  territories: readonly Territory[],
  cities: ReadonlyMap<number, Point>,
  terrain: BorderTerrain,
): Recut {
  const grid = gridOver(boxOf([component]));
  const cells = grid.columns * grid.rows;
  const before = new Int16Array(cells).fill(OUTSIDE);
  for (const { owner, polygon } of territories) fill(grid, [polygon], owner, before);
  const land = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) if (before[i] !== OUTSIDE) land[i] = 1;

  const steps = new Uint16Array(cells);
  markCrossings(grid, ringSegments(component), steps, COAST_BITS);
  markCrossings(grid, lineSegments(terrain.rivers), steps, RIVER_BITS);

  const { distance: fromBorder, pair } = nearestBorder(grid, before, land, steps);
  const reach = new Map<number, number>();
  for (const { owner, polygon } of territories) {
    reach.set(owner, (reach.get(owner) ?? 0) + area([polygon]));
  }
  for (const [owner, size] of reach) {
    reach.set(owner, Math.min(MAX_BORDER_MOVE_KM, REACH_SHARE * Math.sqrt(size)));
  }
  const reachOf = (label: number) => reach.get(label) ?? MAX_BORDER_MOVE_KM;
  const labels = Int16Array.from(before);
  const keep = new Uint8Array(cells);
  const start = new Float32Array(cells).fill(Infinity);
  // Every claim starts as if from MAX_BORDER_MOVE_KM behind the border, so a province that
  // keeps land nearer the border gains nothing by it.
  const startOf = (i: number, label: number) => {
    const behind = Math.max(0, MAX_BORDER_MOVE_KM - (fromBorder[i] as number));
    const near = pair[i] as number;
    const low = near >> 10;
    const high = near & 1023;
    if (near < 0 || (label !== low && label !== high)) return behind + MEANDER_KM;
    const c = i % grid.columns;
    const r = (i - c) / grid.columns;
    const bend =
      (noise(grid.x(c), grid.y(r), MEANDER_OCTAVES, MEANDER_SEED + near) *
        Math.min(reachOf(low), reachOf(high))) /
      MAX_BORDER_MOVE_KM;
    return behind + MEANDER_KM * (1 + (label === low ? bend : -bend));
  };
  for (let i = 0; i < cells; i++) {
    const label = before[i] as number;
    if (land[i] && (fromBorder[i] as number) >= reachOf(label)) {
      keep[i] = 1;
      start[i] = startOf(i, label);
    }
  }
  const gate = Math.ceil(CITY_KEEP_KM / BORDER_CELL_KM);
  for (const [owner, [x, y]] of cities) {
    const [cc, cr] = grid.cellAt(x, y);
    for (let r = cr - gate; r <= cr + gate; r++) {
      for (let c = cc - gate; c <= cc + gate; c++) {
        if (c < 0 || r < 0 || c >= grid.columns || r >= grid.rows) continue;
        if (Math.hypot(grid.x(c) - x, grid.y(r) - y) > CITY_KEEP_KM) continue;
        const i = r * grid.columns + c;
        if (!land[i]) continue;
        keep[i] = 1;
        labels[i] = owner;
        start[i] = startOf(i, owner);
      }
    }
  }

  const mayTake = (label: number, i: number) => {
    const was = before[i] as number;
    return was === label || pair[i] === pairOf(was, label);
  };
  race(grid, terrain, land, keep, steps, start, labels, mayTake);
  settle(grid, land, keep, labels, mayTake);
  fillSea(grid, land, labels);

  const { edges, chains } = traceChains(grid, labels);
  const stitched = stitchCoast(chains, component, terrain.extent);
  const regions = new Map<number, MultiPolygon>();
  for (const [owner, polygons] of assemble(edges, chains)) {
    if (owner !== OUTSIDE) regions.set(owner, polygons);
  }
  return { land: stitched, regions };
}

class Grid {
  readonly left: number;
  readonly top: number;
  readonly columns: number;
  readonly rows: number;

  constructor(left: number, top: number, columns: number, rows: number) {
    this.left = left;
    this.top = top;
    this.columns = columns;
    this.rows = rows;
  }

  x(column: number): number {
    return this.left + (column + 0.5) * BORDER_CELL_KM;
  }

  y(row: number): number {
    return this.top + (row + 0.5) * BORDER_CELL_KM;
  }

  cellAt(x: number, y: number): [column: number, row: number] {
    return [
      Math.floor((x - this.left) / BORDER_CELL_KM),
      Math.floor((y - this.top) / BORDER_CELL_KM),
    ];
  }

  /** A corner of the cells, on the map's 0.1 km lattice. */
  corner(column: number, row: number): Point {
    return [round(this.left + column * BORDER_CELL_KM), round(this.top + row * BORDER_CELL_KM)];
  }
}

/** A margin of cells round the box, so every boundary of the land lies inside the raster. */
function gridOver(box: Box): Grid {
  const margin = 3 * BORDER_CELL_KM;
  const left = Math.floor((box.minX - margin) / BORDER_CELL_KM) * BORDER_CELL_KM;
  const top = Math.floor((box.minY - margin) / BORDER_CELL_KM) * BORDER_CELL_KM;
  const columns = Math.ceil((box.maxX + margin - left) / BORDER_CELL_KM);
  const rows = Math.ceil((box.maxY + margin - top) / BORDER_CELL_KM);
  return new Grid(left, top, columns, rows);
}

/** Sets every cell whose centre lies inside the polygons, by the even-odd rule. */
function fill(grid: Grid, polygons: MultiPolygon, value: number, into: Int16Array): void {
  const crossings = new Map<number, number[]>();
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let k = 0; k < ring.length; k++) {
        const [ax, ay] = ring[k] as Point;
        const [bx, by] = ring[(k + 1) % ring.length] as Point;
        if (ay === by) continue;
        const low = Math.min(ay, by);
        const high = Math.max(ay, by);
        const first = Math.max(0, Math.ceil((low - grid.top) / BORDER_CELL_KM - 0.5));
        const last = Math.min(grid.rows, Math.ceil((high - grid.top) / BORDER_CELL_KM - 0.5));
        for (let r = first; r < last; r++) {
          const y = grid.y(r);
          const x = ax + ((y - ay) * (bx - ax)) / (by - ay);
          let row = crossings.get(r);
          if (!row) crossings.set(r, (row = []));
          row.push(x);
        }
      }
    }
  }
  for (const [r, xs] of crossings) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(((xs[k] as number) - grid.left) / BORDER_CELL_KM - 0.5));
      const to = Math.min(
        grid.columns,
        Math.ceil(((xs[k + 1] as number) - grid.left) / BORDER_CELL_KM - 0.5),
      );
      into.fill(value, r * grid.columns + from, r * grid.columns + Math.max(from, to));
    }
  }
}

function* ringSegments(polygon: Polygon): Generator<[Point, Point]> {
  for (const ring of polygon) {
    for (let k = 0; k < ring.length; k++) {
      yield [ring[k] as Point, ring[(k + 1) % ring.length] as Point];
    }
  }
}

function* lineSegments(lines: readonly MapLine[]): Generator<[Point, Point]> {
  for (const line of lines) {
    for (let k = 0; k + 1 < line.length; k++) yield [line[k] as Point, line[k + 1] as Point];
  }
}

function orient([ax, ay]: Point, [bx, by]: Point, [cx, cy]: Point): number {
  return Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
}

/** Whether two closed segments meet. */
function meet(p: Point, q: Point, a: Point, b: Point): boolean {
  return orient(a, b, p) * orient(a, b, q) <= 0 && orient(p, q, a) * orient(p, q, b) <= 0;
}

/** Flags, for each cell, which of its forward steps cross one of the segments. */
function markCrossings(
  grid: Grid,
  segments: Iterable<[Point, Point]>,
  flags: Uint16Array,
  shift: number,
): void {
  for (const [a, b] of segments) {
    const [c0, r0] = grid.cellAt(Math.min(a[0], b[0]), Math.min(a[1], b[1]));
    const [c1, r1] = grid.cellAt(Math.max(a[0], b[0]), Math.max(a[1], b[1]));
    for (let r = Math.max(0, r0 - 2); r <= Math.min(grid.rows - 1, r1 + 2); r++) {
      for (let c = Math.max(0, c0 - 2); c <= Math.min(grid.columns - 1, c1 + 2); c++) {
        const from: Point = [grid.x(c), grid.y(r)];
        for (const [k, [dc, dr]] of FORWARD.entries()) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr >= grid.rows || nc >= grid.columns) continue;
          if (meet(from, [grid.x(nc), grid.y(nr)], a, b)) {
            const i = r * grid.columns + c;
            flags[i] = (flags[i] as number) | (1 << (shift + k));
          }
        }
      }
    }
  }
}

/**
 * Each step as a column offset, a row offset, the forward step whose flags it reads, and
 * whether those flags sit on the cell it steps to.
 */
const STEPS: readonly (readonly [dc: number, dr: number, bit: number, onNeighbour: boolean])[] =
  FORWARD.flatMap(([dc, dr], k) => [[dc, dr, k, false] as const, [-dc, -dr, k, true] as const]);
/** The eight cells round a cell, which is what borders it. */
const NEIGHBOURS = STEPS.filter(([dc, dr]) => Math.abs(dc) <= 1 && Math.abs(dr) <= 1);

function stepFlags(
  steps: Uint16Array,
  i: number,
  j: number,
  onNeighbour: boolean,
  bit: number,
): number {
  const flags = (onNeighbour ? steps[j] : steps[i]) as number;
  return ((flags >> (COAST_BITS + bit)) & 1) | (((flags >> (RIVER_BITS + bit)) & 1) << 1);
}

const BLOCKED = 1;
const RIVER = 2;

/**
 * For every cell, the distance in km to the nearest land cell that borders another
 * province across land, and that border's `pairOf`, or -1.
 */
function nearestBorder(
  grid: Grid,
  labels: Int16Array,
  land: Uint8Array,
  steps: Uint16Array,
): { distance: Float32Array; pair: Int32Array } {
  const { columns, rows } = grid;
  const distance = new Float32Array(columns * rows).fill(Infinity);
  const pair = new Int32Array(columns * rows).fill(-1);
  for (let i = 0; i < distance.length; i++) {
    if (!land[i]) continue;
    const c = i % columns;
    const r = (i - c) / columns;
    for (const [dc, dr, bit, onNeighbour] of NEIGHBOURS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue;
      const j = nr * columns + nc;
      const here = labels[i] as number;
      const there = labels[j] as number;
      if (!land[j] || there === here) continue;
      if (stepFlags(steps, i, j, onNeighbour, bit) & BLOCKED) continue;
      distance[i] = 0;
      pair[i] = pairOf(here, there);
      break;
    }
  }
  spread(grid, distance, pair);
  return { distance, pair };
}

/**
 * Lowers each cell's distance in km to the nearest cell with a finite one, by a
 * two-pass chamfer, and carries that cell's value with it.
 */
function spread(grid: Grid, d: Float32Array, carried: Int16Array | Int32Array): void {
  const { columns, rows } = grid;
  const straight = BORDER_CELL_KM;
  const diagonal = BORDER_CELL_KM * Math.SQRT2;
  const relax = (i: number, j: number, step: number) => {
    const via = (d[j] as number) + step;
    if (via < (d[i] as number)) {
      d[i] = via;
      carried[i] = carried[j] as number;
    }
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (c > 0) relax(i, i - 1, straight);
      if (r > 0) {
        relax(i, i - columns, straight);
        if (c > 0) relax(i, i - columns - 1, diagonal);
        if (c + 1 < columns) relax(i, i - columns + 1, diagonal);
      }
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = columns - 1; c >= 0; c--) {
      const i = r * columns + c;
      if (c + 1 < columns) relax(i, i + 1, straight);
      if (r + 1 < rows) {
        relax(i, i + columns, straight);
        if (c + 1 < columns) relax(i, i + columns + 1, diagonal);
        if (c > 0) relax(i, i + columns - 1, diagonal);
      }
    }
  }
}

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const top = hash(x0, y0, seed) * (1 - tx) + hash(x0 + 1, y0, seed) * tx;
  const bottom = hash(x0, y0 + 1, seed) * (1 - tx) + hash(x0 + 1, y0 + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Seeded noise over map km, from -1 to 1, the same wherever the raster starts. */
function noise(
  x: number,
  y: number,
  octaves: readonly (readonly [km: number, weight: number])[],
  seed: number,
): number {
  let sum = 0;
  for (const [k, [km, weight]] of octaves.entries()) {
    sum += weight * (2 * valueNoise(x / km, y / km, seed + k) - 1);
  }
  return sum;
}

/** A binary heap of cells by cost, which keeps stale entries and lets the reader skip them. */
class Queue {
  #costs = new Float64Array(1024);
  #cells = new Int32Array(1024);
  #size = 0;

  get size(): number {
    return this.#size;
  }

  push(cost: number, cell: number): void {
    if (this.#size === this.#costs.length) {
      const costs = new Float64Array(this.#size * 2);
      costs.set(this.#costs);
      this.#costs = costs;
      const cells = new Int32Array(this.#size * 2);
      cells.set(this.#cells);
      this.#cells = cells;
    }
    let k = this.#size++;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if ((this.#costs[parent] as number) <= cost) break;
      this.#costs[k] = this.#costs[parent] as number;
      this.#cells[k] = this.#cells[parent] as number;
      k = parent;
    }
    this.#costs[k] = cost;
    this.#cells[k] = cell;
  }

  /** The cheapest entry's cost and cell. */
  pop(): [number, number] {
    const top: [number, number] = [this.#costs[0] as number, this.#cells[0] as number];
    const size = --this.#size;
    const cost = this.#costs[size] as number;
    const cell = this.#cells[size] as number;
    let k = 0;
    for (;;) {
      let child = 2 * k + 1;
      if (child >= size) break;
      if (child + 1 < size && (this.#costs[child + 1] as number) < (this.#costs[child] as number)) {
        child++;
      }
      if ((this.#costs[child] as number) >= cost) break;
      this.#costs[k] = this.#costs[child] as number;
      this.#cells[k] = this.#cells[child] as number;
      k = child;
    }
    this.#costs[k] = cost;
    this.#cells[k] = cell;
    return top;
  }
}

/**
 * Hands each land cell that is not kept to the claim that reaches it at the lowest cost.
 * Kept cells start the claims at their `start` cost. A claim takes a cell only from the
 * province across that cell's nearest straight border, so land moves only between the two
 * provinces of a border and only as far as that border's reach. A cell no claim reaches
 * keeps its label.
 */
function race(
  grid: Grid,
  terrain: BorderTerrain,
  land: Uint8Array,
  keep: Uint8Array,
  steps: Uint16Array,
  start: Float32Array,
  labels: Int16Array,
  mayTake: (label: number, i: number) => boolean,
): void {
  const { columns, rows } = grid;
  const cells = columns * rows;
  const speed = new Float32Array(cells);
  const height = new Float32Array(cells);
  const cost = Float32Array.from(start);
  const queue = new Queue();
  const open = (i: number) => land[i] === 1 && keep[i] === 0;
  for (let i = 0; i < cells; i++) {
    if (!land[i]) continue;
    const c = i % columns;
    const r = (i - c) / columns;
    const near =
      !keep[i] ||
      STEPS.some(([dc, dr]) => {
        const nc = c + dc;
        const nr = r + dr;
        return nc >= 0 && nr >= 0 && nc < columns && nr < rows && open(nr * columns + nc);
      });
    if (!near) continue;
    const point: Point = [grid.x(c), grid.y(r)];
    speed[i] = Math.exp(WANDER * noise(point[0], point[1], WANDER_OCTAVES, WANDER_SEED));
    height[i] = Math.max(0, terrain.height(point));
    if (keep[i]) queue.push(cost[i] as number, i);
  }
  const lengths = STEPS.map(([dc, dr]) => Math.hypot(dc, dr) * BORDER_CELL_KM);
  while (queue.size > 0) {
    const [here, i] = queue.pop();
    if (here > (cost[i] as number)) continue;
    const c = i % columns;
    const r = (i - c) / columns;
    for (const [s, [dc, dr, bit, onNeighbour]] of STEPS.entries()) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue;
      const j = nr * columns + nc;
      if (!open(j) || !mayTake(labels[i] as number, j)) continue;
      const flags = stepFlags(steps, i, j, onNeighbour, bit);
      if (flags & BLOCKED) continue;
      const length = lengths[s] as number;
      const climb = Math.max(0, (height[j] as number) - (height[i] as number));
      // The noise slows the climb too: the heights are smooth across each 18 km cell of the
      // elevation grid, and a race that climbs at an even pace met them in ruled lines.
      const step =
        ((length + climb * CLIMB_KM_PER_M) * 2) / ((speed[i] as number) + (speed[j] as number)) +
        (flags & RIVER ? RIVER_CROSSING_KM : 0);
      // Stored as the cost array stores it, or a cost rounded down marks its own entry stale.
      const via = Math.fround(here + step);
      if (via < (cost[j] as number)) {
        cost[j] = via;
        labels[j] = labels[i] as number;
        queue.push(via, j);
      }
    }
  }
}

/**
 * Gives each cell that is not kept the label most of its block of nine holds, twice, so
 * a claim's one-cell fingers do not become hairs on the border.
 */
function settle(
  grid: Grid,
  land: Uint8Array,
  keep: Uint8Array,
  labels: Int16Array,
  mayTake: (label: number, i: number) => boolean,
): void {
  const { columns, rows } = grid;
  for (let pass = 0; pass < 2; pass++) {
    const was = Int16Array.from(labels);
    for (let r = 1; r + 1 < rows; r++) {
      for (let c = 1; c + 1 < columns; c++) {
        const i = r * columns + c;
        if (!land[i] || keep[i]) continue;
        const counts = new Map<number, number>();
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const j = i + dr * columns + dc;
            const label = was[j] as number;
            if (land[j] && mayTake(label, i)) counts.set(label, (counts.get(label) ?? 0) + 1);
          }
        }
        let best = was[i] as number;
        let most = counts.get(best) ?? 0;
        for (const [label, count] of counts) {
          if (count > most) {
            best = label;
            most = count;
          }
        }
        labels[i] = best;
      }
    }
  }
}

/** Labels every cell off the land with the label of the land cell nearest it. */
function fillSea(grid: Grid, land: Uint8Array, labels: Int16Array): void {
  const d = new Float32Array(grid.columns * grid.rows).fill(Infinity);
  for (let i = 0; i < d.length; i++) if (land[i]) d[i] = 0;
  spread(grid, d, labels);
}

/**
 * One boundary of the raster: a run of cell edges between two nodes, the corners where
 * three labels meet or two meet corner to corner, or a loop with no node. A directed edge
 * is an edge id times two plus its direction: 0 east or south, 1 west or north.
 */
interface Chain {
  /** The label on the left of the chain as it runs, in the frame where y grows south. */
  readonly left: number;
  readonly right: number;
  readonly first: number;
  readonly last: number;
  readonly closed: boolean;
  /** The corners the chain runs through. */
  readonly corners: Point[];
  /** The smoothed line, which both labels share. */
  points: Point[];
  /** Whether the line fell back to the plain midpoints of the steps. */
  plain: boolean;
}

class Edges {
  readonly grid: Grid;
  readonly labels: Int16Array;
  readonly horizontal: number;

  constructor(grid: Grid, labels: Int16Array) {
    this.grid = grid;
    this.labels = labels;
    this.horizontal = grid.columns * (grid.rows + 1);
  }

  get count(): number {
    return this.horizontal + (this.grid.columns + 1) * this.grid.rows;
  }

  label(c: number, r: number): number {
    const { columns, rows } = this.grid;
    return c < 0 || r < 0 || c >= columns || r >= rows
      ? OUTSIDE
      : (this.labels[r * columns + c] as number);
  }

  /** The directed edge leaving corner (c, r) towards (dc, dr), or -1 where there is no edge. */
  leaving(c: number, r: number, dc: number, dr: number): number {
    const { columns, rows } = this.grid;
    if (dc === 1) return c < columns ? 2 * (r * columns + c) : -1;
    if (dc === -1) return c > 0 ? 2 * (r * columns + c - 1) + 1 : -1;
    if (dr === 1) return r < rows ? 2 * (this.horizontal + r * (columns + 1) + c) : -1;
    return r > 0 ? 2 * (this.horizontal + (r - 1) * (columns + 1) + c) + 1 : -1;
  }

  /** The corner a directed edge leaves from and its direction. */
  from(directed: number): [c: number, r: number, dc: number, dr: number] {
    const { columns } = this.grid;
    const edge = directed >> 1;
    const backward = (directed & 1) === 1;
    if (edge < this.horizontal) {
      const c = edge % columns;
      const r = (edge - c) / columns;
      return backward ? [c + 1, r, -1, 0] : [c, r, 1, 0];
    }
    const k = edge - this.horizontal;
    const c = k % (columns + 1);
    const r = (k - c) / (columns + 1);
    return backward ? [c, r + 1, 0, -1] : [c, r, 0, 1];
  }

  /** The labels left and right of a directed edge. */
  sides(directed: number): [left: number, right: number] {
    const [c, r, dc, dr] = this.from(directed);
    if (dc === 1) return [this.label(c, r), this.label(c, r - 1)];
    if (dc === -1) return [this.label(c - 1, r - 1), this.label(c - 1, r)];
    if (dr === 1) return [this.label(c - 1, r), this.label(c, r)];
    return [this.label(c, r - 1), this.label(c - 1, r - 1)];
  }

  isBoundary(directed: number): boolean {
    if (directed < 0) return false;
    const [left, right] = this.sides(directed);
    return left !== right;
  }

  /** The boundary edges leaving a corner. */
  boundariesAt(c: number, r: number): number[] {
    const out: number[] = [];
    for (const [dc, dr] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const directed = this.leaving(c, r, dc, dr);
      if (this.isBoundary(directed)) out.push(directed);
    }
    return out;
  }

  /**
   * The boundary edge that keeps the left label on the left after arriving at a corner
   * along `directed`. Cells of one label that meet only corner to corner are apart, so a
   * region's outline never crosses itself.
   */
  next(directed: number): number {
    const [c, r, dc, dr] = this.from(directed);
    const ec = c + dc;
    const er = r + dr;
    const [label] = this.sides(directed);
    const nc = -dr;
    const nr = dc;
    const ahead = (sx: number, sy: number) =>
      this.label(ec + (sx > 0 ? 0 : -1), er + (sy > 0 ? 0 : -1));
    if (ahead(dc + nc, dr + nr) !== label) return this.leaving(ec, er, nc, nr);
    if (ahead(dc - nc, dr - nr) !== label) return this.leaving(ec, er, dc, dr);
    return this.leaving(ec, er, -nc, -nr);
  }
}

function traceChains(grid: Grid, labels: Int16Array): { edges: Edges; chains: Chain[] } {
  const edges = new Edges(grid, labels);
  const stride = grid.columns + 1;
  const visited = new Uint8Array(edges.count);
  const isNode = new Uint8Array(stride * (grid.rows + 1));
  for (let r = 0; r <= grid.rows; r++) {
    for (let c = 0; c <= grid.columns; c++) {
      if (edges.boundariesAt(c, r).length > 2) isNode[r * stride + c] = 1;
    }
  }
  const chains: Chain[] = [];
  const walk = (first: number): Chain => {
    const [c0, r0] = edges.from(first);
    const corners: Point[] = [grid.corner(c0, r0)];
    let directed = first;
    let closed = false;
    for (;;) {
      visited[directed >> 1] = 1;
      const [c, r, dc, dr] = edges.from(directed);
      const ec = c + dc;
      const er = r + dr;
      if (isNode[er * stride + ec]) {
        corners.push(grid.corner(ec, er));
        break;
      }
      if (ec === c0 && er === r0) {
        closed = true;
        break;
      }
      corners.push(grid.corner(ec, er));
      directed = edges.next(directed);
    }
    const [left, right] = edges.sides(first);
    return { left, right, first, last: directed, closed, corners, points: [], plain: false };
  };
  for (let r = 0; r <= grid.rows; r++) {
    for (let c = 0; c <= grid.columns; c++) {
      if (!isNode[r * stride + c]) continue;
      for (const directed of edges.boundariesAt(c, r)) {
        if (!visited[directed >> 1]) chains.push(walk(directed));
      }
    }
  }
  for (let edge = 0; edge < visited.length; edge++) {
    if (!visited[edge] && edges.isBoundary(2 * edge)) chains.push(walk(2 * edge));
  }
  for (const chain of chains) chain.points = smooth(chain.corners, chain.closed, SMOOTH_PASSES);
  untangle(chains);
  return { edges, chains };
}

/**
 * The midpoints of the raster's steps, averaged with a 1-2-1 kernel `passes` times, then
 * simplified and rounded to the map's lattice. The ends of an open chain stay.
 */
function smooth(corners: Point[], closed: boolean, passes: number): Point[] {
  const n = corners.length;
  const mids: Point[] = [];
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const a = corners[k] as Point;
    const b = corners[(k + 1) % n] as Point;
    mids.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  let points: Point[] = closed ? mids : [corners[0] as Point, ...mids, corners[n - 1] as Point];
  for (let pass = 0; pass < passes; pass++) {
    const m = points.length;
    const was = points;
    points = was.map((point, k) => {
      if (!closed && (k === 0 || k === m - 1)) return point;
      const before = was[(k - 1 + m) % m] as Point;
      const after = was[(k + 1) % m] as Point;
      return [(before[0] + 2 * point[0] + after[0]) / 4, (before[1] + 2 * point[1] + after[1]) / 4];
    });
  }
  points = points.map(([x, y]) => [
    x + TREMOR_KM * noise(x, y, TREMOR_OCTAVES, TREMOR_SEEDS[0]),
    y + TREMOR_KM * noise(x, y, TREMOR_OCTAVES, TREMOR_SEEDS[1]),
  ]);
  const simplified = passes === 0 ? points : closed ? simplifyLoop(points) : simplifyLine(points);
  const rounded: Point[] = [];
  for (const [x, y] of simplified) {
    const point: Point = [round(x), round(y)];
    const previous = rounded[rounded.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) rounded.push(point);
  }
  return rounded;
}

function simplifyLine(points: Point[]): Point[] {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const spans: [number, number][] = [[0, points.length - 1]];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [from, to] = span;
    const a = points[from] as Point;
    const b = points[to] as Point;
    let worst = -1;
    let worstDistance = BORDER_SIMPLIFY_KM;
    for (let k = from + 1; k < to; k++) {
      const d = segmentDistance(points[k] as Point, a, b);
      if (d > worstDistance) {
        worst = k;
        worstDistance = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      spans.push([from, worst], [worst, to]);
    }
  }
  return points.filter((_, k) => keep[k] === 1);
}

function simplifyLoop(points: Point[]): Point[] {
  const first = points[0] as Point;
  let far = 0;
  for (let k = 1; k < points.length; k++) {
    if (distance(first, points[k] as Point) > distance(first, points[far] as Point)) far = k;
  }
  if (far === 0) return points;
  const one = simplifyLine(points.slice(0, far + 1));
  const two = simplifyLine([...points.slice(far), first]);
  return [...one, ...two.slice(1, -1)];
}

function distance([ax, ay]: Point, [bx, by]: Point): number {
  return Math.hypot(bx - ax, by - ay);
}

function segmentDistance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const UNTANGLE_BUCKET_KM = 4;

/**
 * Smoothing moves a border by up to a cell, so two borders a cell apart can cross. Each
 * chain that crosses another, or itself, falls back to the plain midpoints of its steps,
 * which never cross, until none does.
 */
function untangle(chains: Chain[]): void {
  for (;;) {
    const tangled = crossingChains(chains);
    if (tangled.size === 0) return;
    let changed = false;
    for (const chain of tangled) {
      if (chain.plain) continue;
      chain.points = smooth(chain.corners, chain.closed, 0);
      chain.plain = true;
      changed = true;
    }
    if (!changed) throw new Error(`${tangled.size} borders still cross after untangling`);
  }
}

function crossingChains(chains: Chain[]): Set<Chain> {
  type Segment = { chain: Chain; a: Point; b: Point };
  const buckets = new Buckets<Segment>(UNTANGLE_BUCKET_KM);
  for (const chain of chains) {
    const { points } = chain;
    const count = chain.closed ? points.length : points.length - 1;
    for (let k = 0; k < count; k++) {
      const a = points[k] as Point;
      const b = points[(k + 1) % points.length] as Point;
      buckets.add(a, b, { chain, a, b });
    }
  }
  const tangled = new Set<Chain>();
  for (const bucket of buckets.cells) {
    for (let s = 0; s < bucket.length; s++) {
      const one = bucket[s] as Segment;
      for (let t = s + 1; t < bucket.length; t++) {
        const two = bucket[t] as Segment;
        if (cross(one.a, one.b, two.a, two.b)) {
          tangled.add(one.chain);
          tangled.add(two.chain);
        }
      }
    }
  }
  return tangled;
}

/** Whether two segments on the 0.1 km lattice share any point other than a common end. */
function cross(p: Point, q: Point, a: Point, b: Point): boolean {
  const [px, py, qx, qy, ax, ay, bx, by] = [p[0], p[1], q[0], q[1], a[0], a[1], b[0], b[1]].map(
    (v) => Math.round(v * 10),
  ) as [number, number, number, number, number, number, number, number];
  const side = (x0: number, y0: number, x1: number, y1: number, x: number, y: number) =>
    Math.sign((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0));
  const o1 = side(ax, ay, bx, by, px, py);
  const o2 = side(ax, ay, bx, by, qx, qy);
  const o3 = side(px, py, qx, qy, ax, ay);
  const o4 = side(px, py, qx, qy, bx, by);
  if (o1 === 0 && o2 === 0) {
    const along = (x: number, y: number) => (x - px) * (qx - px) + (y - py) * (qy - py);
    const length = along(qx, qy);
    const s = along(ax, ay);
    const t = along(bx, by);
    return Math.max(Math.min(s, t), 0) < Math.min(Math.max(s, t), length);
  }
  const shared =
    (px === ax && py === ay) ||
    (px === bx && py === by) ||
    (qx === ax && qy === ay) ||
    (qx === bx && qy === by);
  if (shared) return false;
  return o1 * o2 <= 0 && o3 * o4 <= 0;
}

/**
 * Each label's outline from the chains it lies left of, linked at the nodes by the same
 * turn rule the tracing used. A ring that runs clockwise on the page holds the label's
 * cells, and one that runs the other way is a hole.
 */
function assemble(edges: Edges, chains: Chain[]): Map<number, MultiPolygon> {
  type View = { chain: Chain; forward: boolean; start: number; end: number };
  const views = new Map<number, View>();
  const byLabel = new Map<number, View[]>();
  for (const chain of chains) {
    for (const forward of [true, false]) {
      const label = forward ? chain.left : chain.right;
      if (label === OUTSIDE) continue;
      const view: View = {
        chain,
        forward,
        start: forward ? chain.first : chain.last ^ 1,
        end: forward ? chain.last : chain.first ^ 1,
      };
      if (!chain.closed) views.set(view.start, view);
      let list = byLabel.get(label);
      if (!list) byLabel.set(label, (list = []));
      list.push(view);
    }
  }
  const regions = new Map<number, MultiPolygon>();
  for (const [label, list] of byLabel) {
    const used = new Set<View>();
    const outers: Ring[] = [];
    const holes: Ring[] = [];
    for (const view of list) {
      if (used.has(view)) continue;
      const ring: Point[] = [];
      let current: View | undefined = view;
      while (current && !used.has(current)) {
        used.add(current);
        const points = current.forward ? current.chain.points : [...current.chain.points].reverse();
        ring.push(...(current.chain.closed ? points : points.slice(0, -1)));
        if (current.chain.closed) break;
        current = views.get(edges.next(current.end));
      }
      if (ring.length < 3) continue;
      (signedArea(ring) > 0 ? outers : holes).push(ring);
    }
    const polygons: Polygon[] = outers.map((outer) => [outer]);
    for (const hole of holes) {
      const a = hole[0] as Point;
      const b = hole[1] as Point;
      const probe: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let home: Polygon | undefined;
      let homeArea = Infinity;
      for (const polygon of polygons) {
        const outer = polygon[0] as Ring;
        const size = Math.abs(signedArea(outer));
        if (size < homeArea && ringContains(outer, probe)) {
          home = polygon;
          homeArea = size;
        }
      }
      home?.push(hole);
    }
    regions.set(label, polygons);
  }
  return regions;
}

function signedArea(ring: Ring): number {
  let sum = 0;
  let [px, py] = ring[ring.length - 1] ?? [0, 0];
  for (const [x, y] of ring) {
    sum += px * y - x * py;
    px = x;
    py = y;
  }
  return sum / 2;
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

const STITCH_BUCKET_KM = 16;
const ON_EXTENT_KM = 0.01;
/** A border and the coast this close are made to meet, since rounding to the lattice cannot keep them apart. */
const STITCH_NEAR_KM = 0.15;

/** Items filed under the square buckets their segments' boxes cover. */
class Buckets<T> {
  readonly #size: number;
  readonly #cells = new Map<number, T[]>();

  constructor(size: number) {
    this.#size = size;
  }

  add(a: Point, b: Point, item: T): void {
    for (const key of this.#keys(a, b, 0)) {
      const cell = this.#cells.get(key);
      if (cell) cell.push(item);
      else this.#cells.set(key, [item]);
    }
  }

  near(a: Point, b: Point, margin: number): Set<T> {
    const found = new Set<T>();
    for (const key of this.#keys(a, b, margin)) {
      for (const item of this.#cells.get(key) ?? []) found.add(item);
    }
    return found;
  }

  get cells(): Iterable<T[]> {
    return this.#cells.values();
  }

  #keys(a: Point, b: Point, margin: number): number[] {
    const at = (value: number) => Math.floor(value / this.#size);
    const keys: number[] = [];
    for (let i = at(Math.min(a[0], b[0]) - margin); i <= at(Math.max(a[0], b[0]) + margin); i++) {
      for (let j = at(Math.min(a[1], b[1]) - margin); j <= at(Math.max(a[1], b[1]) + margin); j++) {
        keys.push(i * 100_000 + j);
      }
    }
    return keys;
  }
}

/**
 * Where a border crosses or nearly touches the coast, rounding to the lattice would leave
 * the two apart by up to 0.07 km, off the coastline that walls the paths, or would close a
 * sliver between them. So each crossing, rounded, goes into the border and the coast; each
 * border point near the coast goes into the coast; and each coast point near a border goes
 * into the border, so both lines run through every point where they meet.
 */
function stitchCoast(chains: Chain[], component: Polygon, extent: Ring): Polygon {
  type Coast = { a: Point; b: Point; added: { along: number; point: Point }[] };
  const coasts = new Buckets<Coast>(STITCH_BUCKET_KM);
  const rings = component.map((points) =>
    points.map((a, k): Coast | undefined => {
      const b = points[(k + 1) % points.length] as Point;
      const middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (distanceToRing(extent, middle) <= ON_EXTENT_KM) return undefined;
      const coast: Coast = { a, b, added: [] };
      coasts.add(a, b, coast);
      return coast;
    }),
  );
  const nearestCoast = (point: Point): Coast | undefined => {
    let best: Coast | undefined;
    let bestDistance = STITCH_NEAR_KM;
    for (const coast of coasts.near(point, point, STITCH_NEAR_KM)) {
      const d = segmentDistance(point, coast.a, coast.b);
      if (d < bestDistance) {
        best = coast;
        bestDistance = d;
      }
    }
    return best;
  };

  for (const chain of chains) {
    const { points } = chain;
    const count = chain.closed ? points.length : points.length - 1;
    const stitched: Point[] = [];
    for (let k = 0; k < count; k++) {
      const p = points[k] as Point;
      const q = points[(k + 1) % points.length] as Point;
      stitched.push(p);
      const crossings: { t: number; point: Point }[] = [];
      for (const coast of coasts.near(p, q, 0)) {
        const hit = crossing(p, q, coast.a, coast.b);
        if (!hit) continue;
        const point: Point = [round(hit.point[0]), round(hit.point[1])];
        crossings.push({ t: hit.t, point });
        coast.added.push({ along: hit.u, point });
      }
      for (const { point } of crossings.sort((x, y) => x.t - y.t)) stitched.push(point);
    }
    if (!chain.closed) stitched.push(points[points.length - 1] as Point);
    chain.points = distinct(stitched);
  }
  const onCoast = new Set<string>();
  for (const ring of rings) {
    for (const coast of ring) for (const { point } of coast?.added ?? []) onCoast.add(`${point}`);
  }
  for (const chain of chains) {
    for (const point of chain.points) {
      const coast = nearestCoast(point);
      if (!coast || onCoast.has(`${point}`)) continue;
      onCoast.add(`${point}`);
      coast.added.push({ along: along(point, coast.a, coast.b), point });
    }
  }

  const segments = new Buckets<{ chain: Chain; k: number }>(STITCH_BUCKET_KM);
  for (const chain of chains) {
    const count = chain.closed ? chain.points.length : chain.points.length - 1;
    for (let k = 0; k < count; k++) {
      const p = chain.points[k] as Point;
      const q = chain.points[(k + 1) % chain.points.length] as Point;
      segments.add(p, q, { chain, k });
    }
  }
  const into = new Map<Chain, Map<number, { t: number; point: Point }[]>>();
  for (const [r, points] of component.entries()) {
    for (const [k, vertex] of points.entries()) {
      const ring = rings[r] ?? [];
      if (!ring[k] && !ring[(k - 1 + points.length) % points.length]) continue;
      let nearest: { chain: Chain; k: number; t: number } | undefined;
      let nearestDistance = STITCH_NEAR_KM;
      for (const { chain, k: s } of segments.near(vertex, vertex, STITCH_NEAR_KM)) {
        const p = chain.points[s] as Point;
        const q = chain.points[(s + 1) % chain.points.length] as Point;
        const d = segmentDistance(vertex, p, q);
        if (d < nearestDistance) {
          nearest = { chain, k: s, t: along(vertex, p, q) };
          nearestDistance = d;
        }
      }
      if (!nearest || nearestDistance === 0) continue;
      let bySegment = into.get(nearest.chain);
      if (!bySegment) into.set(nearest.chain, (bySegment = new Map()));
      bySegment.set(nearest.k, [
        ...(bySegment.get(nearest.k) ?? []),
        { t: nearest.t, point: vertex },
      ]);
    }
  }
  for (const [chain, bySegment] of into) {
    chain.points = distinct(
      chain.points.flatMap((point, s) => [
        point,
        ...(bySegment.get(s) ?? []).sort((x, y) => x.t - y.t).map((e) => e.point),
      ]),
    );
  }

  const tangled = crossingChains(chains);
  if (tangled.size > 0) {
    throw new Error(
      `stitching the coast made borders cross: ${[...tangled].map((c) => `${c.left}|${c.right} at ${c.points[0]} plain ${c.plain} into ${into.has(c)}`).join('; ')}`,
    );
  }
  return component.map((points, r) =>
    distinct(
      points.flatMap((point, k) => {
        const extra = rings[r]?.[k]?.added ?? [];
        return [point, ...extra.sort((x, y) => x.along - y.along).map((e) => e.point)];
      }),
    ),
  );
}

/** How far along segment ab the foot of a point lies, from 0 to 1. */
function along([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  return length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
}

/** The points without repeats of the one before. */
function distinct(points: Point[]): Point[] {
  return points.filter((point, k) => {
    const before = points[k - 1];
    return !before || before[0] !== point[0] || before[1] !== point[1];
  });
}

/** Where segment pq crosses segment ab, at t along pq and u along ab. */
function crossing(
  p: Point,
  q: Point,
  a: Point,
  b: Point,
): { t: number; u: number; point: Point } | undefined {
  const rx = q[0] - p[0];
  const ry = q[1] - p[1];
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return undefined;
  const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / denominator;
  const u = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u >= 1) return undefined;
  return { t, u, point: [p[0] + t * rx, p[1] + t * ry] };
}

function distanceToRing(ring: Ring, point: Point): number {
  let best = Infinity;
  for (let k = 0; k < ring.length; k++) {
    best = Math.min(
      best,
      segmentDistance(point, ring[k] as Point, ring[(k + 1) % ring.length] as Point),
    );
  }
  return best;
}
