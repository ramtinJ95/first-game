import type { Graphics } from 'pixi.js';
import type { MultiPolygon, Point } from '../sim/map.ts';

const keyOf = ([x, y]: Point) => `${x},${y}`;

function signedArea(ring: readonly Point[]): number {
  let sum = 0;
  ring.forEach(([ax, ay], i) => {
    const [bx, by] = ring[(i + 1) % ring.length] as Point;
    sum += ax * by - bx * ay;
  });
  return sum / 2;
}

function insideRing([x, y]: Point, ring: readonly Point[]): boolean {
  let inside = false;
  ring.forEach(([ax, ay], i) => {
    const [bx, by] = ring[(i + 1) % ring.length] as Point;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  });
  return inside;
}

/**
 * The land as one outline: the province edges that no other province shares, chained
 * into rings, each outer ring with the rings of the water it encloses. Every edge of a province is shared by exactly one other or lies on the coast
 * or the map's edge, so this is the coast and the frame, without the province borders.
 * A fill or a mask of it costs a fraction of one of every province, whose borders follow
 * the land and so hold three times the points of the coast.
 */
export function landOutline(map: {
  readonly provinces: readonly { readonly outline: MultiPolygon }[];
}): MultiPolygon {
  const uses = new Map<string, number>();
  const edges: [Point, Point][] = [];
  for (const province of map.provinces) {
    for (const polygon of province.outline) {
      for (const ring of polygon) {
        ring.forEach((a, i) => {
          const b = ring[(i + 1) % ring.length] as Point;
          if (keyOf(a) === keyOf(b)) return;
          edges.push([a, b]);
          const key = [keyOf(a), keyOf(b)].sort().join(' ');
          uses.set(key, (uses.get(key) ?? 0) + 1);
        });
      }
    }
  }
  const from = new Map<string, [Point, Point][]>();
  for (const edge of edges) {
    if (uses.get([keyOf(edge[0]), keyOf(edge[1])].sort().join(' ')) !== 1) continue;
    const list = from.get(keyOf(edge[0]));
    if (list) list.push(edge);
    else from.set(keyOf(edge[0]), [edge]);
  }
  const rings: Point[][] = [];
  for (const list of from.values()) {
    while (list.length > 0) {
      const ring: Point[] = [];
      let edge = list.pop();
      const start = edge ? keyOf(edge[0]) : '';
      while (edge) {
        ring.push(edge[0]);
        const end = keyOf(edge[1]);
        if (end === start) break;
        edge = from.get(end)?.pop();
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }
  const largest = rings.reduce((a, b) =>
    Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a,
  );
  const outerSign = Math.sign(signedArea(largest));
  const outers = rings.filter((ring) => Math.sign(signedArea(ring)) === outerSign);
  const pieces: Point[][][] = outers.map((outer) => [outer]);
  for (const hole of rings.filter((ring) => Math.sign(signedArea(ring)) !== outerSign)) {
    const around = outers
      .map((outer, i) => [outer, i] as const)
      .filter(([outer]) => insideRing(hole[0] as Point, outer))
      .sort(([a], [b]) => Math.abs(signedArea(a)) - Math.abs(signedArea(b)))[0];
    if (around) pieces[around[1]]?.push(hole);
  }
  return pieces;
}

/** Fills the land's outline into `g`, cutting out the water each piece encloses. */
export function fillLand(g: Graphics, outline: MultiPolygon, colour: number): Graphics {
  for (const [outer, ...holes] of outline) {
    if (!outer) continue;
    g.poly(outer.flat()).fill(colour);
    for (const hole of holes) g.poly(hole.flat()).cut();
  }
  return g;
}
