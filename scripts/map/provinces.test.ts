import { expect, test } from 'vitest';
import type { MultiPolygon, Ring } from '../../src/sim/map.ts';
import { relations } from './provinces.ts';

const EXTENT: Ring = [
  [-100, -100],
  [100, -100],
  [100, 100],
  [-100, 100],
];

function square(x0: number, y0: number, x1: number, y1: number) {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] satisfies Ring;
}

function frame(outer: number, inner: number): MultiPolygon {
  return [
    [
      square(-outer, -outer, 10 + outer, 10 + outer),
      square(-inner, -inner, 10 + inner, 10 + inner),
    ],
  ];
}

function box(x0: number, y0: number, x1: number, y1: number): MultiPolygon {
  return [
    [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
    ],
  ];
}

test('provinces that touch along 10 km are land neighbours', () => {
  expect(relations([box(0, 0, 10, 10), box(10, 0, 20, 10)], EXTENT).neighbours).toEqual([[1], [0]]);
});

test('a 0.25 km strait between provinces is not a land border, and faces the sea', () => {
  const { neighbours, coastal } = relations([box(0, 0, 10, 10), box(10.25, 0, 20, 10)], EXTENT);
  expect(neighbours).toEqual([[], []]);
  expect(coastal).toEqual([true, true]);
});

test('a 0.25 km wide province between two others separates them', () => {
  const { neighbours } = relations(
    [box(0, 0, 10, 10), box(10, 0, 10.25, 10), box(10.25, 0, 20.25, 10)],
    EXTENT,
  );
  expect(neighbours).toEqual([[1], [0, 2], [1]]);
});

test('provinces that touch along 1 km, under the 2 km minimum, are not neighbours', () => {
  expect(relations([box(0, 0, 10, 10), box(10, 9, 20, 20)], EXTENT).neighbours).toEqual([[], []]);
});

test('a 1 km contact centred on a 10 km edge is credited 1 km, under the 2 km minimum', () => {
  expect(relations([box(0, 0, 10, 10), box(10, 4.5, 20, 5.5)], EXTENT).neighbours).toEqual([
    [],
    [],
  ]);
});

test('a province enclosed by a 0.25 km strip of land, itself enclosed by land, is not coastal', () => {
  const { neighbours, coastal } = relations(
    [box(0, 0, 10, 10), frame(0.25, 0), frame(20, 0.25)],
    EXTENT,
  );
  expect(neighbours).toEqual([[1], [0, 2], [1]]);
  expect(coastal).toEqual([false, false, true]);
});
