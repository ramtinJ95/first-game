import { describe, expect, it } from 'vitest';
import { sheetsOverBudget, type HeldSheet } from './sheet-budget.ts';

const sheet = (
  key: string,
  bytes: number,
  { distance = 0, usedAt = 0, inUse = false }: Partial<HeldSheet<string>> = {},
): HeldSheet<string> => ({ key, bytes, distance, usedAt, inUse });

describe('sheetsOverBudget', () => {
  it('keeps every sheet while they fit the budget', () => {
    expect(sheetsOverBudget([sheet('a', 40), sheet('b', 60)], 100)).toEqual([]);
  });

  it('lets go of the sizes furthest from the one in view first', () => {
    const sheets = [
      sheet('next size', 50, { distance: 1, usedAt: 1 }),
      sheet('far size', 50, { distance: 3, usedAt: 9 }),
      sheet('two sizes off', 50, { distance: 2, usedAt: 5 }),
    ];
    expect(sheetsOverBudget(sheets, 100)).toEqual(['far size']);
    expect(sheetsOverBudget(sheets, 60)).toEqual(['far size', 'two sizes off']);
  });

  it('of sheets as far from the view, lets go of the one used longest ago', () => {
    const sheets = [
      sheet('recent', 50, { distance: 1, usedAt: 9 }),
      sheet('old', 50, { distance: 1, usedAt: 2 }),
    ];
    expect(sheetsOverBudget(sheets, 60)).toEqual(['old']);
  });

  it('never lets go of a sheet in use, however far or old', () => {
    const sheets = [
      sheet('drawn', 80, { distance: 4, usedAt: 1, inUse: true }),
      sheet('idle', 30, { distance: 1, usedAt: 5 }),
    ];
    expect(sheetsOverBudget(sheets, 100)).toEqual(['idle']);
  });

  it('keeps the sheets in use alone when they pass the budget', () => {
    const sheets = [
      sheet('a', 90, { inUse: true }),
      sheet('b', 90, { inUse: true }),
      sheet('c', 10, { distance: 1 }),
    ];
    expect(sheetsOverBudget(sheets, 100)).toEqual(['c']);
  });
});
