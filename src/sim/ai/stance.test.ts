import { describe, expect, test } from 'vitest';
import { buildTrial, TRIAL_ARMIES } from '../battle-trial.ts';
import { FIXTURE, fixtureWorld } from '../fixture.ts';
import { expectConsistent } from '../references.ts';
import type { Stance } from '../state/army.ts';
import type { Day } from '../state/day.ts';
import { REFORM_DAYS } from '../systems/battles.ts';
import { tick } from '../tick.ts';
import { decideOrders } from './decide.ts';

const world = fixtureWorld();

function battleAgainst(stance: Stance) {
  const trial = buildTrial(
    {
      name: '',
      a: { troops: { spearmen: 1500, swordsmen: 900 }, stance },
      b: { troops: { spearmen: 1500, swordsmen: 900 }, stance },
    },
    1,
  );
  const { state } = tick(trial, [], world);
  expect(state.armies[TRIAL_ARMIES.b]?.activity.kind).toBe('inBattle');
  return state;
}

describe('the stance a power chooses in a battle', () => {
  test.each([
    ['holdTheLine', 'skirmishAndWithdraw'],
    ['allOutAssault', 'holdTheLine'],
    ['skirmishAndWithdraw', 'allOutAssault'],
  ] as const)('against an enemy that chose %s it chooses %s', (theirs, answer) => {
    const state = battleAgainst(theirs);
    const orders = decideOrders(state, world, FIXTURE.carthage);
    expect(orders).toContainEqual({
      kind: 'setStance',
      faction: FIXTURE.carthage,
      army: TRIAL_ARMIES.b,
      stance: answer,
    });
    expectConsistent(state);
  });

  test('an army already in the answering stance keeps it', () => {
    const state = battleAgainst('allOutAssault');
    const army = state.armies[TRIAL_ARMIES.b];
    if (army) army.stance = 'holdTheLine';
    const orders = decideOrders(state, world, FIXTURE.carthage);
    expect(orders.filter((order) => order.kind === 'setStance')).toEqual([]);
  });

  const changesOf = (state: ReturnType<typeof battleAgainst>) =>
    decideOrders(state, world, FIXTURE.carthage).filter((order) => order.kind === 'setStance');

  const inBattle = (
    theirs: Stance,
    ours: Stance,
    changedDaysAgo: number,
    battleDaysAgo: number,
  ) => {
    const state = battleAgainst(theirs);
    const army = state.armies[TRIAL_ARMIES.b];
    const battle = Object.values(state.battles)[0];
    if (!army || !battle) throw new Error('no battle');
    army.stance = ours;
    army.stanceChangedOn = (state.day - changedDaysAgo) as Day;
    battle.startedOn = (state.day - battleDaysAgo) as Day;
    return state;
  };

  test('an army does not change its stance again while it re-forms', () => {
    expect(changesOf(inBattle('holdTheLine', 'allOutAssault', REFORM_DAYS - 1, 5))).toEqual([]);
  });

  test('after its first choice in a battle, an army that is not beaten keeps its stance', () => {
    expect(changesOf(inBattle('holdTheLine', 'holdTheLine', REFORM_DAYS, 5))).toEqual([]);
    expect(
      changesOf(inBattle('skirmishAndWithdraw', 'skirmishAndWithdraw', REFORM_DAYS, 5)),
    ).toEqual([]);
  });

  test('after its first choice in a battle, an army that is beaten changes again', () => {
    expect(changesOf(inBattle('allOutAssault', 'skirmishAndWithdraw', REFORM_DAYS, 5))).toEqual([
      { kind: 'setStance', faction: FIXTURE.carthage, army: TRIAL_ARMIES.b, stance: 'holdTheLine' },
    ]);
  });
});
