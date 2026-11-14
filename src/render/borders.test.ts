import { expect, test } from 'vitest';
import type { MapLine, MultiPolygon, Point } from '../sim/map.ts';
import { BORDER_WEIGHTS, borderRuns, sharedBorders } from './borders.ts';

/** Three provinces in a row, whose borders run north to south at x = 100 and x = 200. */
const provinces: { outline: MultiPolygon }[] = [0, 100, 200].map((x) => ({
  outline: [
    [
      [
        [x, 0],
        [x + 100, 0],
        [x + 100, 50],
        [x + 100, 100],
        [x, 100],
        [x, 50],
      ],
    ],
  ],
}));

const sorted = (lines: MapLine[]) =>
  lines
    .map((line) => [...line].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
    .sort((a, b) => (a[0] as Point)[0] - (b[0] as Point)[0]);

test('each border between two provinces is drawn once, and the coast not at all', () => {
  expect(sorted(sharedBorders({ provinces }))).toEqual([
    [
      [100, 0],
      [100, 50],
      [100, 100],
    ],
    [
      [200, 0],
      [200, 50],
      [200, 100],
    ],
  ]);
});

test('a border is drawn in runs of the pen weights that follow on from one another', () => {
  const line: MapLine = Array.from({ length: 101 }, (_, k): Point => [0, k]);
  const runs = borderRuns([line]);
  expect(runs.length).toBeGreaterThan(3);
  expect(runs.every((run) => (BORDER_WEIGHTS as readonly number[]).includes(run.weight))).toBe(
    true,
  );
  expect(runs.flatMap((run, k) => (k === 0 ? run.line : run.line.slice(1)))).toEqual(line);
});
