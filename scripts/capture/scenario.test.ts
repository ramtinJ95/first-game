import { expect, test } from 'vitest';
import { defineScenario } from './scenario.ts';

const run = async () => {};
test('a long visual tour can opt into a longer recording without changing execution timeouts', () => {
  expect(defineScenario({ name: 'tour', title: 'Tour', run }).clipSeconds).toBeUndefined();
  expect(defineScenario({ name: 'tour', title: 'Tour', run, clipSeconds: 90 }).clipSeconds).toBe(
    90,
  );
});
test.each([0, -1, 121, 1.5, NaN])('refuses invalid recording duration %s', (clipSeconds) => {
  expect(() => defineScenario({ name: 'tour', title: 'Tour', run, clipSeconds })).toThrow(
    'clipSeconds',
  );
});
