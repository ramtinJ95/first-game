import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE } from '../sim/fixture.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import {
  BUILDING_HINT_KEY,
  buildingHintOfDay,
  NEAR_LIMIT,
  worthBuilding,
} from './building-hint.ts';

/** Rome with its gold at `share` of its treasury's limit. */
function withGold(share: number): GameState {
  const state = buildFixture();
  const rome = state.factions[FIXTURE.rome];
  if (!rome) throw new Error('no Rome');
  rome.stores.gold = share * (limitsOf(state).get(FIXTURE.rome)?.gold ?? 0);
  return state;
}

describe('the hint that a city has something worth the gold', () => {
  test('names the city, the building, and its payback once the gold nears its limit, without a pause', () => {
    const state = withGold(NEAR_LIMIT);
    const best = worthBuilding(state);
    if (!best) throw new Error('expected a building worth ordering');
    const [hint, ...rest] = buildingHintOfDay(state, state, new Set());
    expect(rest).toEqual([]);
    expect(hint).toMatchObject({
      kind: 'buildingWorthGold',
      tone: 'neutral',
      focus: { at: best.city.position, select: { kind: 'province', province: best.city.province } },
    });
    expect(hint?.text).toMatch(
      new RegExp(
        `^Your gold nears its limit and ${best.city.name} builds nothing: building [A-Z][a-z' ]+ there for [\\d,]+ gold would pay it back in ${best.years.toFixed(1)} years\\.$`,
      ),
    );
    expect(hint?.pause).toBeUndefined();
  });

  test('says nothing below the mark, once told, or when no idle city has a building that pays back', () => {
    const low = withGold(NEAR_LIMIT - 0.05);
    expect(buildingHintOfDay(low, low, new Set())).toEqual([]);
    const full = withGold(1);
    expect(buildingHintOfDay(full, full, new Set([BUILDING_HINT_KEY]))).toEqual([]);
    for (const city of Object.values(full.cities))
      if (city.owner === FIXTURE.rome) city.construction = { building: 'temple', daysLeft: 5 };
    expect(buildingHintOfDay(full, full, new Set())).toEqual([]);
  });
});
