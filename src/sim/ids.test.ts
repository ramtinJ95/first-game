import { expect, test } from 'vitest';
import { buildFixture } from './fixture.ts';
import { allocateId, MAX_SERIAL } from './ids.ts';
import { loadGame, saveGame } from './save.ts';

test('consecutive ids are distinct', () => {
  const state = buildFixture();
  expect([allocateId(state, 'army'), allocateId(state, 'army')]).toEqual(['army-1', 'army-2']);
});

test('the highest counter a save may hold hands out one id, then refuses rather than repeat it', () => {
  const loaded = loadGame(saveGame({ ...buildFixture(), nextSerial: MAX_SERIAL }));
  if (!loaded.ok) throw new Error(loaded.error);
  const state = loaded.state;
  expect(allocateId(state, 'battle')).toBe(`battle-${MAX_SERIAL}`);
  expect(() => allocateId(state, 'battle')).toThrow('The id counter is exhausted.');
});
