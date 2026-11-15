import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import { GUARD_BAND } from '../guards.ts';
import { expectConsistent } from '../references.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import { tick } from '../tick.ts';
import { CITY_DEFENCES, RECOVERY_DAYS } from './sieges.ts';

const world = fixtureWorld();
const FULL = CITY_DEFENCES.capital.garrison;

function roma(state: GameState) {
  const city = state.cities[FIXTURE.roma];
  if (!city) throw new Error('no Roma');
  return city;
}

/** Roma with a band that leaves today and one that leaves tomorrow, both on the walls. */
function twoBands(): GameState {
  const state = buildFixture();
  roma(state).guards = [{ until: state.day }, { until: (state.day + 1) as Day }];
  roma(state).garrison = FULL + 2 * GUARD_BAND;
  return state;
}

describe('guard terms', () => {
  test('a band leaves on its day, and the garrison falls to the new full garrison', () => {
    let state = tick(twoBands(), [], world).state;
    expect(roma(state).guards).toHaveLength(1);
    expect(roma(state).garrison).toBe(FULL + GUARD_BAND);
    state = tick(state, [], world).state;
    expect(roma(state).guards).toEqual([]);
    expect(roma(state).garrison).toBe(FULL);
    expectConsistent(state);
  });

  test('a garrison already below the new full garrison keeps its men', () => {
    const state = twoBands();
    roma(state).garrison = 1000;
    const next = tick(state, [], world).state;
    expect(roma(next).guards).toHaveLength(1);
    expect(roma(next).garrison).toBe(1000 + Math.ceil((FULL + 2 * GUARD_BAND) / RECOVERY_DAYS));
    expectConsistent(next);
  });

  test('a city whose bands still serve keeps every man', () => {
    const state = buildFixture();
    roma(state).guards = [{ until: (state.day + 10) as Day }];
    roma(state).garrison = FULL + GUARD_BAND;
    const next = tick(state, [], world).state;
    expect(roma(next).guards).toEqual([{ until: state.day + 10 }]);
    expect(roma(next).garrison).toBe(FULL + GUARD_BAND);
    expectConsistent(next);
  });
});
