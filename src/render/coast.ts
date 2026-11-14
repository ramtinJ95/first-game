import type { GameMap, MapLine, MultiPolygon, Point } from '../sim/map.ts';
import { landOutline } from './land-outline.ts';
import { naturalShore } from './shore.ts';

export interface Coast {
  readonly land: MultiPolygon;
  readonly lines: MapLine[];
}

const key = (a: Point, b: Point) => `${a.join(',')} ${b.join(',')}`;
const known = new WeakMap<GameMap, Coast>();

/** Built only on entering close detail. Nothing is written back into the game map. */
export function naturalCoast(map: GameMap): Coast {
  const cached = known.get(map);
  if (cached) return cached;
  const source = landOutline(map);
  const seaEdges = new Set(
    map.coastline.flatMap((line) =>
      line.slice(1).flatMap((b, i) => [key(line[i] as Point, b), key(b, line[i] as Point)]),
    ),
  );
  const land = naturalShore(source, { sea: true, fixed: (a, b) => !seaEdges.has(key(a, b)) });
  const segments = new Map<string, Point[]>();
  source.forEach((polygon, p) =>
    polygon.forEach((ring, r) => {
      const detailed = land[p]?.[r];
      if (!detailed) throw new Error('detailed coast lost a land ring');
      const anchors = new Set(ring);
      let start = detailed[0] as Point;
      let segment = [start];
      for (const point of [...detailed.slice(1), start]) {
        segment.push(point);
        if (!anchors.has(point)) continue;
        segments.set(key(start, point), segment);
        segments.set(key(point, start), [...segment].reverse());
        start = point;
        segment = [point];
      }
    }),
  );
  const lines = map.coastline.map((line) => {
    const result = [line[0] as Point];
    for (let i = 1; i < line.length; i++) {
      const segment = segments.get(key(line[i - 1] as Point, line[i] as Point));
      if (!segment)
        throw new Error(
          `coast edge missing from land: ${key(line[i - 1] as Point, line[i] as Point)}`,
        );
      result.push(...segment.slice(1));
    }
    return result;
  });
  const coast = { land, lines };
  known.set(map, coast);
  return coast;
}
