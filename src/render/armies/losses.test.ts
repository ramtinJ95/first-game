import { describe, expect, test } from 'vitest';
import type { FormationId } from '../../sim/ids.ts';
import type { Formation } from '../../sim/state/formation.ts';
import type { ArmyId } from '../../sim/ids.ts';
import { formationDay } from './losses.ts';

const formation = (men: number, morale = 1): Formation => ({
  id: 'formation-1' as FormationId,
  army: 'army-1' as ArmyId,
  troop: 'spearmen',
  men,
  morale,
});

describe('formationDay', () => {
  test('a formation that loses no figure has no falls', () => {
    const day = formationDay(formation(1000), formation(980), 4, 8);
    expect(day).toMatchObject({
      before: 20,
      after: 20,
      falls: [],
      steps: [],
      breaksAt: undefined,
      broken: false,
    });
  });

  test("each figure lost falls once, in the front ranks, early enough to lie down by the day's end", () => {
    const day = formationDay(formation(1000), formation(800), 4, 8);
    expect(day.falls).toHaveLength(4);
    expect(new Set(day.falls.map((f) => f.slot)).size).toBe(4);
    for (const fall of day.falls) {
      expect(fall.slot).toBeLessThan(8);
      expect(fall.at).toBeGreaterThanOrEqual(0);
      expect(fall.at).toBeLessThan(0.6);
    }
  });

  test('the figures the day no longer counts step into the places of the fallen', () => {
    const day = formationDay(formation(1000), formation(800), 4, 8);
    expect(day.steps.map((s) => s.from).sort()).toEqual([16, 17, 18, 19]);
    expect(day.steps.map((s) => s.to).sort()).toEqual(day.falls.map((f) => f.slot).sort());
    for (const step of day.steps) {
      const fall = day.falls.find((f) => f.slot === step.to);
      expect(step.at).toBeGreaterThan(fall?.at ?? 1);
    }
  });

  test('a formation that loses every man falls where it stands', () => {
    const day = formationDay(formation(300), undefined, 4, 8);
    expect(day.after).toBe(0);
    expect(day.falls.map((f) => f.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(day.steps).toEqual([]);
  });

  test('a formation whose morale reaches zero breaks during the day', () => {
    const day = formationDay(formation(1000, 0.1), formation(900, 0), 4, 8);
    expect(day.breaksAt).toBeGreaterThan(0);
    expect(day.breaksAt).toBeLessThan(1);
    expect(day.broken).toBe(false);
  });

  test('a formation broken on both days stays broken without breaking again', () => {
    expect(formationDay(formation(900, 0), formation(900, 0), 5, 8)).toMatchObject({
      breaksAt: undefined,
      broken: true,
    });
  });

  test('the same two days always give the same falls', () => {
    expect(formationDay(formation(1000), formation(700), 9, 8)).toEqual(
      formationDay(formation(1000), formation(700), 9, 8),
    );
  });
});
