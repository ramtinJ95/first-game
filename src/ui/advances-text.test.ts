import { describe, expect, test } from 'vitest';
import { ADVANCES } from '../sim/advances/advances.ts';
import { buildFixture, FIXTURE, growRome } from '../sim/fixture.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { advancesView, buildingFirstLine, studyLine } from './advances-text.ts';

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
    rome(busy).study = { advance: 'citizenRolls', daysLeft: 12, paid: 3000 };
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
    rome(state).study = { advance: 'fallowFields', daysLeft: 1, paid: 6000 };
    expect(studyLine(state, FIXTURE.rome)).toEqual({
      short: 'Fallow fields · 1 day',
      days: '1 day',
      full: 'Studying Fallow fields: 1 day left.',
    });
  });

  test('a realm past 8 cities reads the price it pays, and why it is above the listed price', () => {
    const state = buildFixture();
    growRome(state, 12);
    expect(row(state, 'standardCoin')?.gold).toBe(9000);
    expect(row(state, 'standardCoin')?.why).toBe(
      'Listed at 6,000 gold for a realm of up to 8 cities. It adds to every city, so your 12 cities pay 6,000 × 12 ÷ 8.',
    );
    expect(row(state, 'clemency')).toMatchObject({ gold: ADVANCES.clemency.gold });
    expect(row(state, 'clemency')?.why).toBeUndefined();
    expect(row(buildFixture(), 'standardCoin')?.why).toBeUndefined();
  });

  test('names a building that pays back sooner than any advance, though the treasury cannot pay for it yet, and marks no advance, until no city could start one', () => {
    const state = buildFixture();
    rome(state).stores.gold = 50_000;
    const marked = (s: GameState) =>
      advancesView(s, FIXTURE.rome, [])
        .flatMap((branch) => branch.rows)
        .filter((r) => r.suggested)
        .map((r) => r.kind);
    expect(buildingFirstLine(state, FIXTURE.rome)).toBe(
      'Building Forum at Roma would pay back in 2.1 years, sooner than any advance you can start: the soonest, Citizen rolls, takes 3.4. Build first, and study with the gold left.',
    );
    expect(marked(state)).toEqual([]);
    rome(state).stores.gold = 3_500;
    expect(buildingFirstLine(state, FIXTURE.rome)).toMatch(
      /^Building Forum at Roma would pay back/,
    );
    expect(marked(state)).toEqual([]);
    for (const city of Object.values(state.cities))
      if (city.owner === FIXTURE.rome) city.construction = { building: 'temple', daysLeft: 300 };
    expect(buildingFirstLine(state, FIXTURE.rome)).toBeUndefined();
    expect(marked(state)).toEqual(['citizenRolls']);
  });

  test('a food advance pays nothing while the food already feeds 2,000 more men, and says so', () => {
    const thin = buildFixture();
    expect(row(thin, 'marchingRations')?.payback).toMatch(/^Pays back in \d+\.\d years$/);
    const full = buildFixture();
    growRome(full, 16);
    for (const kind of ['marchingRations', 'fallowFields'])
      expect(row(full, kind)?.payback).toBe(
        'Pays nothing back today: your food already feeds 2,000 more men than you keep',
      );
    expect(row(full, 'longContracts')?.payback).toBe('Pays nothing back today');
  });
});
