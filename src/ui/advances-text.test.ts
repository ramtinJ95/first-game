import { describe, expect, test } from 'vitest';
import { ADVANCE_KINDS, ADVANCES } from '../sim/advances/advances.ts';
import { buildFixture, FIXTURE, fixtureWorld, growRome } from '../sim/fixture.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { readFileSync } from 'node:fs';
import { worthBuilding } from '../app/building-hint.ts';
import { BUILDING_KINDS } from '../sim/buildings/buildings.ts';
import { changeCityOwner } from '../sim/cities.ts';
import type { FactionId } from '../sim/ids.ts';
import { parseMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import { dailyBalances, limitsOf } from '../sim/systems/economy.ts';
import { whole } from '../app/names.ts';
import { buildWorld } from '../sim/world/world.ts';
import {
  advancesView,
  buildingFirstLine,
  hasConquered,
  markedLine,
  studyLine,
} from './advances-text.ts';

function rome(state: GameState) {
  const record = state.factions[FIXTURE.rome];
  if (!record) throw new Error('expected Rome');
  return record;
}

const world = fixtureWorld();

const row = (state: GameState, kind: string, pending = [] as Parameters<typeof advancesView>[3]) =>
  advancesView(state, world, FIXTURE.rome, pending)
    .flatMap((branch) => branch.rows)
    .find((r) => r.kind === kind);

describe('the advances panel', () => {
  test('shows three branches of three, each with its price and days', () => {
    const view = advancesView(buildFixture(), world, FIXTURE.rome, []);
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
      advancesView(s, world, FIXTURE.rome, [])
        .flatMap((branch) => branch.rows)
        .filter((r) => r.suggested)
        .map((r) => r.kind);
    expect(buildingFirstLine(state, world, FIXTURE.rome)).toBe(
      'Building Forum at Roma would pay back in 2.1 years, sooner than any advance you can start: the soonest, Citizen rolls, takes 3.4. Build first, and study with the gold left.',
    );
    expect(marked(state)).toEqual([]);
    rome(state).stores.gold = 3_500;
    expect(buildingFirstLine(state, world, FIXTURE.rome)).toMatch(
      /^Building Forum at Roma would pay back/,
    );
    expect(marked(state)).toEqual([]);
    for (const city of Object.values(state.cities))
      if (city.owner === FIXTURE.rome) city.construction = { building: 'temple', daysLeft: 300 };
    expect(buildingFirstLine(state, world, FIXTURE.rome)).toBeUndefined();
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
  });

  test('Long contracts gives no payback in years, says where it saves gold, and is never marked', () => {
    const state = buildFixture();
    rome(state).stores.gold = 50_000;
    for (const city of Object.values(state.cities))
      if (city.owner === FIXTURE.rome) {
        city.guards = [{ until: (state.day + 300) as Day }];
        city.construction = { building: 'temple', daysLeft: 300 };
      }
    rome(state).advances = ADVANCE_KINDS.filter((kind) => kind !== 'longContracts');
    expect(row(state, 'longContracts')).toMatchObject({
      payback:
        'No payback in years: it saves gold only on guards kept to defend a city, and a band still counts 90 days against a threat whatever its term',
      suggested: false,
    });
  });

  test('a studied advance says what it gives the realm now, not "nothing yet"', () => {
    const state = buildFixture();
    rome(state).advances = ['drillmasters', 'standardCoin'];
    for (const army of Object.values(state.armies))
      if (army.owner === FIXTURE.rome) army.generalSkill = ADVANCES.drillmasters.generalSkill;
    expect(row(state, 'drillmasters')?.does).toMatch(
      /^Your armies strike as [\d,]+ more men would than under generals of skill 3, and each new army starts at skill 5$/,
    );
    expect(row(state, 'standardCoin')?.does).toMatch(/^\+\d+\.\d gold a day$/);
  });

  test('names the marked advance at the top, so it is seen without scrolling', () => {
    const state = buildFixture();
    rome(state).stores.gold = 50_000;
    for (const city of Object.values(state.cities))
      if (city.owner === FIXTURE.rome) city.construction = { building: 'temple', daysLeft: 300 };
    expect(markedLine(state, world, FIXTURE.rome)).toEqual({
      advance: 'citizenRolls',
      text: expect.stringMatching(
        /^Pays back soonest of what you can start: Citizen rolls, in \d+\.\d years\.$/,
      ),
    });
  });

  test("says how much gold a building first lacks, and in how many days today's income brings it", () => {
    const map = parseMap(
      JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
    );
    const state = newGame(map, { seed: 1, player: 'rome' });
    const realm = state.factions[state.player];
    if (!realm) throw new Error('no Rome');
    realm.stores.gold = 4_000;
    const net = dailyBalances(state).get(state.player)?.gold ?? 0;
    expect(net).toBeGreaterThan(0);
    expect(buildingFirstLine(state, buildWorld(map), state.player)).toContain(
      `It costs 6,500 gold, 2,500 more than you hold, which today's income brings in ${Math.ceil(2500 / net)} days.`,
    );
  });

  test('promises no day for a building that costs more than the treasury holds at its limit', () => {
    const state = buildFixture();
    rome(state).stores.gold = 3_500;
    const limit = limitsOf(state).get(FIXTURE.rome)?.gold ?? 0;
    expect(limit).toBeLessThan(6_500);
    const line = buildingFirstLine(state, world, FIXTURE.rome);
    expect(line).toContain(
      `It costs 6,500 gold, 3,000 more than you hold, and more than your treasury holds at its limit of ${whole(Math.floor(limit))}, so it waits until the limit grows.`,
    );
    expect(line).not.toMatch(/brings in \d+ days/);
  });

  test('holds no Temple against the advances for a realm that has taken no city, as its payback assumes one taken a year', () => {
    const map = parseMap(
      JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
    );
    const atlas = buildWorld(map);
    const state = newGame(map, { seed: 1, player: 'rome' });
    const realm = state.factions[state.player];
    if (!realm) throw new Error('no Rome');
    for (const city of Object.values(state.cities))
      if (city.owner === state.player)
        city.buildings = BUILDING_KINDS.filter((kind) => kind !== 'temple' && kind !== 'sanctuary');
    realm.advances = ADVANCE_KINDS.filter((kind) => kind !== 'clemency');
    realm.stores.gold = 20_000;
    expect(worthBuilding(state, true)?.kind).toBe('temple');
    expect(buildingFirstLine(state, atlas, state.player) ?? '').not.toMatch(/Temple|Sanctuary/);
    const taken = Object.values(state.cities).find(
      (city) => city.owner === ('carthage' as FactionId),
    );
    if (!taken) throw new Error('no Carthaginian city');
    changeCityOwner(state, taken.id, state.player);
    expect(hasConquered(state, atlas, state.player)).toBe(true);
  });
});
