import type { MultiPolygon, Point, TerrainArea } from '../../sim/map.ts';
import { AreaIndex } from './area-index.ts';
import { hash01 } from './random.ts';

/**
 * The map's desert outlines are coarse polygons whose edges run straight for hundreds
 * of km. Each edge longer than `step` km is bent at its middle, square to it, by `ratio`
 * of its length, at most `most` km, and each half is bent again in the same way, so a
 * long edge wanders at every scale and a short, detailed one barely moves. A bend is
 * at least `least` of its full size, so no stretch runs straight by chance, and it is
 * `held` clear of the outlines' other edges. The bend fades in from `coastKm[0]` to
 * `coastKm[1]` from the coast and the map's frame, so a desert that meets the sea or the
 * frame still meets it.
 */
export const WAVER = {
  kinds: ['desert'] as readonly TerrainArea['kind'][],
  step: 2,
  ratio: 0.2,
  most: 14,
  least: 0.4,
  coastKm: [6, 30],
} as const;

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** An edge of an original outline from its lower end, its direction and normal, and what it bends round. */
interface Edge {
  readonly from: Point;
  readonly along: Point;
  readonly normal: Point;
  readonly length: number;
  readonly coast: AreaIndex;
  /** Every area of the edge's kind, each indexed alone, so a seam between two is an edge. */
  readonly areas: readonly AreaIndex[];
}

/**
 * How far from (x, y) along (nx, ny) the next edge of any area lies, up to `reach` km,
 * read finely near the start, where the other edge of a sharp corner runs close.
 */
function clearance(
  x: number,
  y: number,
  nx: number,
  ny: number,
  reach: number,
  areas: readonly AreaIndex[],
): number {
  const ex = x + nx * reach;
  const ey = y + ny * reach;
  const near = areas.filter(
    ({ bounds }) =>
      Math.max(x, ex) >= bounds.left &&
      Math.min(x, ex) <= bounds.right &&
      Math.max(y, ey) >= bounds.top &&
      Math.min(y, ey) <= bounds.bottom,
  );
  const start = near.map((area) => area.inside(x + nx * 0.05, y + ny * 0.05));
  for (let t = 0.25; t < reach; t += t < 2 ? 0.25 : 1) {
    const px = x + nx * t;
    const py = y + ny * t;
    if (near.some((area, i) => area.inside(px, py) !== start[i])) return t;
  }
  return Infinity;
}

/**
 * The point moved back towards its original edge until it lies at most a third of the
 * way to the next edge on its side, and within half its distance from the nearer end of
 * the edge. Both edges of a narrow neck or a sharp corner keep to their own third, and
 * the corner itself stays sharp, so they never meet.
 */
function held([x, y]: Point, edge: Edge): Point {
  const [ex, ey] = edge.along;
  const [nx, ny] = edge.normal;
  const wx = x - edge.from[0];
  const wy = y - edge.from[1];
  const h = wx * nx + wy * ny;
  if (h === 0) return [x, y];
  const s = wx * ex + wy * ey;
  const side = Math.sign(h);
  const fx = edge.from[0] + ex * s;
  const fy = edge.from[1] + ey * s;
  const limit = Math.min(
    clearance(fx, fy, nx * side, ny * side, 3 * Math.abs(h) + 1, edge.areas) / 3,
    Math.max(0, Math.min(s, edge.length - s)) / 2,
  );
  if (Math.abs(h) <= limit) return [x, y];
  const back = h - side * limit;
  return [x - nx * back, y - ny * back];
}

/**
 * The points that bend the stretch from `a` to `b`, a `span` km share of its original
 * edge, without its ends. Each bend is drawn from the midpoint's position, so an edge
 * two deserts share bends alike.
 */
function bend(a: Point, b: Point, span: number, edge: Edge, into: Point[]): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (span <= WAVER.step || length === 0) return;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const u = 2 * hash01(Math.round(mx * 16), Math.round(my * 16), 1201) - 1;
  const size = Math.min(WAVER.most, WAVER.ratio * span);
  const fade = smoothstep(WAVER.coastKm[0], WAVER.coastKm[1], edge.coast.smoothDepth(mx, my));
  const off = size * fade * (WAVER.least + (1 - WAVER.least) * Math.abs(u)) * Math.sign(u);
  const m = held([mx - (dy / length) * off, my + (dx / length) * off], edge);
  bend(a, m, span / 2, edge, into);
  into.push(m);
  bend(m, b, span / 2, edge, into);
}

/** A ring with each edge bent from its lower end, so an edge two rings share bends alike. */
function waverRing(ring: readonly Point[], coast: AreaIndex, areas: readonly AreaIndex[]): Point[] {
  return ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length] as Point;
    const flip = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
    const [from, to] = flip ? [b, a] : [a, b];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) return [a];
    const ex = (to[0] - from[0]) / length;
    const ey = (to[1] - from[1]) / length;
    const edge: Edge = { from, along: [ex, ey], normal: [-ey, ex], length, coast, areas };
    const between: Point[] = [];
    bend(from, to, length, edge, between);
    return [a, ...(flip ? between.reverse() : between)];
  });
}

/**
 * The terrain areas as the map draws them, with the outline of each kind in `WAVER.kinds`
 * wavered. The ground, the marks, the tint, and the washes all read these outlines.
 */
export function drawnTerrain(
  terrain: readonly TerrainArea[],
  coast: AreaIndex,
): readonly TerrainArea[] {
  const indexes = new Map(
    WAVER.kinds.map((kind) => [
      kind,
      terrain
        .filter((area) => area.kind === kind)
        .map((area) => new AreaIndex([area.outline], 0, { seams: false })),
    ]),
  );
  return terrain.map((area) => {
    const areas = indexes.get(area.kind);
    if (!areas) return area;
    return {
      ...area,
      outline: area.outline.map((polygon) =>
        polygon.map((ring) => waverRing(ring, coast, areas)),
      ) as MultiPolygon,
    };
  });
}
