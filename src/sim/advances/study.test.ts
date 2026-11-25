import { describe, expect, test } from 'vitest';
import type { DayEvent } from '../events.ts';
import { buildFixture, FIXTURE, fixtureWorld, growRome } from '../fixture.ts';
import type { Order } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import type { GameState } from '../state/game-state.ts';
import { tick } from '../tick.ts';
import { ADVANCES, GROWING_ADVANCES, STUDY_REFUND, type AdvanceKind } from './advances.ts';
import { citiesOf, studyPrice } from './study.ts';

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
    expect(rome(ordered.state).study).toEqual({
      advance: 'standardCoin',
      daysLeft: days - 1,
      paid: gold,
    });
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

  test("a realm past 8 cities pays the growing advances' price times its cities over 8, and the others as listed", () => {
    const state = rich();
    expect(studyPrice(state, FIXTURE.rome, 'standardCoin')).toBe(ADVANCES.standardCoin.gold);
    growRome(state, 12);
    expect(citiesOf(state, FIXTURE.rome)).toBe(12);
    for (const kind of GROWING_ADVANCES)
      expect(studyPrice(state, FIXTURE.rome, kind)).toBe((ADVANCES[kind].gold * 12) / 8);
    expect(studyPrice(state, FIXTURE.rome, 'clemency')).toBe(ADVANCES.clemency.gold);
    const before = rome(state).stores.gold;
    const ordered = tick(state, [study('standardCoin')], world).state;
    expect(rome(ordered).study?.paid).toBe(9000);
    expect(rome(ordered).stores.gold).toBeLessThan(before - 9000 + 100);
    expectConsistent(ordered);
  });

  test('the price is fixed on the day study starts, and giving up returns half of what was paid', () => {
    const state = rich();
    const ordered = tick(state, [study('citizenRolls')], world).state;
    expect(rome(ordered).study?.paid).toBe(ADVANCES.citizenRolls.gold);
    growRome(ordered, 16);
    expect(studyPrice(ordered, FIXTURE.rome, 'citizenRolls')).toBe(ADVANCES.citizenRolls.gold * 2);
    expect(rome(ordered).study?.paid).toBe(ADVANCES.citizenRolls.gold);
    const gold = rome(ordered).stores.gold;
    const cancelled = tick(ordered, [cancel], world).state;
    const back = rome(cancelled).stores.gold - gold;
    expect(back).toBeGreaterThan(ADVANCES.citizenRolls.gold / 2 - 100);
    expect(back).toBeLessThan(ADVANCES.citizenRolls.gold / 2 + 100);
    expectConsistent(cancelled);
  });

  test('a realm past 8 cities that holds the listed gold but not its price is refused', () => {
    const state = buildFixture();
    growRome(state, 16);
    rome(state).stores.gold = ADVANCES.standardCoin.gold + 100;
    const result = tick(state, [study('standardCoin')], world);
    expect(result.rejected).toHaveLength(1);
    expect(rome(result.state).study).toBeNull();
  });
});
