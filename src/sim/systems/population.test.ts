import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { RefugeeColumnId } from '../ids.ts';
import { expectConsistent } from '../references.ts';
import type { GameState } from '../state/game-state.ts';
import { tick } from '../tick.ts';

const world = fixtureWorld();

function play(state: GameState, days: number): GameState {
  for (let day = 0; day < days; day += 1) state = tick(state, [], world).state;
  return state;
}

describe('population', () => {
  test('a city grows by 2 percent in a year while its owner has food', () => {
    const state = play(buildFixture(), 365);
    expect(state.cities[FIXTURE.roma]?.population).toBeCloseTo(40_800, 6);
    expect(state.cities[FIXTURE.carthago]?.population).toBeCloseTo(51_000, 6);
    expectConsistent(state);
  });

  test('a city shrinks by 10 percent in a year while its owner has no food', () => {
    const start = buildFixture();
    const rome = start.factions[FIXTURE.rome];
    if (!rome) throw new Error('the fixture lacks Rome');
    rome.stores.food = -100_000;
    const state = play(start, 365);
    expect(state.cities[FIXTURE.roma]?.population).toBeCloseTo(36_000, 6);
    expect(state.cities[FIXTURE.carthago]?.population).toBeCloseTo(51_000, 6);
    expectConsistent(state);
  });

  test('a refugee column at its destination city joins it and is removed', () => {
    const state = buildFixture();
    const id = 'refugeeColumn-walking' as RefugeeColumnId;
    state.refugeeColumns[id] = {
      id,
      owner: FIXTURE.rome,
      people: 500,
      from: FIXTURE.capua,
      to: FIXTURE.roma,
      position: { x: 2541.3, y: 2365.8 },
      waypoints: [{ x: 2511.3, y: 2335.8 }],
    };
    const walking = tick(state, [], world).state;
    expect(Object.keys(walking.refugeeColumns)).toEqual([id]);
    expectConsistent(walking);
  });
});
