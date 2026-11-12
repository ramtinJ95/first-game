import { describe, expect, it } from 'vitest';
import { toPixels } from './lines.ts';

describe('toPixels', () => {
  it('scales every point into pixels when no step is asked for', () => {
    expect(
      toPixels(
        [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        2,
        0,
      ),
    ).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('drops points closer than the step to the last kept one and keeps both ends', () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [10, 0],
      [10.5, 0],
    ];
    expect(toPixels(line, 1, 2.5)).toEqual([0, 0, 3, 0, 10, 0, 10.5, 0]);
  });
});
