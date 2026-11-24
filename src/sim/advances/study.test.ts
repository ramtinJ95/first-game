import { describe, expect, test } from 'vitest';
import type { DayEvent } from '../events.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { Order } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import type { GameState } from '../state/game-state.ts';
import { tick } from '../tick.ts';
import { ADVANCES, STUDY_REFUND, type AdvanceKind } from './advances.ts';

const world = fixtureWorld();

const study = (advance: AdvanceKind, faction = FIXTURE.rome): Order => ({
  kind: 'study',
  faction,
  advance,
});
const cancel: Order = { kind: 'cancelStudy', faction: FIXTURE.rome };

function rome(state: GameState) {
  const record = state.factions[FIXTURE.rome];
  if (!record) throw new Error('expected Rome');
  return record;
}

function rich(): GameState {
  const state = buildFixture();
  rome(state).stores.gold = 50_000;
  return state;
}

/** Plays days with no orders and gives the last state and every event of them. */
function play(state: GameState, days: number) {
  const events: DayEvent[] = [];
  for (let day = 0; day < days; day++) {
    const next = tick(state, [], world);
    events.push(...next.events);
    state = next.state;
  }
  return { state, events };
}

describe('studying an advance', () => {
  test('pays the gold at the order and finishes after its days', () => {
    const { gold, days } = ADVANCES.standardCoin;
    const ordered = tick(rich(), [study('standardCoin')], world);
    expect(ordered.rejected).toEqual([]);
    expect(rome(ordered.state).study).toEqual({ advance: 'standardCoin', daysLeft: days - 1 });
    const before = rome(rich()).stores.gold;
    expect(rome(ordered.state).stores.gold).toBeLessThan(before - gold + 100);

    const almost = play(ordered.state, days - 2);
    expect(rome(almost.state).advances).toEqual([]);
    const done = play(almost.state, 1);
    expect(rome(done.state).advances).toEqual(['standardCoin']);
    expect(rome(done.state).study).toBeNull();
    expect(done.events).toContainEqual({
      kind: 'advanceFinished',
      faction: FIXTURE.rome,
      advance: 'standardCoin',
    });
    expectConsistent(done.state);
  });

  test('studies one advance at a time, each once', () => {
    const first = tick(rich(), [study('citizenRolls')], world).state;
    const second = tick(first, [study('standardCoin')], world);
    expect(second.rejected.map((r) => r.reason)).toEqual([
      `${FIXTURE.rome} is studying citizenRolls`,
    ]);
    const done = play(second.state, ADVANCES.citizenRolls.days).state;
    const again = tick(done, [study('citizenRolls')], world);
    expect(again.rejected.map((r) => r.reason)).toEqual([
      `${FIXTURE.rome} has studied citizenRolls already`,
    ]);
    expectConsistent(again.state);
  });

  test('refuses a realm that lacks the gold and takes none of it', () => {
    const state = buildFixture();
    rome(state).stores.gold = ADVANCES.marketWeights.gold - 1;
    const result = tick(state, [study('marketWeights')], world);
    expect(result.rejected).toHaveLength(1);
    expect(rome(result.state).study).toBeNull();
    expect(rome(result.state).stores.gold).toBeGreaterThanOrEqual(ADVANCES.marketWeights.gold - 1);
    expectConsistent(result.state);
  });

  test('giving up a study gives back half its gold and frees the realm to study another', () => {
    const ordered = tick(rich(), [study('siegeEngineers')], world).state;
    const gold = rome(ordered).stores.gold;
    const cancelled = tick(ordered, [cancel], world).state;
    const refund = ADVANCES.siegeEngineers.gold * STUDY_REFUND;
    expect(rome(cancelled).study).toBeNull();
    expect(rome(cancelled).stores.gold).toBeGreaterThan(gold + refund - 100);
    expect(rome(cancelled).stores.gold).toBeLessThan(gold + refund + 100);
    expect(tick(cancelled, [study('standardCoin')], world).rejected).toEqual([]);
    expectConsistent(cancelled);
  });

  test('refuses to give up a study when there is none', () => {
    const result = tick(rich(), [cancel], world);
    expect(result.rejected.map((r) => r.reason)).toEqual([`${FIXTURE.rome} is studying nothing`]);
    expectConsistent(result.state);
  });
});
