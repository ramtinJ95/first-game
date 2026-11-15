import { describe, expect, it } from 'vitest';
import type { MultiPolygon, Point } from '../../sim/map.ts';
import { AreaIndex } from './area-index.ts';

it('certifies uniform-cell spans without skipping a tiny enclosed water cut', () => {
  const outline: MultiPolygon = [
    [
      [
        [-16, -16],
        [48, -16],
        [48, 48],
        [-16, 48],
      ],
      [
        [15.2, 15.2],
        [15.21, 15.2],
        [15.21, 15.21],
        [15.2, 15.21],
      ],
    ],
  ];
  const index = new AreaIndex([outline], 0, { seams: false });
  expect(index.spanInside(1, 31, 10)).toBe(true);
  expect(index.spanInside(1, 31, 15.205)).toBe(false);
  expect(index.spanInside(31, 1, 15.205)).toBe(false);
  expect(index.spanInside(15.202, 15.208, 15.205, false)).toBe(true);
});

it('does not certify seam-marked cells as uniform with the default seam detection', () => {
  const outline: MultiPolygon = [
    [
      [
        [-16, -16],
        [48, -16],
        [48, 48],
        [-16, 48],
      ],
      [
        [15.2, 15.2],
        [15.21, 15.2],
        [15.21, 15.21],
        [15.2, 15.21],
      ],
    ],
  ];
  const index = new AreaIndex([outline]);
  expect(index.spanInside(1, 31, 10)).toBe(true);
  expect(index.spanInside(1, 31, 15.205)).toBe(false);
  expect(index.spanInside(31, 1, 15.205)).toBe(false);
});

it('checks the continuous thickness of a contact, including a horizontal water slit between its edges', () => {
  const outline: MultiPolygon = [
    [
      [
        [-10, -10],
        [20, -10],
        [20, 20],
        [-10, 20],
      ],
      [
        [-5, 0.2],
        [15, 0.2],
        [15, 0.25],
        [-5, 0.25],
      ],
    ],
  ];
  const index = new AreaIndex([outline], 0, { seams: false });
  expect(index.spanInside(0, 1, 0)).toBe(true);
  expect(index.spanInside(0, 1, 1)).toBe(true);
  expect(index.boxInside(0, 1, 0, 1)).toBe(false);
  expect(index.boxInside(0, 1, 0.3, 1)).toBe(true);
});

it('a conforming province seam does not split a solid contact strip', () => {
  const provinces: MultiPolygon[] = [
    [
      [
        [
          [-10, -10],
          [0, -10],
          [0, 20],
          [-10, 20],
        ],
      ],
    ],
    [
      [
        [
          [0, -10],
          [20, -10],
          [20, 20],
          [0, 20],
        ],
      ],
    ],
  ];
  const index = new AreaIndex(provinces, 0, { seams: false });
  expect(index.boxInside(-1, 1, 0, 1)).toBe(true);
});

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
  it('tests an entire contact across a subpixel inlet, and cancels shared province seams', () => {
    const box = (left: number, right: number): MultiPolygon => [
      [
        [
          [left, 0],
          [right, 0],
          [right, 16],
          [left, 16],
        ],
      ],
    ];
    const lake: MultiPolygon = [
      [
        box(0, 16)[0]?.[0] as Point[],
        [
          [8.02, 2],
          [8.04, 2],
          [8.04, 10],
          [8.02, 10],
        ],
      ],
    ];
    const shore = new AreaIndex([lake]);
    expect(shore.inside(1, 6)).toBe(true);
    expect(shore.inside(15, 6)).toBe(true);
    expect(shore.spanInside(1, 15, 6)).toBe(false);
    expect(shore.spanInside(1, 7, 6)).toBe(true);
    expect(shore.spanInside(-1, 17, 6, false)).toBe(false);
    expect(shore.spanInside(-1, 17, -1, false)).toBe(true);
    const provinces = new AreaIndex([box(0, 8), box(8, 16)]);
    expect(provinces.spanInside(1, 15, 6)).toBe(true);
  });

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

describe('segmentInside', () => {
  const box = (left: number, top: number, right: number, bottom: number): MultiPolygon => [
    [
      [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
      ],
    ],
  ];

  it('refuses a way across a strait narrower than any sampling step', () => {
    const index = new AreaIndex([box(0, 0, 30, 40), box(30.05, 0, 60, 40)], 0, { seams: false });
    expect(index.segmentInside(10, 20, 50, 20)).toBe(false);
    expect(index.segmentInside(10, 20, 25, 33)).toBe(true);
  });

  it('crosses a seam that two outlines share as one piece of land', () => {
    const index = new AreaIndex([box(0, 0, 30, 40), box(30, 0, 60, 40)]);
    expect(index.segmentInside(10, 20, 50, 21)).toBe(true);
  });

  it('crosses a corner where three outlines meet, as solid land', () => {
    const index = new AreaIndex([box(0, 0, 10, 10), box(10, 0, 20, 10), box(0, 10, 20, 20)]);
    expect(index.segmentInside(5, 5, 15, 15)).toBe(true);
  });

  it('refuses a way between two points of the shore across the water of a bay', () => {
    const bay: MultiPolygon = [
      [
        [
          [10, 0],
          [20, 0],
          [20, 20],
          [0, 20],
          [0, 10],
          [10, 10],
        ],
      ],
    ];
    const index = new AreaIndex([bay], 0, { seams: false });
    expect(index.segmentInside(10, 5, 5, 10)).toBe(false);
    expect(index.segmentInside(15, 5, 5, 15)).toBe(true);
  });

  it('refuses a way that leaves through a horizontal shore', () => {
    const index = new AreaIndex([box(0, 0, 40, 20), box(0, 20.05, 40, 40)], 0, { seams: false });
    expect(index.segmentInside(10, 10, 12, 30)).toBe(false);
  });
});
