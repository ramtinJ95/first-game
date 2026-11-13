import type { MultiPolygon } from '../../sim/map.ts';

type Edge = readonly [number, number, number, number];

const BAND = 8;
const STRIP = 16;
/** Strips per band in a strip's key; the map is under 9,000 km wide. */
const BAND_ROW = 1024;
/** The side of a raster cell in km. */
const CELL = 4;
const OUTSIDE = 0;
const INSIDE = 1;
const EDGE = 2;
const DISTANCE_STEP = 2;
const DISTANCE_CELL = CELL * DISTANCE_STEP;
/** The most a distance can overstate, the diagonal of a distance cell. */
export const DISTANCE_ERROR = DISTANCE_CELL * Math.SQRT2;

/**
 * Answers "is this point inside?" and "how far is it from the edge?" for a set of
 * outlines, fast enough to ask for every candidate mark. A raster of 4 km cells holds
 * inside, outside, or edge for each cell, so only points in edge cells test the
 * polygons. Edges shared by two outlines of the set are not edges of the area, so the
 * seam between a named range and the unnamed mountains beside it does not show.
 */
export class AreaIndex {
  readonly #bands = new Map<number, Edge[]>();
  /** Each band's edges again, by the strips of `STRIP` km their x spans. */
  readonly #strips = new Map<number, Edge[]>();
  readonly #left: number;
  readonly #top: number;
  readonly #columns: number;
  readonly #rows: number;
  readonly #cells: Uint8Array;
  /** The cells a seam runs through or beside, which hold no single state on every row. */
  #seamCells: Uint8Array | undefined;
  readonly #distanceColumns: number;
  readonly #distanceRows: number;
  /** Distance from each cell's centre to the area's edge in km, up to the reach it was built for. */
  readonly #reach: number;
  /** Built on the first question about distance, since some indexes never get one. */
  #field: Float32Array | undefined;
  readonly bounds: { left: number; top: number; right: number; bottom: number };

  /**
   * `seams: false` treats every edge as an edge and skips the costly test for edges two
   * outlines share. Use it when only "inside?" is asked, as of the provinces' land.
   */
  constructor(outlines: readonly MultiPolygon[], reach = 0, { seams = true } = {}) {
    const edges: Edge[] = [];
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const outline of outlines) {
      for (const polygon of outline) {
        for (const ring of polygon) {
          for (let i = 0; i < ring.length; i++) {
            const [ax, ay] = ring[i] as readonly [number, number];
            const [bx, by] = ring[(i + 1) % ring.length] as readonly [number, number];
            edges.push([ax, ay, bx, by]);
            bounds.left = Math.min(bounds.left, ax);
            bounds.right = Math.max(bounds.right, ax);
            bounds.top = Math.min(bounds.top, ay);
            bounds.bottom = Math.max(bounds.bottom, ay);
          }
        }
      }
    }
    if (edges.length === 0) Object.assign(bounds, { left: 0, top: 0, right: 0, bottom: 0 });
    this.bounds = bounds;
    for (const edge of edges) {
      const [, ay, , by] = edge;
      if (ay === by) continue;
      const last = Math.floor(Math.max(ay, by) / BAND);
      const right = Math.floor(Math.max(edge[0], edge[2]) / STRIP);
      for (let b = Math.floor(Math.min(ay, by) / BAND); b <= last; b++) {
        let list = this.#bands.get(b);
        if (!list) this.#bands.set(b, (list = []));
        list.push(edge);
        for (let s = Math.floor(Math.min(edge[0], edge[2]) / STRIP); s <= right; s++) {
          let strip = this.#strips.get(b * BAND_ROW + s);
          if (!strip) this.#strips.set(b * BAND_ROW + s, (strip = []));
          strip.push(edge);
        }
      }
    }
    this.#left = Math.floor(bounds.left / CELL) * CELL;
    this.#top = Math.floor(bounds.top / CELL) * CELL;
    this.#columns = Math.ceil((bounds.right - this.#left) / CELL) + 1;
    this.#rows = Math.ceil((bounds.bottom - this.#top) / CELL) + 1;
    this.#cells = new Uint8Array(this.#columns * this.#rows);
    this.#distanceColumns = Math.ceil(this.#columns / DISTANCE_STEP);
    this.#distanceRows = Math.ceil(this.#rows / DISTANCE_STEP);
    this.#fillRows();
    for (const edge of edges) {
      if (!seams || this.#outer(edge)) this.#markEdge(edge, this.#cells, EDGE);
      else this.#markEdge(edge, (this.#seamCells ??= new Uint8Array(this.#cells.length)), 1);
    }
    this.#reach = reach;
  }

