import { expect, test } from 'vitest';
import { buildFixture } from './fixture.ts';
import { findBrokenReferences } from './references.ts';
import { loadGame, saveGame } from './save.ts';

test('the fixture is a valid state', () => {
  expect(findBrokenReferences(buildFixture())).toEqual([]);
  expect(loadGame(saveGame(buildFixture())).ok).toBe(true);
});

test('the fixture has two factions, three provinces with cities, and two armies', () => {
  const state = buildFixture();
  expect(Object.keys(state.factions)).toHaveLength(2);
  expect(Object.keys(state.provinces)).toHaveLength(3);
  expect(Object.keys(state.cities)).toHaveLength(3);
  expect(Object.keys(state.armies)).toHaveLength(2);
});

test('each call returns a fresh copy', () => {
  const first = buildFixture();
  first.day = 99 as typeof first.day;
  expect(buildFixture().day).toBe(1);
});
