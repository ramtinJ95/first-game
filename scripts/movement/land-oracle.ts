import type { GameMap, Point } from '../../src/sim/map.ts';
import type { MapPoint } from '../../src/sim/state/map-point.ts';

/** Slack for points that sit on the coast or between two provinces whose borders do not quite meet. */
const TOLERANCE_KM = 0.05;
const SAMPLE_KM = 1;
const CELL_KM = 40;

/**
 * Answers "is this on land?" from the province outlines alone, without the navigation
 * mesh, so tests and the experiment can check the mesh against the map itself.
 */
export class LandOracle {
  private readonly edges: [Point, Point][] = [];
  private readonly rings: {
    ring: Point[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }[] = [];
  private readonly buckets = new Map<number, number[]>();
  private readonly columns: number;

  constructor(map: GameMap) {
    this.columns = Math.ceil(map.width / CELL_KM) + 1;
    for (const province of map.provinces) {
      for (const polygon of province.outline) {
        for (const ring of polygon) {
          const xs = ring.map(([x]) => x);
          const ys = ring.map(([, y]) => y);
          this.rings.push({
            ring,
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys),
          });
          for (let i = 0; i < ring.length; i += 1) {
            const edge: [Point, Point] = [ring[i] as Point, ring[(i + 1) % ring.length] as Point];
            const id = this.edges.length;
            this.edges.push(edge);
            for (const cell of this.cellsAlong(edge[0], edge[1])) {
              const list = this.buckets.get(cell) ?? [];
              list.push(id);
              this.buckets.set(cell, list);
            }
          }
        }
      }
    }
  }

  /** Inside a province, or within the tolerance of a province's outline. */
  pointOnLand(p: MapPoint): boolean {
    return this.insideProvince(p) || this.nearOutline(p);
  }

  /** Off every province, or within the tolerance of the coast. */
  pointAtSea(p: MapPoint): boolean {
    return !this.insideProvince(p) || this.nearOutline(p);
  }

  /** Every point along the segment, one kilometre apart, is at sea. */
  segmentAtSea(a: MapPoint, b: MapPoint): boolean {
    return this.sample(a, b).every((p) => this.pointAtSea(p));
  }

  private insideProvince(p: MapPoint): boolean {
    let crossings = 0;
    for (const { ring, minX, maxX, minY, maxY } of this.rings) {
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i] as Point;
        const [xj, yj] = ring[j] as Point;
        if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)
          inside = !inside;
      }
      if (inside) crossings += 1;
    }
    return crossings > 0;
  }

  /** Every point along the segment, one kilometre apart, is on land. */
  segmentOnLand(a: MapPoint, b: MapPoint): boolean {
    return this.sample(a, b).every((p) => this.pointOnLand(p));
  }

  private sample(a: MapPoint, b: MapPoint): MapPoint[] {
    const length = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    const steps = Math.max(1, Math.ceil(length / SAMPLE_KM));
    return Array.from({ length: steps + 1 }, (_, i) => ({
      x: a.x + ((b.x - a.x) * i) / steps,
      y: a.y + ((b.y - a.y) * i) / steps,
    }));
  }

  private nearOutline(p: MapPoint): boolean {
    const cell = Math.floor(p.y / CELL_KM) * this.columns + Math.floor(p.x / CELL_KM);
    for (const id of this.buckets.get(cell) ?? []) {
      const [[ax, ay], [bx, by]] = this.edges[id] as [Point, Point];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1)),
      );
      const ex = ax + dx * t - p.x;
      const ey = ay + dy * t - p.y;
      if (ex * ex + ey * ey <= TOLERANCE_KM * TOLERANCE_KM) return true;
    }
    return false;
  }

  private cellsAlong(a: Point, b: Point): number[] {
    const pad = TOLERANCE_KM;
    const c0 = Math.floor((Math.min(a[0], b[0]) - pad) / CELL_KM);
    const c1 = Math.floor((Math.max(a[0], b[0]) + pad) / CELL_KM);
    const r0 = Math.floor((Math.min(a[1], b[1]) - pad) / CELL_KM);
    const r1 = Math.floor((Math.max(a[1], b[1]) + pad) / CELL_KM);
    const cells: number[] = [];
    for (let r = r0; r <= r1; r += 1)
      for (let c = c0; c <= c1; c += 1) cells.push(r * this.columns + c);
    return cells;
  }
}
