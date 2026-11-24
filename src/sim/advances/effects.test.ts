import { describe, expect, test } from 'vitest';
import { changeCityOwner, UNREST_DAYS } from '../cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import { deterrentUntil, GUARD_DAYS, GUARD_DETER_DAYS, guardRefusal } from '../guards.ts';
import { executeOrder } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import {
  dailyBalances,
  FOOD_PER_PERSON,
  limitsOf,
  OUTPUT_PER_PERSON,
  UPKEEP_PER_MAN,
  menOf,
} from '../systems/economy.ts';
import { wallWear } from '../systems/sieges.ts';
import { tick } from '../tick.ts';
import { openTrade } from '../trade/orders.ts';
import { tradeIncome } from '../trade/routes.ts';
import { ADVANCES, type AdvanceKind } from './advances.ts';
import { advanceGain } from './gains.ts';

const world = fixtureWorld();

function rome(state: GameState) {
  const record = state.factions[FIXTURE.rome];
  if (!record) throw new Error('expected Rome');
  return record;
}

/** The fixture with Rome's armies away, so a sum shows the cities alone. */
function citiesAlone(): GameState {
  const state = buildFixture();
  state.armies = {};
  state.formations = {};
  return state;
}

function withAdvance(state: GameState, kind: AdvanceKind): GameState {
  const copy = structuredClone(state);
  rome(copy).advances = [kind];
  return copy;
}

const romanPeople = (state: GameState) =>
  Object.values(state.cities)
    .filter((city) => city.owner === FIXTURE.rome)
    .reduce((sum, city) => sum + city.population, 0);

