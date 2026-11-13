import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { parseMap, type MultiPolygon, type Point } from '../sim/map.ts';
import { landOutline } from './land-outline.ts';
import { AreaIndex } from './terrain/area-index.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../data/map/map.json'), 'utf8')),
);

function inside(outline: MultiPolygon, [x, y]: Point): boolean {
  let crossings = false;
  for (const ring of outline.flat()) {
    ring.forEach(([ax, ay], i) => {
      const [bx, by] = ring[(i + 1) % ring.length] as Point;
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) crossings = !crossings;
    });
  }
  return crossings;
}

it('covers the same land as the provinces, with none of the borders between them', () => {
  const outline = landOutline(map);
  const provinces = new AreaIndex(
    map.provinces.map((p) => p.outline),
    0,
    { seams: false },
  );
  const land = new AreaIndex([outline], 0, { seams: false });
  const differ: string[] = [];
  for (let x = 1.3; x < map.width; x += 7) {
    for (let y = 1.7; y < map.height; y += 7) {
      if (land.inside(x, y) !== provinces.inside(x, y)) differ.push(`${x},${y}`);
    }
  }
  expect(differ).toEqual([]);
  expect(map.provinces.filter((p) => !inside(outline, p.city)).map((p) => p.id)).toEqual([]);
  const coast = new Set(map.coastline.flat().map(([x, y]) => `${x},${y}`));
  const extent = map.extent;
  const onFrame = ([x, y]: Point) =>
    extent.some((a, i) => {
      const b = extent[(i + 1) % extent.length] as Point;
      const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      return Math.abs(cross) / Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.2;
    });
  const inland = outline.flat(2).filter((p) => !coast.has(`${p[0]},${p[1]}`) && !onFrame(p));
  expect(inland).toEqual([]);
});

it('keeps a lake two provinces enclose as a hole of their piece, and covers two pieces that touch at a corner', () => {
  const square = (x: number, y: number, size: number): Point[] => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ];
  const lake: Point[] = [
    [4, 4],
    [4, 6],
    [6, 6],
    [6, 4],
  ];
  const outline = landOutline({
    provinces: [
      { outline: [[square(0, 0, 10), lake]] },
      { outline: [[square(10, 0, 10)]] },
      { outline: [[square(20, 10, 5)]] },
    ],
  });
  const area = (ring: readonly Point[]) =>
    Math.abs(
      ring.reduce((sum, [ax, ay], i) => {
        const [bx, by] = ring[(i + 1) % ring.length] as Point;
        return sum + ax * by - bx * ay;
      }, 0) / 2,
    );
  const outer = outline.reduce((sum, [ring]) => sum + (ring ? area(ring) : 0), 0);
  const holes = outline.flatMap(([, ...rest]) => rest.map(area));
  expect(outer).toBe(225);
  expect(holes).toEqual([4]);
  expect(inside(outline, [5, 5])).toBe(false);
  expect(inside(outline, [15, 5])).toBe(true);
  expect(inside(outline, [22, 12])).toBe(true);
});
