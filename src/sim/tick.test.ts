import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE } from './fixture.ts';
import type { Order } from './orders/orders.ts';
import { nextInt } from './rng.ts';
import { loadGame, saveGame } from './save.ts';
import type { GameState } from './state/game-state.ts';
import { SYSTEMS, type System } from './systems.ts';
import { tick } from './tick.ts';

const STANCES = ['holdTheLine', 'allOutAssault', 'skirmishAndWithdraw'] as const;

function ordersForDay(day: number): Order[] {
  const orders: Order[] = [];
  if (day % 7 === 0) {
    orders.push({
      kind: 'moveArmy',
      faction: FIXTURE.rome,
      army: FIXTURE.romanArmy,
      to: { x: day, y: day * 2 },
    });
  }
  if (day % 11 === 0) {
    orders.push({
      kind: 'setStance',
      faction: FIXTURE.carthage,
      army: FIXTURE.punicArmy,
      stance: STANCES[day % 3] ?? 'holdTheLine',
    });
  }
  return orders;
}

const growRomeAtRandom: System = (state) => {
  const roma = state.cities[FIXTURE.roma];
  if (roma) roma.population += nextInt(state, 0, 100);
};
const systemsWithRandomness = [growRomeAtRandom, ...SYSTEMS];

function play(state: GameState, days: number): GameState {
  for (let i = 0; i < days; i += 1) {
    state = tick(state, ordersForDay(state.day), systemsWithRandomness).state;
  }
  return state;
}

describe('determinism', () => {
  test('the same seed and the same orders give an identical save after 500 ticks', () => {
    const first = saveGame(play(buildFixture(7), 500));
    const second = saveGame(play(buildFixture(7), 500));
    expect(second).toBe(first);
    expect(play(buildFixture(7), 500).day).toBe(501);
  });

  test('a different seed gives a different save after 500 ticks', () => {
    expect(saveGame(play(buildFixture(8), 500))).not.toBe(saveGame(play(buildFixture(7), 500)));
  });

  test('saving and loading halfway does not change where the game ends up', () => {
    const halfway = loadGame(saveGame(play(buildFixture(7), 250)));
    if (!halfway.ok) throw new Error(halfway.error);
    expect(saveGame(play(halfway.state, 250))).toBe(saveGame(play(buildFixture(7), 500)));
  });
});

describe('tick', () => {
  test('advances the day by one', () => {
    expect(tick(buildFixture(), []).state.day).toBe(2);
  });

  test('leaves its input state unchanged and returns a new one', () => {
    const before = buildFixture();
    const snapshot = structuredClone(before);
    const { state } = tick(before, [
      {
        kind: 'setStance',
        faction: FIXTURE.rome,
        army: FIXTURE.romanArmy,
        stance: 'allOutAssault',
      },
    ]);
    expect(before).toEqual(snapshot);
    expect(state).not.toBe(before);
    expect(state.armies[FIXTURE.romanArmy]?.stance).toBe('allOutAssault');
  });

  test('rejects an order for an army the faction does not own and changes nothing else', () => {
    const order: Order = {
      kind: 'moveArmy',
      faction: FIXTURE.carthage,
      army: FIXTURE.romanArmy,
      to: { x: 0, y: 0 },
    };
    const withOrder = tick(buildFixture(), [order]);
    const withoutOrder = tick(buildFixture(), []);
    expect(withOrder.rejected).toEqual([
      { order, reason: 'army army-roman belongs to rome, not carthage' },
    ]);
    expect(withOrder.state).toEqual(withoutOrder.state);
  });

  test('applies orders in the order given, before the systems run', () => {
    const seen: string[] = [];
    const recordStance: System = (state) => {
      seen.push(state.armies[FIXTURE.romanArmy]?.stance ?? 'missing');
    };
    tick(
      buildFixture(),
      [
        {
          kind: 'setStance',
          faction: FIXTURE.rome,
          army: FIXTURE.romanArmy,
          stance: 'allOutAssault',
        },
        {
          kind: 'setStance',
          faction: FIXTURE.rome,
          army: FIXTURE.romanArmy,
          stance: 'skirmishAndWithdraw',
        },
      ],
      [recordStance],
    );
    expect(seen).toEqual(['skirmishAndWithdraw']);
  });
});