  /** Marks each cell inside or outside by its centre, one scan line per row of cells. */
  #fillRows() {
    for (let row = 0; row < this.#rows; row++) {
      const y = this.#top + (row + 0.5) * CELL;
      const crossings: number[] = [];
      for (const [ax, ay, bx, by] of this.#bands.get(Math.floor(y / BAND)) ?? []) {
        if (ay > y !== by > y) crossings.push(((bx - ax) * (y - ay)) / (by - ay) + ax);
      }
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.ceil(((crossings[k] as number) - this.#left) / CELL - 0.5));
        const to = Math.min(
          this.#columns - 1,
          Math.floor(((crossings[k + 1] as number) - this.#left) / CELL - 0.5),
        );
        this.#cells.fill(INSIDE, row * this.#columns + from, row * this.#columns + to + 1);
      }
    }
  }

  #outer([ax, ay, bx, by]: Edge): boolean {
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) return false;
    const nx = ((by - ay) / length) * 0.3;
    const ny = (-(bx - ax) / length) * 0.3;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    return !(this.#exact(mx + nx, my + ny) && this.#exact(mx - nx, my - ny));
  }

  #markEdge([ax, ay, bx, by]: Edge, cells: Uint8Array, value: number) {
    const steps = Math.max(1, Math.ceil((Math.hypot(bx - ax, by - ay) / CELL) * 2));
    for (let s = 0; s <= steps; s++) {
      const column = Math.floor((ax + ((bx - ax) * s) / steps - this.#left) / CELL);
      const row = Math.floor((ay + ((by - ay) * s) / steps - this.#top) / CELL);
      for (let j = row - 1; j <= row + 1; j++) {
        for (let i = column - 1; i <= column + 1; i++) {
          if (i >= 0 && j >= 0 && i < this.#columns && j < this.#rows) {
            cells[j * this.#columns + i] = value;
          }
        }
      }
    }
  }

  /**
   * A two-pass chamfer distance from the edge cells, in km, on a grid of DISTANCE_CELL
   * cells. A distance only sizes a drawing or keeps it off an edge, so the coarser grid
   * is enough and costs a quarter as much.
   */
  #distanceField(reach: number): Float32Array {
    if (reach <= 0) return new Float32Array(0);
    const w = this.#distanceColumns;
    const h = this.#distanceRows;
    const field = new Float32Array(w * h).fill(reach);
    for (let j = 0; j < this.#rows; j++) {
      for (let i = 0; i < this.#columns; i++) {
        if (this.#cells[j * this.#columns + i] === EDGE) {
          field[Math.floor(j / DISTANCE_STEP) * w + Math.floor(i / DISTANCE_STEP)] = 0;
        }
      }
    }
    const straight = DISTANCE_CELL;
    const diagonal = DISTANCE_CELL * Math.SQRT2;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        let d = field[k] as number;
        if (i > 0) d = Math.min(d, (field[k - 1] as number) + straight);
        if (j > 0) {
          d = Math.min(d, (field[k - w] as number) + straight);
          if (i > 0) d = Math.min(d, (field[k - w - 1] as number) + diagonal);
          if (i < w - 1) d = Math.min(d, (field[k - w + 1] as number) + diagonal);
        }
        field[k] = d;
      }
    }
    for (let j = h - 1; j >= 0; j--) {
      for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i;
        let d = field[k] as number;
        if (i < w - 1) d = Math.min(d, (field[k + 1] as number) + straight);
        if (j < h - 1) {
          d = Math.min(d, (field[k + w] as number) + straight);
          if (i < w - 1) d = Math.min(d, (field[k + w + 1] as number) + diagonal);
          if (i > 0) d = Math.min(d, (field[k + w - 1] as number) + diagonal);
        }
        field[k] = d;
      }
    }
    return field;
  }

  #distance(): Float32Array {
    this.#field ??= this.#distanceField(this.#reach);
    return this.#field;
  }

