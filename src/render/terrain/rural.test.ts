import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { parseMap } from '../../sim/map.ts';
import { drawMarks } from './draw.ts';
import { Land, placeFields, placeRelief } from './marks.ts';
import { ruralMarks } from './rural.ts';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../../data/map/map.json', import.meta.url), 'utf8')),
);
let land: Land;
beforeAll(() => {
  land = new Land(map);
});
const DELTA = { left: 3968, top: 3584, right: 4160, bottom: 3776 };
const STEPPE = { left: 4210, top: 1660, right: 4530, bottom: 1840 };
const ANATOLIA = { left: 4032, top: 2560, right: 4416, bottom: 2880 };
const PLATEAU = { left: 5952, top: 3200, right: 6208, bottom: 3456 };
const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

test('the delta has river-connected channels, varied marshes and non-combed field tracts', () => {
  const marks = placeFields(land, DELTA);
  const channels = marks.filter((m) => m.kind === 'channel');
  const marsh = marks.filter((m) => m.kind === 'wetland');
  expect(channels.length).toBeGreaterThan(2);
  expect(marsh.length).toBeGreaterThan(5);
  for (const m of channels) {
    const first = m.points[0];
    if (!first) throw new Error('empty canal');
    expect(land.riverAt(first[0], first[1], 1)?.distance).toBeLessThan(0.001);
    expect(m.points.every(([x, y]) => land.open(x, y))).toBe(true);
  }
  expect(spread(marsh.map((m) => m.angle))).toBeGreaterThan(1);
  expect(spread(marsh.map((m) => m.size))).toBeGreaterThan(1);
  expect(spread(marks.filter((m) => m.kind === 'field').map((m) => m.angle))).toBeGreaterThan(0.8);
  expect(drawMarks(marks, 'close').instructions.length).toBeGreaterThan(0);
});

test('the steppe has meadow ribbons and pastoral camps on open watered plains, not cities or mountains', () => {
  const marks = placeFields(land, STEPPE);
  const meadow = marks.filter((m) => m.kind === 'grassland');
  const camps = marks.filter((m) => m.kind === 'pastoralCamp');
  expect(meadow.length).toBeGreaterThan(20);
  expect(camps.length).toBeGreaterThan(0);
  for (const m of [...meadow, ...camps]) {
    expect(land.open(m.x, m.y)).toBe(true);
    expect(land.cover(m.x, m.y)).toBe('dry');
    expect(land.mountains.inside(m.x, m.y) || land.hills.inside(m.x, m.y)).toBe(false);
  }
});

test('rural marks repeat exactly and adjoining chunks have no placement seams', () => {
  const whole = ruralMarks(land, STEPPE);
  expect(ruralMarks(land, STEPPE)).toEqual(whole);
  const halves = [
    ruralMarks(land, { ...STEPPE, right: 4370 }),
    ruralMarks(land, { ...STEPPE, left: 4370 }),
  ].flat();
  expect(new Set(halves.map((m) => JSON.stringify(m)))).toEqual(
    new Set(whole.map((m) => JSON.stringify(m))),
  );
});

test('hills and dry folds vary over at least 45° around the lie of their own relief', () => {
  const hills = placeRelief(land, ANATOLIA, 'close').filter((m) => m.kind === 'hill');
  const folds = placeRelief(land, PLATEAU, 'close').filter((m) => m.kind === 'fold');
  expect(hills.length).toBeGreaterThan(20);
  expect(folds.length).toBeGreaterThan(20);
  const hillAngles = hills.map((m) => {
    const strike = land.strike(m.x, m.y, 'hills');
    return m.angle - Math.atan2(Math.sin(2 * strike), Math.cos(2 * strike)) * 0.175;
  });
  const foldAngles = folds.map((m) => m.angle - land.strike(m.x, m.y));
  for (const angles of [hillAngles, foldAngles])
    expect(spread(angles)).toBeGreaterThan(Math.PI / 4);
  expect(hillAngles.every((a) => Math.abs(a) <= 0.5)).toBe(true);
  expect(hills.every((m) => Math.abs(m.angle) < Math.PI / 2)).toBe(true);
  expect(foldAngles.every((a) => Math.abs(a) <= 0.725)).toBe(true);
  const sizes = folds.map((m) => m.length);
  expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(2);
  const gaps = folds.map((a) =>
    Math.min(...folds.filter((b) => a !== b).map((b) => Math.hypot(a.x - b.x, a.y - b.y))),
  );
  expect(Math.max(...gaps) / Math.min(...gaps)).toBeGreaterThan(2);
});

test('hill strike reads a real nonzero depth field and changes with differently oriented relief', () => {
  const terrain = (vertical: boolean): typeof map.terrain => [
    {
      kind: 'hills',
      name: 'oriented test relief',
      outline: [
        [
          [
            [4000, 2400],
            [vertical ? 4064 : 4256, 2400],
            [vertical ? 4064 : 4256, vertical ? 2656 : 2464],
            [4000, vertical ? 2656 : 2464],
          ],
        ],
      ],
    },
  ];
  const horizontal = new Land({ ...map, terrain: terrain(false) });
  const vertical = new Land({ ...map, terrain: terrain(true) });
  expect(horizontal.hills.smoothDepth(4128, 2432)).toBeGreaterThan(0);
  expect(vertical.hills.smoothDepth(4032, 2528)).toBeGreaterThan(0);
  const across = horizontal.strike(4128, 2432, 'hills');
  const along = vertical.strike(4032, 2528, 'hills');
  expect(Math.abs(Math.sin(across - along))).toBeGreaterThan(0.95);
});
