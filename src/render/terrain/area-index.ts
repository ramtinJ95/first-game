import type { MultiPolygon } from '../../sim/map.ts';

type Edge = readonly [number, number, number, number];

const BAND = 8;
/** The side of a raster cell in km. */
const CELL = 4;
const OUTSIDE = 0;
const INSIDE = 1;
const EDGE = 2;

/**
 * Answers "is this point inside?" and "how far is it from the edge?" for a set of
 * outlines, fast enough to ask for every candidate mark. A raster of 4 km cells holds
 * inside, outside, or edge for each cell, so only points in edge cells test the
 * polygons. Edges shared by two outlines of the set are not edges of the area, so the
 * seam between a named range and the unnamed mountains beside it does not show.
 */
export class AreaIndex {
  readonly #bands = new Map<number, Edge[]>();
  readonly #left: number;
  readonly #top: number;
  readonly #columns: number;
  readonly #rows: number;
  readonly #cells: Uint8Array;
  /** Distance from each cell's centre to the area's edge in km, up to the reach it was built for. */
  readonly #distance: Float32Array;
  readonly bounds: { left: number; top: number; right: number; bottom: number };

  constructor(outlines: readonly MultiPolygon[], reach = 0) {
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
      for (let b = Math.floor(Math.min(ay, by) / BAND); b <= last; b++) {
        let list = this.#bands.get(b);
        if (!list) this.#bands.set(b, (list = []));
        list.push(edge);
      }
    }
    this.#left = Math.floor(bounds.left / CELL) * CELL;
    this.#top = Math.floor(bounds.top / CELL) * CELL;
    this.#columns = Math.ceil((bounds.right - this.#left) / CELL) + 1;
    this.#rows = Math.ceil((bounds.bottom - this.#top) / CELL) + 1;
    this.#cells = new Uint8Array(this.#columns * this.#rows);
    this.#fillRows();
    for (const edge of edges) {
      if (this.#outer(edge)) this.#markEdge(edge);
    }
    this.#distance = this.#distanceField(reach);
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

  #markEdge([ax, ay, bx, by]: Edge) {
    const steps = Math.max(1, Math.ceil((Math.hypot(bx - ax, by - ay) / CELL) * 2));
    for (let s = 0; s <= steps; s++) {
      const column = Math.floor((ax + ((bx - ax) * s) / steps - this.#left) / CELL);
      const row = Math.floor((ay + ((by - ay) * s) / steps - this.#top) / CELL);
      for (let j = row - 1; j <= row + 1; j++) {
        for (let i = column - 1; i <= column + 1; i++) {
          if (i >= 0 && j >= 0 && i < this.#columns && j < this.#rows) {
            this.#cells[j * this.#columns + i] = EDGE;
          }
        }
      }
    }
  }

  /** A two-pass chamfer distance from the edge cells, in km. */
  #distanceField(reach: number): Float32Array {
    if (reach <= 0) return new Float32Array(0);
    const { length } = this.#cells;
    const field = new Float32Array(length);
    for (let k = 0; k < length; k++) field[k] = this.#cells[k] === EDGE ? 0 : reach;
    const w = this.#columns;
    const straight = CELL;
    const diagonal = CELL * Math.SQRT2;
    const relax = (k: number, other: number, step: number) => {
      const via = (field[other] as number) + step;
      if (via < (field[k] as number)) field[k] = via;
    };
    for (let j = 0; j < this.#rows; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (i > 0) relax(k, k - 1, straight);
        if (j > 0) {
          relax(k, k - w, straight);
          if (i > 0) relax(k, k - w - 1, diagonal);
          if (i < w - 1) relax(k, k - w + 1, diagonal);
        }
      }
    }
    for (let j = this.#rows - 1; j >= 0; j--) {
      for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i;
        if (i < w - 1) relax(k, k + 1, straight);
        if (j < this.#rows - 1) {
          relax(k, k + w, straight);
          if (i < w - 1) relax(k, k + w + 1, diagonal);
          if (i > 0) relax(k, k + w - 1, diagonal);
        }
      }
    }
    return field;
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
    return this.#exact(x, y);
  }

  /** Roughly how far the point lies from the area's edge on either side, up to the reach. */
  distance(x: number, y: number): number {
    const k = this.#cell(x, y);
    if (k < 0) return this.#distance.length > 0 ? Infinity : 0;
    return this.#distance[k] ?? 0;
  }

  /**
   * Roughly how far the point lies from the area's edge, in km, up to the reach the
   * index was built with. It is good to a cell, which is all a drawing's size needs.
   */
  depth(x: number, y: number): number {
    const k = this.#cell(x, y);
    if (k < 0 || !this.inside(x, y)) return 0;
    return this.#distance[k] ?? 0;
  }
}
