import { expect, test } from 'vitest';
import type { MapLine, MultiPolygon, Point, Ring } from '../../src/sim/map.ts';
import { MAX_BORDER_MOVE_KM } from './borders.ts';
import { area, contains, intersection } from './geometry.ts';
import { partition } from './provinces.ts';

const LAND: Ring = [
  [0, 0],
  [240, 0],
  [240, 120],
  [0, 120],
];
const EXTENT: Ring = [
  [-50, -50],
  [290, -50],
  [290, 170],
  [-50, 170],
];
/** Two cities whose straight border runs north to south at x = 120. */
const CITIES: Point[] = [
  [60, 60],
  [180, 60],
];

function cut(rivers: MapLine[] = []): MultiPolygon[] {
  return partition([[LAND]], CITIES, { rivers, height: () => 0, extent: EXTENT }).territories;
}

/** Where the border crosses each 2 km row, as the eastmost x of the western province. */
function borderXs(west: MultiPolygon): number[] {
  const xs: number[] = [];
  for (let y = 1; y < 120; y += 2) {
    let x = 0;
    while (x < 240 && contains(west, [x + 0.5, y])) x += 0.5;
    xs.push(x);
  }
  return xs;
}

test('a border with a river near it runs along the river', () => {
  const [west = []] = cut([
    [
      [134, -10],
      [134, 130],
    ],
  ]);
  const xs = borderXs(west);
  const onRiver = xs.filter((x) => Math.abs(x - 134) <= 3).length;
  expect(onRiver / xs.length).toBeGreaterThan(0.8);
});

test('a border with nothing near it wanders off the straight line, but no farther than the bound', () => {
  const [west = []] = cut();
  const xs = borderXs(west);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
  expect(xs.every((x) => Math.abs(x - 120) <= MAX_BORDER_MOVE_KM)).toBe(true);
});

test('the two provinces cover the land between them and share their border without gap or overlap', () => {
  const [west = [], east = []] = cut();
  expect(area(intersection(west, east))).toBeLessThan(1e-6);
  expect(area(west) + area(east)).toBeCloseTo(240 * 120, 3);
  expect(contains(west, CITIES[0] as Point) && contains(east, CITIES[1] as Point)).toBe(true);
});
