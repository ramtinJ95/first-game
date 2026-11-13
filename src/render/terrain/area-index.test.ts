import { describe, expect, it } from 'vitest';
import type { MultiPolygon, Point } from '../../sim/map.ts';
import { AreaIndex } from './area-index.ts';

/** The even-odd rule over every edge, the answer `inside` must give. */
function exact(outline: MultiPolygon, [x, y]: Point): boolean {
  let inside = false;
  for (const polygon of outline) {
    for (const ring of polygon) {
      ring.forEach(([ax, ay], i) => {
        const [bx, by] = ring[(i + 1) % ring.length] as Point;
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      });
    }
  }
  return inside;
}

/** A ring with its corners on the 16 km lines the index files its edges by, and many short edges. */
function zigzag(left: number, top: number, width: number, height: number): Point[] {
  const ring: Point[] = [];
  for (let x = left; x <= left + width; x += 4) ring.push([x, top + (x % 8 === 0 ? 0 : 3)]);
  for (let y = top; y <= top + height; y += 4) ring.push([left + width + (y % 8 === 0 ? 0 : 3), y]);
  for (let x = left + width; x >= left; x -= 4)
    ring.push([x, top + height + (x % 8 === 0 ? 0 : 3)]);
  for (let y = top + height; y >= top; y -= 4) ring.push([left + (y % 8 === 0 ? 0 : 3), y]);
  return ring;
}

describe('the area index', () => {
  it('answers a point beside an edge that starts on a strip line', () => {
    const square: MultiPolygon = [
      [
        [
          [0, 0],
          [16, 0],
          [16, 32],
          [0, 32],
        ],
      ],
    ];
    const index = new AreaIndex([square]);
    expect(index.inside(15, 12)).toBe(true);
    expect(index.inside(16.5, 12)).toBe(false);
  });

  it('agrees with the even-odd rule at every point near the edges of a jagged area with a hole', () => {
    const outline: MultiPolygon = [[zigzag(0, 0, 96, 64), zigzag(32, 16, 32, 32)]];
    const index = new AreaIndex([outline], 0, { seams: false });
    const wrong: string[] = [];
    for (let x = -4; x <= 104; x += 0.25) {
      for (let y = -4; y <= 72; y += 0.5) {
        if (index.inside(x, y) !== exact(outline, [x, y])) wrong.push(`${x},${y}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
