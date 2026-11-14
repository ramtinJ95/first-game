import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import { BUILDINGS, CANCEL_REFUND } from '../sim/buildings/buildings.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { CITY_DEFENCES } from '../sim/systems/sieges.ts';
import { TROOPS } from '../sim/troops.ts';
import { cityBuildings } from './buildings-text.ts';
import { cityBalance, signed } from './describe.ts';

function rich(gold = 20_000): GameState {
  const state = buildFixture();
  const rome = state.factions[f.rome];
  if (rome) rome.stores.gold = gold;
  return state;
}

function roma(state: GameState) {
  const city = state.cities[f.roma];
  if (!city) throw new Error('no Roma');
  return city;
}

function option(state: GameState, kind: string, pending: Order[] = [], city = roma(state)) {
  const found = cityBuildings(state, pending, city, fixtureWorld()).options.find(
    (o) => o.kind === kind,
  );
  if (!found) throw new Error(`no option ${kind}`);
  return found;
}

describe('cityBuildings', () => {
  it("gives a Forum's gold as the rise of the city's own gold line once it stands", () => {
    const state = rich();
    const before = cityBalance(state, roma(state)).gold;
    const after = cityBalance(state, { ...roma(state), buildings: ['forum'] }).gold;
    expect(option(state, 'forum').effect).toBe(`${signed(after - before)} gold a day`);
  });

  it("gives Towers at a capital their share of the capital's full walls and garrison", () => {
    const { walls, garrison } = CITY_DEFENCES.capital;
    const { wallsShare, garrisonShare } = BUILDINGS.towers;
    expect(option(rich(), 'towers').effect).toBe(
      `+${walls * wallsShare} walls and +${(garrison * garrisonShare).toLocaleString('en')} garrison`,
    );
  });

  it('gives Barracks their manpower, their levy, and their shorter training', () => {
    expect(option(rich(), 'barracks').effect).toMatch(
      /^\+\d+\.\d manpower a day, [\d,]+ more men to call up, recruits train in half the days$/,
    );
  });

  it('gives a Temple the cities of the owner in its reach', () => {
    const { unrestPace, reachKm } = BUILDINGS.temple;
    expect(option(rich(), 'temple').effect).toBe(
      `unrest counts down ${unrestPace} days a day in 2 cities within ${reachKm} km`,
    );
  });

  it('says how much more gold a building needs when gold is all it lacks', () => {
    const state = rich(BUILDINGS.towers.gold - 1000);
    expect(option(state, 'towers').why).toBe('Needs 1,000 more gold');
    expect(option(state, 'temple').why).toBeUndefined();
  });

  it('counts the gold of a recruit waiting for the next day', () => {
    const state = rich(BUILDINGS.towers.gold + 500);
    const spearmen: Order = { kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' };
    expect(option(state, 'towers', [spearmen]).why).toBe(
      `Needs ${(TROOPS.spearmen.recruit.gold - 500).toLocaleString('en')} more gold`,
    );
  });

  it('says in words why a city too small cannot start a Forum', () => {
    const state = rich();
    const capua = state.cities[f.capua];
    if (!capua) throw new Error('no Capua');
    capua.population = BUILDINGS.forum.needs.people - 2000;
    expect(option(state, 'forum', [], capua).why).toBe(
      `Forum needs ${BUILDINGS.forum.needs.people.toLocaleString('en')} people, but Capua has ${capua.population.toLocaleString('en')}`,
    );
  });

  it('shows a build waiting for the next day as ordered, and says once that the city builds one at a time', () => {
    const state = rich();
    const order: Order = { kind: 'build', faction: f.rome, city: f.roma, building: 'canals' };
    const shown = cityBuildings(state, [order], roma(state), fixtureWorld());
    expect(shown.work).toEqual({ kind: 'ordered', building: 'canals', name: 'Canals' });
    expect(shown.blocked).toBe('Roma is building Canals');
    expect(shown.options.map((o) => o.kind)).toEqual(['forum', 'barracks', 'towers', 'temple']);
    expect(shown.options.every((o) => o.why === undefined)).toBe(true);
  });

  it('budgets a waiting trade investment before offering a building with the same gold', () => {
    const state = rich(7000);
    expect(option(state, 'forum').why).toBeUndefined();
    const trade: Order = {
      kind: 'openTrade',
      faction: f.rome,
      from: f.roma,
      to: f.capua,
      mode: 'land',
    };
    expect(option(state, 'forum', [trade]).why).toContain('gold');
  });

  it('shows the building under way with its days, what a cancel gives back, and a waiting cancel', () => {
    const state = rich();
    roma(state).construction = { building: 'forum', daysLeft: 12 };
    const cancel: Order = { kind: 'cancelBuilding', faction: f.rome, city: f.roma };
    expect(cityBuildings(state, [], roma(state), fixtureWorld()).work).toEqual({
      kind: 'working',
      building: 'forum',
      name: 'Forum',
      daysLeft: 12,
      paused: undefined,
      refund: BUILDINGS.forum.gold * CANCEL_REFUND,
      cancelOrdered: false,
    });
    expect(cityBuildings(state, [cancel], roma(state), fixtureWorld()).work).toMatchObject({
      cancelOrdered: true,
    });
  });

  it('says the work stands still while the city is in unrest, and that nothing starts then', () => {
    const state = rich();
    roma(state).unrestDays = 30;
    expect(cityBuildings(state, [], roma(state), fixtureWorld()).blocked).toBe(
      'Roma is in unrest for 30 more days',
    );
    roma(state).construction = { building: 'forum', daysLeft: 12 };
    expect(cityBuildings(state, [], roma(state), fixtureWorld()).work).toMatchObject({
      paused: 'paused while the city is in unrest',
    });
  });

  it('lists what stands with its effect and offers only the rest', () => {
    const state = rich();
    roma(state).buildings = ['forum'];
    const shown = cityBuildings(state, [], roma(state), fixtureWorld());
    expect(shown.built.map((b) => b.name)).toEqual(['Forum']);
    expect(shown.built[0]?.effect).toMatch(/^\+\d+\.\d gold a day$/);
    expect(shown.options.map((o) => o.kind)).toEqual(['canals', 'barracks', 'towers', 'temple']);
  });
});
