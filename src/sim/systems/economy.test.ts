import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE } from '../fixture.ts';
import type { FormationId } from '../ids.ts';
import { executeOrder } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import { loadGame, saveGame } from '../save.ts';
import type { GameState } from '../state/game-state.ts';
import { tick } from '../tick.ts';
import { TROOPS } from '../troops.ts';
import { dailyBalances, menOf } from './economy.ts';

function stores(state: GameState, faction = FIXTURE.rome) {
  const found = state.factions[faction]?.stores;
  if (!found) throw new Error(`faction ${faction} is missing`);
  return found;
}

function romanMen(state: GameState) {
  const army = state.armies[FIXTURE.romanArmy];
  if (!army) throw new Error('the Roman army is missing');
  return menOf(state, army);
}

function play(state: GameState, days: number): GameState {
  for (let day = 0; day < days; day += 1) state = tick(state, []).state;
  return state;
}

describe('production and upkeep', () => {
  test('one day adds each city output to its owner and takes each army upkeep', () => {
    const next = tick(buildFixture(), []).state;
    // Rome: 58,000 people make 20.3 gold, 20.3 food, 4.64 manpower; 1,500 men eat 15 of each.
    expect(stores(next).gold).toBeCloseTo(5005.3, 9);
    expect(stores(next).food).toBeCloseTo(1005.3, 9);
    expect(stores(next).manpower).toBeCloseTo(2004.64, 9);
    // Carthage: 50,000 people make 17.5 gold and food and 4 manpower; 1,500 men eat 15.
    expect(stores(next, FIXTURE.carthage).gold).toBeCloseTo(3002.5, 9);
    expect(stores(next, FIXTURE.carthage).food).toBeCloseTo(1002.5, 9);
    expect(stores(next, FIXTURE.carthage).manpower).toBeCloseTo(1004, 9);
    expect(romanMen(next)).toBe(1500);
    expectConsistent(next);
  });

  test('dailyBalances gives the same change the day brings', () => {
    const state = buildFixture();
    const balance = dailyBalances(state).get(FIXTURE.rome);
    expect(balance?.gold).toBeCloseTo(5.3, 9);
    expect(balance?.food).toBeCloseTo(5.3, 9);
    expect(balance?.manpower).toBeCloseTo(4.64, 9);
    expectConsistent(state);
  });
});

describe('shortage', () => {
  test('armies desert while gold is in debt, and stop once income pays it back', () => {
    const state = buildFixture();
    stores(state).gold = -10;
    const first = tick(state, []).state;
    expect(stores(first).gold).toBeCloseTo(-4.7, 9);
    expect(first.formations[FIXTURE.hastati]?.men).toBe(1188);
    expect(first.formations[FIXTURE.equites]?.men).toBe(297);

    const second = tick(first, []).state;
    expect(stores(second).gold).toBeCloseTo(0.75, 1);
    expect(romanMen(second)).toBe(1485);
    expect(romanMen(play(second, 30))).toBe(1485);
    expectConsistent(second);
  });

  test('a food shortage makes armies desert and cities shrink until food is back', () => {
    const state = buildFixture();
    stores(state).food = -10;
    const first = tick(state, []).state;
    expect(romanMen(first)).toBe(1485);
    const roma = first.cities[FIXTURE.roma]?.population ?? 0;
    expect(roma).toBeLessThan(40_000);

    const second = tick(first, []).state;
    expect(stores(second).food).toBeCloseTo(0.75, 1);
    expect(second.cities[FIXTURE.roma]?.population).toBeGreaterThan(roma);
    expect(romanMen(second)).toBe(1485);
    expectConsistent(second);
  });

  test('short of both stores, armies desert twice as fast', () => {
    const state = buildFixture();
    stores(state).gold = -1000;
    stores(state).food = -1000;
    const next = tick(state, []).state;
    expect(next.formations[FIXTURE.hastati]?.men).toBe(1176);
    expectConsistent(next);
  });

  test('an army larger than the income can keep shrinks until the debt is paid', () => {
    const state = buildFixture();
    const hastati = state.formations[FIXTURE.hastati];
    if (!hastati) throw new Error('the fixture lacks the hastati');
    hastati.men = 4700;
    stores(state).gold = 0;
    stores(state).food = 0;
    const later = play(state, 365);
    expect(romanMen(later)).toBeLessThan(2030);
    expect(stores(later).gold).toBeGreaterThan(0);
    expect(stores(later).food).toBeGreaterThan(0);
    expect(dailyBalances(later).get(FIXTURE.rome)?.gold).toBeGreaterThan(0);
    expectConsistent(later);
  });
});

