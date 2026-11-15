import drawing from '../../data/map/drawing-coast.json' with { type: 'json' };
import type { GameMap, MultiPolygon, Point } from '../sim/map.ts';
import { coastKey } from './coast-key.ts';
import { AreaIndex } from './terrain/area-index.ts';

const checked = new WeakSet<GameMap>();
let index: AreaIndex | undefined;
let coast: { land: MultiPolygon; lines: Point[][] } | undefined;
export const ATLAS_COAST_SCALE = 0.6;

/** One prebuilt source for paper, masks, coast ink, water lines and occupied ground. */
export function atlasCoast(map: GameMap) {
  if (!checked.has(map)) {
    if (coastKey(map) !== drawing.physicalKey)
      throw new Error('Drawing coast is stale: run node scripts/map/build-coast.ts');
    checked.add(map);
  }
  if (!coast) {
    const land: MultiPolygon = drawing.land.map((polygon) =>
      polygon.map((steps) => {
        const ring: Point[] = [];
        let x = 0,
          y = 0;
        for (let i = 0; i < steps.length; i += 2) {
          x += steps[i] as number;
          y += steps[i + 1] as number;
          ring.push([x * drawing.unitKm, y * drawing.unitKm]);
        }
        return ring;
      }),
    );
    const rings = land.flat();
    coast = {
      land,
      lines: drawing.runs.map(([r, start, end]) => {
        const ring = rings[r as number];
        if (!ring || start === undefined || end === undefined)
          throw new Error('Invalid drawing coast run');
        return Array.from(
          { length: end - start + 1 },
          (_, i) => ring[(start + i) % ring.length] as Point,
        );
      }),
    };
  }
  return coast;
}

export function atlasLand(map: GameMap): AreaIndex {
  const { land } = atlasCoast(map);
  index ??= new AreaIndex([land], 0, { seams: false });
  return index;
}
