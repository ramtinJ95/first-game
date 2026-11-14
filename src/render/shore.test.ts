import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseMap, type MultiPolygon, type Point, type Ring } from '../sim/map.ts';
import { buildWorld } from '../sim/world/world.ts';
import { provinceAt } from './pick.ts';
import { naturalCoast } from './coast.ts';
import { landOutline } from './land-outline.ts';
import { toPixels } from './lines.ts';
import { naturalShore } from './shore.ts';
import { distance, straightRun } from '../../scripts/coast-metrics.ts';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const lakes = map.terrain.filter((area) => area.kind === 'lake');

test('every inland water body, including each island shore, has no straight run over 3 km', () => {
  expect(lakes.length).toBeGreaterThan(20);
  for (const lake of lakes)
    for (const ring of naturalShore(lake.outline).flat()) {
      expect(straightRun(ring), lake.name || 'unnamed lake').toBeLessThanOrEqual(3);
    }
});

test('shore detailing is deterministic, keeps every geographic anchor, and stays within 0.6 km', () => {
  for (const lake of lakes) {
    const detailed = naturalShore(lake.outline);
    expect(detailed).toEqual(naturalShore(lake.outline));
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
    .flatMap((ring) => ring.map((a, i) => [a, ring[(i + 1) % ring.length] as Point] as const))
    .sort(([a, b], [c, d]) => Math.min(a[0], b[0]) - Math.min(c[0], d[0]));
  const problems: string[] = [];
  for (const [i, [a, b]] of edges.entries())
    for (let j = i + 1; j < edges.length; j++) {
      const [c, d] = edges[j] as (typeof edges)[number];
      if (Math.min(c[0], d[0]) > Math.max(a[0], b[0])) break;
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
  for (const lake of lakes) expect(topology(naturalShore(lake.outline)), lake.name).toEqual([]);
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
  for (const outline of [inlet, island]) expect(topology(naturalShore(outline))).toEqual([]);
});

test('sea coast keeps every control point in order, stays within 0.6 km, and has no straight run over 3.5 km', () => {
  const coast = naturalCoast(map);
  expect(naturalCoast(map)).toBe(coast);
  expect(coast.lines).toHaveLength(map.coastline.length);
  for (const [i, source] of map.coastline.entries()) {
    const line = coast.lines[i];
    if (!line) throw new Error(`missing coast ${i}`);
    let n = 0;
    let deviation = 0;
    for (let k = 1; k < source.length; k++) {
      const a = source[k - 1] as Point,
        b = source[k] as Point;
      expect(line[n]).toEqual(a);
      while (n < line.length - 1) {
        const point = line[++n] as Point;
        deviation = Math.max(deviation, distance(point, a, b));
        if (point[0] === b[0] && point[1] === b[1]) break;
      }
      expect(line[n]).toEqual(b);
    }
    expect(n).toBe(line.length - 1);
    expect(deviation, `coast ${i}`).toBeLessThanOrEqual(0.6);
    expect(straightRun(line, false), `coast ${i}`).toBeLessThanOrEqual(3.5);
    const pixels = toPixels(line, 4, 0.75);
    const drawn = Array.from({ length: pixels.length / 2 }, (_, n): Point => [
      (pixels[n * 2] as number) / 4,
      (pixels[n * 2 + 1] as number) / 4,
    ]);
    expect(straightRun(drawn, false), `drawn coast ${i}`).toBeLessThanOrEqual(3.5);
  }
});

test('sea shores do not cross themselves or islands, and frame-only edges stay identical', () => {
  const coast = naturalCoast(map);
  expect(topology(coast.land)).toEqual([]);
  const drawn = new Set(
    coast.land
      .flat()
      .flatMap((ring) =>
        ring.map((a, i) => `${a.join(',')} ${ring[(i + 1) % ring.length]?.join(',')}`),
      ),
  );
  const seaEdges = new Set(
    map.coastline.flatMap((line) =>
      line
        .slice(1)
        .flatMap((b, i) => [
          `${line[i]?.join(',')} ${b.join(',')}`,
          `${b.join(',')} ${line[i]?.join(',')}`,
        ]),
    ),
  );
  for (const ring of landOutline(map).flat())
    for (const [i, a] of ring.entries()) {
      const key = `${a.join(',')} ${ring[(i + 1) % ring.length]?.join(',')}`;
      if (!seaEdges.has(key)) expect(drawn.has(key), key).toBe(true);
    }
});

test('drawing a natural coast leaves navigation, harbours, province outlines and coastal hit tests identical', () => {
  const fresh = parseMap(JSON.parse(JSON.stringify(map)));
  const original = JSON.stringify(fresh);
  const before = buildWorld(fresh);
  const sample = fresh.coastline
    .flatMap((line) => line.filter((_, i) => i % 31 === 0))
    .flatMap(([x, y]) => [
      { x, y },
      { x: x + 0.5, y: y + 0.5 },
      { x: x - 0.5, y: y - 0.5 },
    ]);
  const hits = sample.map((p) => provinceAt(fresh, p));
  naturalCoast(fresh);
  const after = buildWorld(fresh);
  expect(JSON.stringify(fresh)).toBe(original);
  expect(after.mesh).toEqual(before.mesh);
  expect(after.harbours).toEqual(before.harbours);
  expect(sample.map((p) => provinceAt(fresh, p))).toEqual(hits);
});
