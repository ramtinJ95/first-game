import { describe, expect, test } from 'vitest';
import { ADVANCES } from '../sim/advances/advances.ts';
import { buildFixture, FIXTURE } from '../sim/fixture.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { advancesView, studyLine } from './advances-text.ts';

function rome(state: GameState) {
  const record = state.factions[FIXTURE.rome];
  if (!record) throw new Error('expected Rome');
  return record;
}

const row = (state: GameState, kind: string, pending = [] as Parameters<typeof advancesView>[2]) =>
  advancesView(state, FIXTURE.rome, pending)
    .flatMap((branch) => branch.rows)
    .find((r) => r.kind === kind);

describe('the advances panel', () => {
  test('shows three branches of three, each with its price and days', () => {
    const view = advancesView(buildFixture(), FIXTURE.rome, []);
    expect(view.map((branch) => [branch.name, branch.rows.length])).toEqual([
      ['Military', 3],
      ['Economy', 3],
      ['Statecraft', 3],
    ]);
    const coin = row(buildFixture(), 'standardCoin');
    expect(coin).toMatchObject({
      gold: ADVANCES.standardCoin.gold,
      days: ADVANCES.standardCoin.days,
    });
  });

  test('says what the realm lacks to start one, and that one study runs at a time', () => {
    const poor = buildFixture();
    rome(poor).stores.gold = ADVANCES.clemency.gold - 100;
    expect(row(poor, 'clemency')?.refusal).toBe('Needs 100 more gold');

    const busy = buildFixture();
    rome(busy).stores.gold = 50_000;
    rome(busy).study = { advance: 'citizenRolls', daysLeft: 12 };
    expect(row(busy, 'citizenRolls')?.status).toBe('studying');
    expect(row(busy, 'clemency')?.refusal).toBe('Studying Citizen rolls; one at a time');
  });

  test('shows an advance ordered for the next day and holds the others back', () => {
    const state = buildFixture();
    rome(state).stores.gold = 50_000;
    const pending = [{ kind: 'study', faction: FIXTURE.rome, advance: 'clemency' } as const];
    expect(row(state, 'clemency', pending)?.status).toBe('ordered');
    expect(row(state, 'standardCoin', pending)?.refusal).toBe(
      'Clemency is ordered for the next day',
    );
  });

  test('the top bar names what is studied and its days, or that nothing is', () => {
    const state = buildFixture();
    expect(studyLine(state, FIXTURE.rome)).toEqual({
      short: 'None studied',
      days: 'None',
      full: 'Nothing is being studied.',
    });
    rome(state).study = { advance: 'fallowFields', daysLeft: 1 };
    expect(studyLine(state, FIXTURE.rome)).toEqual({
      short: 'Fallow fields · 1 day',
      days: '1 day',
      full: 'Studying Fallow fields: 1 day left.',
    });
  });
});
