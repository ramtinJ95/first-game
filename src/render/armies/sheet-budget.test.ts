import { describe, expect, it } from 'vitest';
import { sheetsOverBudget, type HeldSheet } from './sheet-budget.ts';

const sheet = (key: string, bytes: number, usedAt: number, inUse = false): HeldSheet<string> => ({
  key,
  bytes,
  usedAt,
  inUse,
});

describe('sheetsOverBudget', () => {
  it('keeps every sheet while they fit the budget', () => {
    expect(sheetsOverBudget([sheet('a', 40, 1), sheet('b', 60, 2)], 100)).toEqual([]);
  });

  it('lets go of the sheets used longest ago until the rest fit', () => {
    const sheets = [sheet('new', 50, 30), sheet('old', 50, 10), sheet('middle', 50, 20)];
    expect(sheetsOverBudget(sheets, 100)).toEqual(['old']);
    expect(sheetsOverBudget(sheets, 60)).toEqual(['old', 'middle']);
  });

  it('never lets go of a sheet in use, however old', () => {
    const sheets = [sheet('drawn', 80, 1, true), sheet('idle', 30, 5), sheet('recent', 30, 9)];
    expect(sheetsOverBudget(sheets, 110)).toEqual(['idle']);
  });

  it('keeps the sheets in use alone when they pass the budget', () => {
    const sheets = [sheet('a', 90, 1, true), sheet('b', 90, 2, true), sheet('c', 10, 3)];
    expect(sheetsOverBudget(sheets, 100)).toEqual(['c']);
  });
});
