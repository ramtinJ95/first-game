import { expect, test } from 'vitest';
import { nextInt, nextRandom, seedRng } from './rng.ts';

function draws(seed: number, count: number): number[] {
  const state = { rng: seedRng(seed) };
  return Array.from({ length: count }, () => nextRandom(state));
}

test('the same seed gives the same sequence', () => {
  expect(draws(123, 50)).toEqual(draws(123, 50));
});

test('different seeds give different sequences', () => {
  expect(draws(123, 50)).not.toEqual(draws(124, 50));
});

test('draws lie in [0, 1) and spread across it', () => {
  const values = draws(5, 10_000);
  expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...values)).toBeLessThan(1);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  expect(mean).toBeGreaterThan(0.48);
  expect(mean).toBeLessThan(0.52);
});

test('a copied generator state continues the same sequence', () => {
  const original = { rng: seedRng(9) };
  nextRandom(original);
  const copy = JSON.parse(JSON.stringify(original)) as typeof original;
  expect(nextRandom(copy)).toBe(nextRandom(original));
});

test('nextInt stays within [min, max)', () => {
  const state = { rng: seedRng(1) };
  const values = new Set(Array.from({ length: 1000 }, () => nextInt(state, 3, 6)));
  expect([...values].sort()).toEqual([3, 4, 5]);
});