describe('what each advance does', () => {
  test('with no advance, every sum is the rules of before', () => {
    const state = citiesAlone();
    const people = romanPeople(state);
    const balance = dailyBalances(state).get(FIXTURE.rome);
    expect(balance?.gold).toBeCloseTo(people * OUTPUT_PER_PERSON.gold, 6);
    expect(balance?.food).toBeCloseTo(people * (OUTPUT_PER_PERSON.food - FOOD_PER_PERSON), 6);
  });

  test('Standard coin: every city yields a fifth more gold', () => {
    const state = citiesAlone();
    const gold = romanPeople(state) * OUTPUT_PER_PERSON.gold;
    expect(advanceGain(state, FIXTURE.rome, 'standardCoin').daily.gold).toBeCloseTo(
      gold * (ADVANCES.standardCoin.goldShare - 1),
      6,
    );
    expect(dailyBalances(withAdvance(state, 'standardCoin')).get(FIXTURE.rome)?.gold).toBeCloseTo(
      gold * 1.2,
      6,
    );
  });

  test('Fallow fields: the people grow a fifth more food, and eat as before', () => {
    const state = citiesAlone();
    const grown = romanPeople(state) * OUTPUT_PER_PERSON.food;
    expect(advanceGain(state, FIXTURE.rome, 'fallowFields').daily.food).toBeCloseTo(
      grown * (ADVANCES.fallowFields.foodShare - 1),
      6,
    );
  });

  test('Citizen rolls: a tenth more manpower a day and a tenth more to call up', () => {
    const state = citiesAlone();
    const before = limitsOf(state).get(FIXTURE.rome)?.manpower ?? 0;
    const daily = dailyBalances(state).get(FIXTURE.rome)?.manpower ?? 0;
    const gain = advanceGain(state, FIXTURE.rome, 'citizenRolls');
    expect(gain.daily.manpower).toBeCloseTo(daily * 0.1, 6);
    expect(gain.limits.manpower).toBeCloseTo(before * 0.1, 6);
  });

  test('Marching rations: each man under arms eats a tenth less', () => {
    const state = buildFixture();
    const men = Object.values(state.armies)
      .filter((army) => army.owner === FIXTURE.rome)
      .reduce((sum, army) => sum + menOf(state, army), 0);
    expect(men).toBeGreaterThan(0);
    expect(advanceGain(state, FIXTURE.rome, 'marchingRations').daily.food).toBeCloseTo(
      men * UPKEEP_PER_MAN.food * (1 - ADVANCES.marchingRations.foodShare),
      6,
    );
  });

  test("Market weights: a route pays the realm's ends a fifth more, and the partner as before", () => {
    const state = buildFixture();
    const carthage = state.factions[FIXTURE.carthage];
    if (!carthage) throw new Error('expected Carthage');
    rome(state).stores.gold = carthage.stores.gold = 50_000;
    expect(
      openTrade(
        state,
        {
          kind: 'openTrade',
          faction: FIXTURE.rome,
          from: FIXTURE.roma,
          to: FIXTURE.carthago,
          mode: 'sea',
        },
        world,
      ),
    ).toBeUndefined();
    const route = Object.values(state.tradeRoutes)[0];
    if (!route) throw new Error('expected a route');
    route.status = 'running';
    const before = tradeIncome(state);
    const after = tradeIncome(withAdvance(state, 'marketWeights'));
    expect(before.get(FIXTURE.rome)).toBeGreaterThan(0);
    expect(after.get(FIXTURE.rome)).toBeCloseTo((before.get(FIXTURE.rome) ?? 0) * 1.2, 6);
    expect(after.get(FIXTURE.carthage)).toBeCloseTo(before.get(FIXTURE.carthage) ?? 0, 6);
  });

  test('Siege engineers: besiegers wear walls down half again as fast', () => {
    const state = buildFixture();
    const armies = Object.values(state.armies).filter((army) => army.owner === FIXTURE.rome);
    expect(wallWear(withAdvance(state, 'siegeEngineers'), armies)).toBeCloseTo(
      wallWear(state, armies) * 1.5,
      9,
    );
  });

  test('Clemency: a city the realm takes has half the days of unrest', () => {
    const state = withAdvance(buildFixture(), 'clemency');
    changeCityOwner(state, FIXTURE.syracusae, FIXTURE.rome);
    expect(state.cities[FIXTURE.syracusae]?.unrestDays).toBe(UNREST_DAYS / 2);
    const plain = buildFixture();
    changeCityOwner(plain, FIXTURE.syracusae, FIXTURE.rome);
    expect(plain.cities[FIXTURE.syracusae]?.unrestDays).toBe(UNREST_DAYS);
    expectConsistent(state);
  });

  test('Long contracts: a band serves 18 months, and great powers still count it 90 days', () => {
    const state = withAdvance(buildFixture(), 'longContracts');
    rome(state).stores.gold = 50_000;
    expect(
      executeOrder(state, { kind: 'hireGuards', faction: FIXTURE.rome, city: FIXTURE.roma }, world),
    ).toBeUndefined();
    const band = state.cities[FIXTURE.roma]?.guards[0];
    if (!band) throw new Error('expected a band');
    expect(band.until - state.day).toBe(Math.round(GUARD_DAYS * 1.5));
    expect(deterrentUntil(band) - state.day).toBe(GUARD_DETER_DAYS);
    expectConsistent(state);
  });

  test('Long contracts: a full city may replace an 18-month band once it is hired more than 90 days ago, and not before', () => {
    const state = withAdvance(buildFixture(), 'longContracts');
    rome(state).stores.gold = 50_000;
    const term = Math.round(GUARD_DAYS * 1.5);
    const hired = (day: number) => ({ until: (day + term) as Day, hiredOn: day as Day });
    const capua = state.cities[FIXTURE.capua];
    if (!capua) throw new Error('expected Capua');
    const fresh = hired(state.day - GUARD_DETER_DAYS + 1);
    capua.guards = [fresh, fresh, fresh];
    const order = { kind: 'hireGuards', faction: FIXTURE.rome, city: FIXTURE.capua } as const;
    expect(guardRefusal(state, capua, FIXTURE.rome)).toBe(
      'capua holds 1500 guards, and 1500 is the most it can',
    );
    const stale = hired(state.day - GUARD_DETER_DAYS);
    capua.guards = [fresh, stale, fresh];
    expect(executeOrder(state, order, world)).toBeUndefined();
    expect(capua.guards).toEqual([fresh, fresh, hired(state.day)]);
    expectConsistent(state);
  });

  test('Drillmasters: generals rise to 5 when study ends, none falls, and new armies start at 5', () => {
    const state = buildFixture();
    rome(state).study = { advance: 'drillmasters', daysLeft: 1, paid: 3000 };
    const [first, second] = Object.values(state.armies).filter((a) => a.owner === FIXTURE.rome);
    if (!first) throw new Error('expected a Roman army');
    first.generalSkill = 3;
    if (second) second.generalSkill = 7;
    const after = tick(state, [], world).state;
    expect(after.armies[first.id]?.generalSkill).toBe(ADVANCES.drillmasters.generalSkill);
    if (second) expect(after.armies[second.id]?.generalSkill).toBe(7);
    const carthaginian = Object.values(after.armies).find((a) => a.owner === FIXTURE.carthage);
    expect(carthaginian?.generalSkill).toBe(3);
    expectConsistent(after);
  });
});
