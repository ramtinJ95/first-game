import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseMap, type MultiPolygon, type Point, type Ring } from '../../sim/map.ts';
import { naturalLakeOutline } from './lake-shore.ts';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../../data/map/map.json', import.meta.url), 'utf8')),
);
const lakes = map.terrain.filter((area) => area.kind === 'lake');

function distance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Longest contiguous shore that stays within 20 m of one straight chord, not just edge length. */
function straightRun(ring: Ring): number {
  let longest = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point;
    const run = [a];
    let length = 0;
    for (let n = 1; n < ring.length; n++) {
      const b = ring[(i + n) % ring.length] as Point;
      const previous = run[run.length - 1] as Point;
      length += Math.hypot(b[0] - previous[0], b[1] - previous[1]);
      if (run.some((p) => distance(p, a, b) > 0.02)) break;
      longest = Math.max(longest, length);
      run.push(b);
    }
  }
  return longest;
}

test('every inland water body, including each island shore, has no straight run over 3 km', () => {
  expect(lakes.length).toBeGreaterThan(20);
  for (const lake of lakes)
    for (const ring of naturalLakeOutline(lake.outline).flat()) {
      expect(straightRun(ring), lake.name || 'unnamed lake').toBeLessThanOrEqual(3);
    }
});

test('shore detailing is deterministic, keeps every geographic anchor, and stays within 0.6 km', () => {
  for (const lake of lakes) {
    const detailed = naturalLakeOutline(lake.outline);
    expect(detailed).toEqual(naturalLakeOutline(lake.outline));
    lake.outline.forEach((polygon, p) =>
      polygon.forEach((source, r) => {
        const shore = detailed[p]?.[r];
        if (!shore) throw new Error(`missing shore: ${lake.name}/${p}/${r}`);
        for (const point of source) expect(shore).toContainEqual(point);
        for (const point of shore) {
          const nearest = Math.min(
            ...source.map((a, i) => distance(point, a, source[(i + 1) % source.length] as Point)),
          );
          expect(nearest, lake.name).toBeLessThanOrEqual(0.6);
        }
      }),
    );
  }
});

test('the map build retains the source bays of Tatta and two other lakes', () => {
  for (const [name, least] of [
    ['Lake Tuz', 50],
    ['Lake Urmia', 150],
    ['Lago di Garda', 40],
  ] as const) {
    const lake = lakes.find((area) => area.name === name);
    expect(lake?.outline.flat(2).length, name).toBeGreaterThan(least);
  }
});

function topology(outline: MultiPolygon): string[] {
  const orient = (a: Point, b: Point, p: Point) =>
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const edges = outline
    .flat()
    .flatMap((ring) => ring.map((a, i) => [a, ring[(i + 1) % ring.length] as Point] as const));
  const problems: string[] = [];
  for (const [i, [a, b]] of edges.entries())
    for (let j = i + 1; j < edges.length; j++) {
      const [c, d] = edges[j] as (typeof edges)[number];
      if (
        Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
        Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
        Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
        Math.max(c[1], d[1]) < Math.min(a[1], b[1])
      )
        continue;
      if (orient(a, b, c) * orient(a, b, d) < -1e-12 && orient(c, d, a) * orient(c, d, b) < -1e-12)
        problems.push(`crossing edges ${i}/${j}`);
    }
  const inside = ([x, y]: Point, ring: Ring) => {
    let found = false;
    for (const [i, [ax, ay]] of ring.entries()) {
      const [bx, by] = ring[(i + 1) % ring.length] as Point;
      if (ay > y !== by > y && x < ax + ((bx - ax) * (y - ay)) / (by - ay)) found = !found;
    }
    return found;
  };
  for (const [outer, ...holes] of outline) {
    if (!outer) throw new Error('shore lost its outer ring');
    for (const hole of holes)
      if (!hole.every((point) => inside(point, outer))) problems.push('island leaves its lake');
  }
  return problems;
}

test('all detailed lakes keep simple shores and contained islands, including narrow Geneva and Van inlets', () => {
  for (const lake of lakes)
    expect(topology(naturalLakeOutline(lake.outline)), lake.name).toEqual([]);
});

test('detail cannot bridge a narrow inlet or an island only 300 m from the outer shore', () => {
  const inlet: MultiPolygon = [
    [
      [
        [0, 0],
        [30, 0],
        [30, 8],
        [15, 8],
        [15, 0.3],
        [14.8, 0.3],
        [14.8, 8],
        [0, 8],
      ],
    ],
  ];
  const island: MultiPolygon = [
    [
      [
        [0, 0],
        [30, 0],
        [30, 12],
        [0, 12],
      ],
      [
        [12, 0.3],
        [18, 0.3],
        [18, 9],
        [12, 9],
      ],
    ],
  ];
  for (const outline of [inlet, island]) expect(topology(naturalLakeOutline(outline))).toEqual([]);
});
