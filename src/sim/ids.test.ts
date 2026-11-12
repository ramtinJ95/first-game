import { expect, test } from 'vitest';
import { buildFixture } from './fixture.ts';
import { allocateId, MAX_SERIAL } from './ids.ts';
import { loadGame, saveGame } from './save.ts';

test('consecutive ids are distinct', () => {
  const state = buildFixture();
  expect([allocateId(state, 'army'), allocateId(state, 'army')]).toEqual(['army-1', 'army-2']);
});

test('the last id leaves a state that still saves and loads, and the spent counter refuses rather than repeat', () => {
  const loaded = loadGame(saveGame({ ...buildFixture(), nextSerial: MAX_SERIAL - 1 }));
  if (!loaded.ok) throw new Error(loaded.error);
  expect(allocateId(loaded.state, 'battle')).toBe(`battle-${MAX_SERIAL - 1}`);

  const reloaded = loadGame(saveGame(loaded.state));
  if (!reloaded.ok) throw new Error(reloaded.error);
  expect(reloaded.state.nextSerial).toBe(MAX_SERIAL);
  expect(() => allocateId(reloaded.state, 'battle')).toThrow('The id counter is exhausted.');
});