  #distanceCell(x: number, y: number): number {
    const i = Math.floor((x - this.#left) / DISTANCE_CELL);
    const j = Math.floor((y - this.#top) / DISTANCE_CELL);
    if (i < 0 || j < 0 || i >= this.#distanceColumns || j >= this.#distanceRows) return -1;
    return j * this.#distanceColumns + i;
  }

  #exact(x: number, y: number): boolean {
    const band = this.#bands.get(Math.floor(y / BAND));
    if (!band) return false;
    let inside = false;
    for (const [ax, ay, bx, by] of band) {
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  }

  /**
   * The point's state read from the nearest cell to its right that no edge or seam
   * touches, and the crossings between the two. A ray across the whole band crossed every
   * edge of a wavered desert in that band, thousands of short ones, for each point asked.
   */
  #near(x: number, y: number, column: number, row: number): boolean {
    const base = row * this.#columns;
    let k = column + 1;
    while (
      k < this.#columns &&
      (this.#cells[base + k] === EDGE || this.#seamCells?.[base + k] === 1)
    ) {
      k++;
    }
    const known = k < this.#columns && this.#cells[base + k] === INSIDE;
    const to = this.#left + (k + 0.5) * CELL;
    const band = Math.floor(y / BAND) * BAND_ROW;
    let inside = known;
    for (let b = Math.floor(x / STRIP); b <= Math.floor(to / STRIP); b++) {
      const from = Math.max(x, b * STRIP);
      const until = Math.min(to, (b + 1) * STRIP);
      for (const [ax, ay, bx, by] of this.#strips.get(band + b) ?? []) {
        if (ay > y === by > y) continue;
        const cross = ((bx - ax) * (y - ay)) / (by - ay) + ax;
        if (cross > from && cross <= until) inside = !inside;
      }
    }
    return inside;
  }

  #cell(x: number, y: number): number {
    const i = Math.floor((x - this.#left) / CELL);
    const j = Math.floor((y - this.#top) / CELL);
    if (i < 0 || j < 0 || i >= this.#columns || j >= this.#rows) return -1;
    return j * this.#columns + i;
  }

  inside(x: number, y: number): boolean {
    const k = this.#cell(x, y);
    if (k < 0) return false;
    const cell = this.#cells[k];
    if (cell === OUTSIDE) return false;
    if (cell === INSIDE) return true;
    return this.#near(x, y, k % this.#columns, Math.floor(k / this.#columns));
  }

  /**
   * Roughly how far the point lies from the area's edge on either side, up to the
   * reach. It can be up to `DISTANCE_ERROR` km more than the true distance.
   */
  distance(x: number, y: number): number {
    const k = this.#distanceCell(x, y);
    if (k < 0) return this.#reach > 0 ? Infinity : 0;
    return this.#distance()[k] ?? 0;
  }

  /**
   * The depth read between the centres of the distance cells, so it changes smoothly
   * from cell to cell instead of in steps of a cell. Rows of drawings laid along the
   * depth's contours need it.
   */
  smoothDepth(x: number, y: number): number {
    if (!this.inside(x, y)) return 0;
    const field = this.#distance();
    const fx = (x - this.#left) / DISTANCE_CELL - 0.5;
    const fy = (y - this.#top) / DISTANCE_CELL - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const at = (ci: number, cj: number) => {
      const c = Math.max(0, Math.min(this.#distanceColumns - 1, ci));
      const r = Math.max(0, Math.min(this.#distanceRows - 1, cj));
      return field[r * this.#distanceColumns + c] ?? 0;
    };
    const top = at(i, j) * (1 - tx) + at(i + 1, j) * tx;
    const bottom = at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  }

  /**
   * Roughly how far the point lies from the area's edge, in km, up to the reach the
   * index was built with. It is good to a cell, which is all a drawing's size needs.
   */
  depth(x: number, y: number): number {
    const k = this.#distanceCell(x, y);
    if (k < 0 || !this.inside(x, y)) return 0;
    return this.#distance()[k] ?? 0;
  }
}
