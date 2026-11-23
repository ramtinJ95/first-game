import { describe, expect, test } from 'vitest';
import { ADVANCES } from '../sim/advances/advances.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import { tick } from '../sim/tick.ts';
import { expectConsistent } from '../sim/references.ts';
import { advanceNewsOfDay, HINT_SHARE, HINT_TOLD, HINT_WAIT_DAYS } from './advance-news.ts';

const world = fixtureWorld();

function rome(state: GameState) {
  const record = state.factions[FIXTURE.rome];
  if (!record) throw new Error('expected Rome');
  return record;
}

/** Rome with its treasury at this share of its limit. */
function withGold(share: number): GameState {
  const state = buildFixture();
  rome(state).stores.gold = share * (limitsOf(state).get(FIXTURE.rome)?.gold ?? 0);
  return state;
}

describe('the news of advances', () => {
  test('tells the player of an advance its realm finished, without stopping the game', () => {
    const before = buildFixture();
    rome(before).study = { advance: 'standardCoin', daysLeft: 1 };
    const { state: after, events } = tick(before, [], world);
    const news = advanceNewsOfDay(before, after, events, new Set([HINT_TOLD]));
    expect(news).toEqual([
      {
        kind: 'advanceFinished',
        day: before.day,
        tone: 'good',
        text: `${ADVANCES.standardCoin.name} is studied, for good. The Advances panel offers the next.`,
        opens: 'advances',
      },
    ]);
    expect(news[0]?.pause).toBeUndefined();
    expectConsistent(after);
  });

  test("tells nothing of another realm's advance", () => {
    const before = buildFixture();
    const carthage = before.factions[FIXTURE.carthage];
    if (!carthage) throw new Error('expected Carthage');
    carthage.study = { advance: 'citizenRolls', daysLeft: 1 };
    const { state: after, events } = tick(before, [], world);
    expect(events.some((event) => event.kind === 'advanceFinished')).toBe(true);
    expect(advanceNewsOfDay(before, after, events, new Set([HINT_TOLD]))).toEqual([]);
  });

  test('hints once a game, when the treasury first nears its limit with nothing studied', () => {
    const told = new Set<string>();
    const low = withGold(HINT_SHARE - 0.2);
    const quiet = tick(low, [], world);
    expect(advanceNewsOfDay(low, quiet.state, quiet.events, told)).toEqual([]);

    const near = withGold(1);
    const day = tick(near, [], world);
    const news = advanceNewsOfDay(near, day.state, day.events, told);
    expect(news.map((alert) => [alert.kind, alert.opens])).toEqual([['advanceHint', 'advances']]);
    expect(news[0]?.pause).toBeUndefined();
    expect(told.has(HINT_TOLD)).toBe(true);

    const next = tick(day.state, [], world);
    expect(advanceNewsOfDay(day.state, next.state, next.events, told)).toEqual([]);
    expectConsistent(next.state);
  });

  test('gives no hint to a realm that studies or has studied an advance', () => {
    const studying = withGold(1);
    rome(studying).study = { advance: 'citizenRolls', daysLeft: 50 };
    const one = tick(studying, [], world);
    expect(advanceNewsOfDay(studying, one.state, one.events, new Set())).toEqual([]);

    const learned = withGold(1);
    rome(learned).advances = ['citizenRolls'];
    const two = tick(learned, [], world);
    expect(advanceNewsOfDay(learned, two.state, two.events, new Set())).toEqual([]);
  });

  test("waits a month when the buildings' hint is told the same day", () => {
    const told = new Set<string>();
    const near = withGold(1);
    const day = tick(near, [], world);
    expect(advanceNewsOfDay(near, day.state, day.events, told, true)).toEqual([]);
    expect(told.has(HINT_TOLD)).toBe(false);

    const full = (state: GameState) => {
      rome(state).stores.gold = limitsOf(state).get(FIXTURE.rome)?.gold ?? 0;
    };
    let state = day.state;
    for (let i = 0; i < HINT_WAIT_DAYS - 1; i++) {
      const next = tick(state, [], world);
      full(next.state);
      expect(advanceNewsOfDay(state, next.state, next.events, told)).toEqual([]);
      state = next.state;
    }
    const next = tick(state, [], world);
    full(next.state);
    expect(advanceNewsOfDay(state, next.state, next.events, told).map((a) => a.kind)).toEqual([
      'advanceHint',
    ]);
    expectConsistent(next.state);
  });
});