describe('recruitment', () => {
  test('spearmen are paid on the order and join the idle army at the city on their day', () => {
    let state = buildFixture();
    const { days, gold, men } = TROOPS.spearmen.recruit;
    const ordered = tick(state, [
      { kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.roma, troop: 'spearmen' },
    ]);
    expect(ordered.rejected).toEqual([]);
    state = ordered.state;
    expect(stores(state).gold).toBeCloseTo(5000 - gold + 5.3, 9);
    expect(stores(state).manpower).toBeCloseTo(2000 - men + 4.64, 9);
    expect(state.cities[FIXTURE.roma]?.recruits).toEqual([
      { troop: 'spearmen', readyOn: 1 + days },
    ]);

    state = play(state, days - 1);
    expect(state.armies[FIXTURE.romanArmy]?.formations).toHaveLength(2);

    state = tick(state, []).state;
    const formations = state.armies[FIXTURE.romanArmy]?.formations ?? [];
    expect(formations).toHaveLength(3);
    const raised = state.formations[formations[2] as FormationId];
    expect(raised).toMatchObject({ troop: 'spearmen', men, morale: 1 });
    expect(state.cities[FIXTURE.roma]?.recruits).toEqual([]);
    expect(Object.keys(state.armies)).toHaveLength(2);
    expectConsistent(state);
  });

  test('a recruit at a city with no idle army of its owner forms a new army there', () => {
    let state = tick(buildFixture(), [
      { kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.capua, troop: 'archers' },
    ]).state;
    state = play(state, TROOPS.archers.recruit.days);
    const raised = Object.values(state.armies).filter(
      (army) => army.id !== FIXTURE.romanArmy && army.owner === FIXTURE.rome,
    );
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      generalSkill: 0,
      activity: { kind: 'idle', position: { x: 1300, y: 660 } },
    });
    expect(raised[0] && menOf(state, raised[0])).toBe(TROOPS.archers.recruit.men);
    expectConsistent(state);
  });

  test('a save and load during training continues the recruitment unchanged', () => {
    let state = tick(buildFixture(), [
      { kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.roma, troop: 'heavyCavalry' },
    ]).state;
    state = play(state, 10);
    const loaded = loadGame(saveGame(state));
    if (!loaded.ok) throw new Error(loaded.error);
    const kept = play(state, 25);
    const reloaded = play(loaded.state, 25);
    expect(reloaded).toStrictEqual(kept);
    expect(reloaded.armies[FIXTURE.romanArmy]?.formations).toHaveLength(3);
    expectConsistent(reloaded);
  });

  test('the same seed and orders give the same state', () => {
    const run = () => {
      let state = buildFixture(9);
      executeOrder(state, {
        kind: 'declareWar',
        faction: FIXTURE.rome,
        against: FIXTURE.carthage,
      });
      state = tick(state, [
        { kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.capua, troop: 'swordsmen' },
        { kind: 'recruit', faction: FIXTURE.carthage, city: FIXTURE.carthago, troop: 'spearmen' },
        {
          kind: 'evacuate',
          faction: FIXTURE.rome,
          city: FIXTURE.capua,
          to: FIXTURE.roma,
          share: 0.3,
        },
      ]).state;
      return play(state, 60);
    };
    const state = run();
    expect(run()).toStrictEqual(state);
    expectConsistent(state);
  });
});
