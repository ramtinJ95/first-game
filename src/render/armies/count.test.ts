import { describe, expect, test } from 'vitest';
import { FIGURE_CAP, MEN_PER_FIGURE, figuresFor } from './count.ts';

describe('figuresFor', () => {
  test('one figure for each 50 men or part of 50', () => {
    expect(figuresFor(1)).toBe(1);
    expect(figuresFor(MEN_PER_FIGURE)).toBe(1);
    expect(figuresFor(MEN_PER_FIGURE + 1)).toBe(2);
    expect(figuresFor(1000)).toBe(20);
    expect(figuresFor(1200)).toBe(24);
    expect(figuresFor(400)).toBe(8);
  });

  test('a formation with no men shows none', () => {
    expect(figuresFor(0)).toBe(0);
  });

  test('a large formation stops at the cap', () => {
    expect(figuresFor(FIGURE_CAP * MEN_PER_FIGURE)).toBe(FIGURE_CAP);
    expect(figuresFor(40_000)).toBe(FIGURE_CAP);
  });
});
