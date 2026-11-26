import { describe, expect, test } from 'vitest';
import { playTrial, TRIAL_ARMIES, type ArmySpec } from './battle-trial.ts';
import { fixtureWorld } from './fixture.ts';
import { expectConsistent } from './references.ts';
import { tick } from './tick.ts';
import { TROOPS, type Troop } from './troops.ts';

const SEEDS = 20;

/** Army a against army b over the seeds: how often a wins, its mean days, and the mean share of men each keeps. */
function trial(a: ArmySpec, b: ArmySpec) {
  const results = Array.from({ length: SEEDS }, (_, seed) =>
    playTrial({ name: '', a, b }, seed + 1),
  );
  for (const result of results) expectConsistent(result.state);
  const mean = (pick: (r: (typeof results)[number]) => number) =>
    results.reduce((sum, r) => sum + pick(r), 0) / SEEDS;
  return {
    wins: results.filter((r) => r.winner === 'a').length / SEEDS,
    days: mean((r) => r.days),
    keeps: mean((r) => r.kept.a),
    enemyKeeps: mean((r) => r.kept.b),
  };
}

/** The men of `other` that the gold for `men` of `troop` raises. */
const sameGold = (troop: Troop, men: number, other: Troop) =>
  Math.round(
    ((men / TROOPS[troop].recruit.men) * TROOPS[troop].recruit.gold * TROOPS[other].recruit.men) /
      TROOPS[other].recruit.gold,
  );

const alone = (
  troop: Troop,
  men: number,
  stance: ArmySpec['stance'] = 'holdTheLine',
): ArmySpec => ({
  troops: { [troop]: men },
  stance,
});

describe("each power's own troop does better than the troop it resembles where its idea says", () => {
  test('legionaries beat swordsmen in a held line, and not in an assault', () => {
    const swords = alone('swordsmen', 3000);
    expect(trial(alone('legionaries', 3000), swords).wins).toBeGreaterThan(
      trial(alone('swordsmen', 3000), swords).wins + 0.2,
    );
    const charging = alone('swordsmen', 3000, 'allOutAssault');
    expect(trial(alone('legionaries', 3000, 'allOutAssault'), charging).wins).toBeLessThan(
      trial(alone('swordsmen', 3000, 'allOutAssault'), charging).wins + 0.2,
    );
  });

  test('triarii outnumbered two to one hold longer than spearmen', () => {
    const many = alone('swordsmen', 3600);
    expect(trial(alone('triarii', 1800), many).days).toBeGreaterThan(
      trial(alone('spearmen', 1800), many).days + 1,
    );
  });

  test('war elephants cut down more foot than heavy cavalry of the same gold, and break sooner', () => {
    const foot = alone('swordsmen', 3000);
    const elephants = trial(alone('warElephants', 1200), foot);
    const horse = trial(
      alone('heavyCavalry', sameGold('warElephants', 1200, 'heavyCavalry')),
      foot,
    );
    expect(elephants.enemyKeeps).toBeLessThan(horse.enemyKeeps - 0.05);
    expect(elephants.days).toBeLessThan(horse.days);
  });

  test('phalangites lose fewer men to a cavalry charge than spearmen, and more to arrows', () => {
    const charge = alone('heavyCavalry', 2000);
    expect(trial(alone('phalangites', 3000), charge).keeps).toBeGreaterThan(
      trial(alone('spearmen', 3000), charge).keeps + 0.03,
    );
    const arrows = alone('archers', 3000);
    expect(trial(alone('phalangites', 3000), arrows).keeps).toBeLessThan(
      trial(alone('spearmen', 3000), arrows).keeps,
    );
  });

  test('companion cavalry cut down more foot than heavy cavalry', () => {
    const foot = alone('swordsmen', 3000);
    expect(trial(alone('companionCavalry', 1600), foot).enemyKeeps).toBeLessThan(
      trial(alone('heavyCavalry', 1600), foot).enemyKeeps - 0.05,
    );
  });

  test('Nile archers outlast archers against foot, and not against horse', () => {
    const foot = alone('swordsmen', 2000);
    expect(trial(alone('nileArchers', 2000), foot).days).toBeGreaterThan(
      trial(alone('archers', 2000), foot).days + 1,
    );
    const horse = alone('lightCavalry', 1600);
    expect(trial(alone('nileArchers', 2000), horse).keeps).toBeCloseTo(
      trial(alone('archers', 2000), horse).keeps,
      1,
    );
  });

  test('chariots beat archers more often than light cavalry, and not foot', () => {
    const bows = alone('archers', 2000);
    expect(trial(alone('chariots', 1200), bows).wins).toBeGreaterThan(
      trial(alone('lightCavalry', 1200), bows).wins + 0.3,
    );
    const foot = alone('swordsmen', 1600);
    expect(trial(alone('chariots', 1200), foot).keeps).toBeLessThanOrEqual(
      trial(alone('lightCavalry', 1200), foot).keeps,
    );
  });

  test('cataphracts lose fewer men to arrows than heavy cavalry', () => {
    const bows = alone('archers', 3000);
    expect(trial(alone('cataphracts', 1600), bows).keeps).toBeGreaterThan(
      trial(alone('heavyCavalry', 1600), bows).keeps + 0.1,
    );
  });

  test('horse archers outlast light cavalry against foot, and lose to archers', () => {
    const foot = alone('swordsmen', 2000);
    expect(trial(alone('horseArchers', 1600), foot).days).toBeGreaterThan(
      trial(alone('lightCavalry', 1600), foot).days + 1,
    );
    expect(trial(alone('horseArchers', 1600), alone('archers', 2000)).wins).toBeLessThan(0.2);
  });

  test('Numidian horse and chariots march faster than light cavalry, and Numidian horse lose to it in battle', () => {
    const marched = (troop: Troop) => {
      const state = playTrial(
        { name: '', a: alone(troop, 400), b: alone('spearmen', 50) },
        1,
      ).state;
      const army = state.armies[TRIAL_ARMIES.a];
      if (army?.activity.kind !== 'idle') throw new Error('the trial army did not hold the field');
      const from = army.activity.position;
      army.activity = {
        kind: 'marching',
        position: { ...from },
        waypoints: [{ x: from.x, y: from.y + 200 }],
      };
      const after = tick(state, [], fixtureWorld()).state;
      const moved = after.armies[TRIAL_ARMIES.a]?.activity;
      expectConsistent(after);
      return moved?.kind === 'marching' ? moved.position.y - from.y : 0;
    };
    expect(marched('numidianHorse')).toBeCloseTo(
      marched('lightCavalry') * TROOPS.numidianHorse.pace,
    );
    expect(marched('chariots')).toBeGreaterThan(marched('lightCavalry'));
    expect(trial(alone('numidianHorse', 1600), alone('lightCavalry', 1600)).wins).toBeLessThan(0.4);
  });
});
