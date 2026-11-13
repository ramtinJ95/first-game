import { expect, test } from 'vitest';
import type { MultiPolygon } from '../sim/map.ts';
import {
  paintWash,
  rasterise,
  WASH_CELL_KM,
  WASH_DESERT_GAIN,
  WASH_FADE_KM,
  type Wash,
} from './washes.ts';

const square = (x0: number, x1: number): MultiPolygon => [
  [
    [
      [x0, 40],
      [x1, 40],
      [x1, 160],
      [x0, 160],
    ],
  ],
];
/**
 * Three provinces in a row on a map with sea round them: Rome holds two, Carthage one,
 * whose eastern end is desert.
 */
const MAP = {
  width: 480,
  height: 200,
  terrain: [{ kind: 'desert', outline: square(340, 400) }],
  provinces: [
    { outline: square(40, 160) },
    { outline: square(160, 280) },
    { outline: square(280, 400) },
  ],
};
const STRENGTH = 0.3;
const ROME: Wash = { owner: 'rome', colour: 0xb3352a, strength: STRENGTH };
const CARTHAGE: Wash = { owner: 'carthage', colour: 0x6b3aa3, strength: STRENGTH };

function washAt(x: number, y: number): { alpha: number; colour: number } {
  const raster = rasterise(MAP);
  const rgba = new Uint8ClampedArray(4 * raster.columns * raster.rows);
  paintWash(raster, [ROME, ROME, CARTHAGE], rgba);
  const k = 4 * (Math.floor(y / WASH_CELL_KM) * raster.columns + Math.floor(x / WASH_CELL_KM));
  return {
    alpha: (rgba[k + 3] as number) / 255,
    colour: ((rgba[k] as number) << 16) | ((rgba[k + 1] as number) << 8) | (rgba[k + 2] as number),
  };
}

test('a wash runs on unbroken across the border of two provinces of one owner', () => {
  const west = washAt(160 - WASH_CELL_KM / 2, 100);
  expect(west.alpha).toBeCloseTo(STRENGTH, 2);
  expect(west.colour).toBe(ROME.colour);
  expect(washAt(160 + WASH_CELL_KM / 2, 100).alpha).toBeCloseTo(STRENGTH, 2);
});

test('a wash fades to clear toward the border of another owner, on both sides', () => {
  expect(washAt(280 - WASH_CELL_KM / 2, 100).alpha).toBe(0);
  expect(washAt(280 + WASH_CELL_KM / 2, 100).alpha).toBe(0);
  const half = washAt(280 - (WASH_FADE_KM.clear + WASH_FADE_KM.full) / 2, 100).alpha;
  expect(half).toBeGreaterThan(0);
  expect(half).toBeLessThan(STRENGTH);
  const inside = washAt(280 + WASH_FADE_KM.full + 2 * WASH_CELL_KM, 100);
  expect(inside.alpha).toBeCloseTo(STRENGTH, 2);
  expect(inside.colour).toBe(CARTHAGE.colour);
});

test('the coast is no border, so a wash stays full to the sea, and the sea stays clear', () => {
  expect(washAt(40 + WASH_CELL_KM / 2, 100).alpha).toBeCloseTo(STRENGTH, 2);
  expect(washAt(20, 100).alpha).toBe(0);
});

test('on the desert a wash is laid stronger, so its hue holds on the yellow ground', () => {
  expect(washAt(370, 100).alpha).toBeCloseTo(STRENGTH * WASH_DESERT_GAIN, 2);
  expect(washAt(320, 100).alpha).toBeCloseTo(STRENGTH, 2);
});
