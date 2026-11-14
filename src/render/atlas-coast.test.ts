import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import drawing from '../../data/map/drawing-coast.json' with { type: 'json' };
import { parseMap, type Point, type MultiPolygon } from '../sim/map.ts';
import { buildWorld } from '../sim/world/world.ts';
import { atlasCoast, atlasLand } from './atlas-coast.ts';
import { landOutline } from './land-outline.ts';
import { provinceAt } from './pick.ts';
import { CoastDistance, coastSamples, SAMPLE_KM } from '../../scripts/coast-shapes-metrics.ts';
import { contains, intersection } from '../../scripts/map/geometry.ts';

const bytes = readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8');
const map = parseMap(JSON.parse(bytes));

test('atlas drawing leaves serialized map, outlines, navigation, harbours and coast picking unchanged', () => {
  const fresh = parseMap(JSON.parse(bytes));
  const serialized = JSON.stringify(fresh);
  const outlines = JSON.stringify(fresh.provinces.map((p) => p.outline));
  const before = buildWorld(fresh);
  const samples = fresh.coastline
    .flatMap((line) => line.filter((_, i) => i % 13 === 0))
    .flatMap(([x, y]) => [
      { x, y },
      { x: x + 0.5, y: y + 0.5 },
      { x: x - 0.5, y: y - 0.5 },
    ]);
  const hits = samples.map((p) => provinceAt(fresh, p));
  expect(atlasCoast(fresh)).toBe(atlasCoast(fresh));
  atlasLand(fresh);
  const after = buildWorld(fresh);
  expect(JSON.stringify(fresh)).toBe(serialized);
  expect(JSON.stringify(fresh.provinces.map((p) => p.outline))).toBe(outlines);
  expect(after.mesh).toEqual(before.mesh);
  expect(after.harbours).toEqual(before.harbours);
  expect(samples.map((p) => provinceAt(fresh, p))).toEqual(hits);
  expect(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')).toBe(bytes);
});

test('a different physical world explicitly refuses a stale drawing asset, even after indexing', () => {
  const different = parseMap(JSON.parse(bytes));
  const point = different.coastline[0]?.[0];
  if (!point) throw new Error('missing first coast point');
  point[0] += 0.1;
  expect(() => atlasCoast(different)).toThrow('Drawing coast is stale');
  expect(() => atlasLand(different)).toThrow('Drawing coast is stale');
});

test('inhabited coast is within 8.15 km of the physical coast in both continuous directions', () => {
  const coast = atlasCoast(map);
  const scenery = new Set(drawing.scenery);
  const inhabitedRings = coast.land.flatMap((polygon, p) => (scenery.has(p) ? [] : polygon));
  const inhabitedPoints = new Set(inhabitedRings.flat());
  const shared = coast.lines.filter((line) => inhabitedPoints.has(line[0] as Point));
  const physical = new CoastDistance(map.coastline);
  const art = new CoastDistance(coast.lines);
  for (const point of coastSamples(shared))
    expect(physical.nearest(point).distance + SAMPLE_KM / 2).toBeLessThanOrEqual(8.15);
  for (const point of coastSamples(map.coastline))
    expect(art.nearest(point).distance + SAMPLE_KM / 2).toBeLessThanOrEqual(8.15);
});

test('scenery is disjoint from physical land and never a province or land order target', () => {
  const art = atlasCoast(map);
  expect(drawing.scenery.length).toBeGreaterThan(100);
  const physical = landOutline(map);
  for (const p of drawing.scenery) {
    const polygon = art.land[p];
    if (!polygon) throw new Error(`missing scenery ${p}`);
    expect(intersection([polygon], physical)).toEqual([]);
    for (const [x, y] of polygon.flat()) expect(provinceAt(map, { x, y })).toBeUndefined();
  }
});

test('every unchanged city position still stands on drawn land', () => {
  for (const p of map.provinces) expect(contains(atlasCoast(map).land, p.city), p.name).toBe(true);
});

function crossings(outline: MultiPolygon): string[] {
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const edges = outline
    .flat()
    .flatMap((ring) => ring.map((a, i) => [a, ring[(i + 1) % ring.length] as Point] as const))
    .sort(([a, b], [c, d]) => Math.min(a[0], b[0]) - Math.min(c[0], d[0]));
  const errors: string[] = [];
  for (const [i, [a, b]] of edges.entries())
    for (let j = i + 1; j < edges.length; j++) {
      const [c, d] = edges[j] as (typeof edges)[number];
      if (Math.min(c[0], d[0]) > Math.max(a[0], b[0])) break;
      if (
        Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
        Math.min(a[1], b[1]) > Math.max(c[1], d[1])
      )
        continue;
      if (cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12)
        errors.push(`${i}/${j}: ${a}; ${b}; ${c}; ${d}`);
    }
  return errors;
}

test('the finer source, clipping and coordinate packing leave no crossing shores', () => {
  expect(crossings(atlasCoast(map).land)).toEqual([]);
});
