import { expect, test } from 'vitest';
import { dayLabel } from './placeholder.ts';

test('dayLabel names the day', () => {
  expect(dayLabel(1)).toBe('Day 1');
  expect(dayLabel(42)).toBe('Day 42');
});
