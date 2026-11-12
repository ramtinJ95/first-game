import { describe, expect, test } from 'vitest';
import { changeCityOwner } from './cities.ts';
import { fixtureWorld } from './fixture.ts';
import type { CityId, FactionId } from './ids.ts';
import { newGame } from './new-game.ts';
import { outcomeOf, standingOf } from './outcome.ts';
import { expectConsistent } from './references.ts';
import type { Day } from './state/day.ts';
import type { GameState } from './state/game-state.ts';

const world = fixtureWorld();
const rome = 'rome' as FactionId;
const carthage = 'carthage' as FactionId;
const capitals = ['roma', 'carthago', 'alexandria', 'pella', 'persepolis'] as CityId[];

function game(): GameState {
  return newGame(world.map, { seed: 1, player: 'rome' });
}

/** Gives Rome the great capitals named and minor cities until it holds `total` provinces. */
function romeHolds(state: GameState, total: number, held: readonly CityId[]) {
  for (const city of held) changeCityOwner(state, city, rome);
  const minors = Object.values(state.cities)
    .filter((city) => city.rank === 'minorCity')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const city of minors) {
    const owned = Object.values(state.cities).filter((c) => c.owner === rome).length;
    if (owned >= total) break;
    changeCityOwner(state, city.id, rome);
  }
}

describe('victory', () => {
  test('a new game is under way: Rome holds 4 of the 32 provinces it needs and one of 3 capitals', () => {
    const state = game();
    expect(outcomeOf(state, world, rome)).toEqual({ kind: 'playing' });
    expect(standingOf(state, world, rome)).toEqual({
      provinces: 4,
      provincesNeeded: 32,
      capitals: ['roma'],
      capitalsNeeded: 3,
      home: 'roma',
      holdsHome: true,
    });
    expectConsistent(state);
  });

  test('32 of the 80 provinces with Roma and two other great capitals win', () => {
    const state = game();
    romeHolds(state, 32, ['carthago', 'alexandria'] as CityId[]);
    expect(outcomeOf(state, world, rome)).toEqual({ kind: 'won' });
    expectConsistent(state);
  });

  test('31 provinces with three great capitals do not win', () => {
    const state = game();
    romeHolds(state, 31, ['carthago', 'alexandria'] as CityId[]);
    expect(outcomeOf(state, world, rome)).toEqual({ kind: 'playing' });
    expectConsistent(state);
  });

  test('32 provinces with only two great capitals do not win', () => {
    const state = game();
    romeHolds(state, 32, ['carthago'] as CityId[]);
    expect(outcomeOf(state, world, rome)).toEqual({ kind: 'playing' });
    expectConsistent(state);
  });

  test('32 provinces and four foreign capitals do not win without Roma', () => {
    const state = game();
    romeHolds(state, 33, capitals);
    changeCityOwner(state, 'roma' as CityId, carthage);
    expect(standingOf(state, world, rome).capitals).toEqual([
      'alexandria',
      'carthago',
      'pella',
      'persepolis',
    ]);
    expect(outcomeOf(state, world, rome)).toEqual({ kind: 'playing' });
    expectConsistent(state);
  });

  test('another power wins by the same rule', () => {
    const state = game();
    for (const city of Object.values(state.cities)) {
      if (city.owner !== rome) changeCityOwner(state, city.id, carthage);
    }
    expect(outcomeOf(state, world, carthage)).toEqual({ kind: 'won' });
    expect(outcomeOf(state, world, rome)).toEqual({ kind: 'playing' });
    expectConsistent(state);
  });
});

describe('defeat', () => {
  test('losing the last city loses the game on that day', () => {
    const state = game();
    state.day = 40 as Day;
    const own = Object.values(state.cities).filter((city) => city.owner === rome);
    for (const city of own.slice(0, -1)) changeCityOwner(state, city.id, carthage);
    expect(outcomeOf(state, world, rome)).toEqual({ kind: 'playing' });
    const last = own.at(-1);
    if (!last) throw new Error('Rome starts with cities');
    changeCityOwner(state, last.id, carthage);
    expect(outcomeOf(state, world, rome)).toEqual({ kind: 'lost', on: 40 });
    expectConsistent(state);
  });
});
