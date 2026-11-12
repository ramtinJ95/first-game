import { describe, expect, test } from 'vitest';
import { ENSLAVE, FATE_DAYS, SACK } from '../cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import { expectConsistent } from '../references.ts';
import type { GameState } from '../state/game-state.ts';
import { dailyBalances, OUTPUT_PER_PERSON } from '../systems/economy.ts';
import { tick } from '../tick.ts';
import { executeOrder, type Order } from './orders.ts';

const world = fixtureWorld();

const NEAR_CAPUA = { x: 2641.8, y: 2448.3 };
const sack: Order = { kind: 'sack', faction: FIXTURE.carthage, city: FIXTURE.capua };
const enslave: Order = { kind: 'enslave', faction: FIXTURE.carthage, city: FIXTURE.capua };

/** Carthage starves Capua out on day 2. The state is the morning of day 3. */
function capuaFallen(): GameState {
  let state = buildFixture();
  executeOrder(
    state,
    { kind: 'declareWar', faction: FIXTURE.carthage, against: FIXTURE.rome },
    world,
  );
  const punic = state.armies[FIXTURE.punicArmy];
  const roman = state.armies[FIXTURE.romanArmy];
  const capua = state.cities[FIXTURE.capua];
  if (!punic || !roman || !capua) throw new Error('the fixture is missing records');
  punic.activity = { kind: 'idle', position: NEAR_CAPUA };
  roman.activity = { kind: 'idle', position: { x: 0, y: 0 } };
  capua.foodDays = 0;
  capua.garrison = 100;
  state = tick(tick(state, [], world).state, [], world).state;
  expect(state.cities[FIXTURE.capua]).toMatchObject({ owner: FIXTURE.carthage, fellOn: 2 });
  return state;
}

function reasons(state: GameState, ...orders: Order[]): (string | undefined)[] {
  return orders.map((order) => executeOrder(state, order, world)?.reason);
}

describe('the fate of a fallen city', () => {
  test('sack takes the city gold at once, a share of its people, and a long unrest, and marks the day', () => {
    const state = capuaFallen();
    const people = state.cities[FIXTURE.capua]?.population ?? 0;
    const gold = state.factions[FIXTURE.carthage]?.stores.gold ?? 0;
    expect(executeOrder(state, sack, world)).toBeUndefined();
    expect(state.factions[FIXTURE.carthage]?.stores.gold).toBeCloseTo(
      gold + people * OUTPUT_PER_PERSON.gold * 365 * SACK.wealthYears,
      9,
    );
    expect(state.cities[FIXTURE.capua]).toMatchObject({
      population: people * (1 - SACK.populationShare),
      unrestDays: SACK.unrestDays,
      fellOn: null,
      sackedOn: 3,
    });
    expect(reasons(state, sack, enslave)).toEqual([
      'city capua has no fate left to decide',
      'city capua has no fate left to decide',
    ]);
    expectConsistent(state);
  });

  test('enslave carries off a share of the people to the capital and to manpower, for a longer unrest', () => {
    const state = capuaFallen();
    const people = state.cities[FIXTURE.capua]?.population ?? 0;
    const capital = state.cities[FIXTURE.carthago]?.population ?? 0;
    const manpower = state.factions[FIXTURE.carthage]?.stores.manpower ?? 0;
    expect(executeOrder(state, enslave, world)).toBeUndefined();
    const captives = Math.floor(people * ENSLAVE.populationShare);
    const recruits = Math.round(captives * ENSLAVE.manpowerShare);
    expect(state.cities[FIXTURE.capua]).toMatchObject({
      population: people - captives,
      unrestDays: ENSLAVE.unrestDays,
      fellOn: null,
    });
    expect(state.cities[FIXTURE.carthago]?.population).toBe(capital + captives - recruits);
    expect(state.factions[FIXTURE.carthage]?.stores.manpower).toBe(manpower + recruits);
    expect(reasons(state, enslave, sack)).toEqual([
      'city capua has no fate left to decide',
      'city capua has no fate left to decide',
    ]);
    expectConsistent(state);
  });

  test('enslaved captives go to the owner own capital even when a captured capital is larger', () => {
    const state = capuaFallen();
    const roma = state.cities[FIXTURE.roma];
    if (!roma) throw new Error('the fixture lacks Roma');
    roma.owner = FIXTURE.carthage;
    roma.population = 200_000;
    const capital = state.cities[FIXTURE.carthago]?.population ?? 0;
    expect(executeOrder(state, enslave, world)).toBeUndefined();
    expect(roma.population).toBe(200_000);
    expect(state.cities[FIXTURE.carthago]?.population).toBeGreaterThan(capital);
    expectConsistent(state);
  });

  test('a faction that lost its own capital takes captives to its most populous other city', () => {
    const state = capuaFallen();
    const carthago = state.cities[FIXTURE.carthago];
    const syracusae = state.cities[FIXTURE.syracusae];
    const roma = state.cities[FIXTURE.roma];
    if (!carthago || !syracusae || !roma) throw new Error('the fixture is missing cities');
    syracusae.owner = FIXTURE.carthage;
    roma.owner = FIXTURE.carthage;
    carthago.owner = FIXTURE.rome;
    const people = { carthago: carthago.population, syracusae: syracusae.population };
    const before = roma.population;
    expect(executeOrder(state, enslave, world)).toBeUndefined();
    expect(roma.population).toBeGreaterThan(before);
    expect(carthago.population).toBe(people.carthago);
    expect(syracusae.population).toBe(people.syracusae);
    expectConsistent(state);
  });

  test('the fate stays open for its days while an army of the new owner stands at the city', () => {
    let state = capuaFallen();
    const away = structuredClone(state);
    const punic = away.armies[FIXTURE.punicArmy];
    if (punic) punic.activity = { kind: 'idle', position: { x: 2738.8, y: 2448.3 } };
    expect(reasons(away, sack)).toEqual(['no army of carthage stands at capua']);
    expect(reasons(state, { ...sack, faction: FIXTURE.rome })).toEqual([
      'city capua belongs to carthage, not rome',
    ]);

    while (state.day < 2 + FATE_DAYS) state = tick(state, [], world).state;
    const last = structuredClone(state);
    expect(executeOrder(last, sack, world)).toBeUndefined();

    state = tick(state, [], world).state;
    expect(reasons(state, sack, enslave)).toEqual([
      `city capua fell on day 2, more than ${FATE_DAYS} days ago`,
      `city capua fell on day 2, more than ${FATE_DAYS} days ago`,
    ]);
    expect(state.cities[FIXTURE.capua]?.fellOn).toBe(2);
    expectConsistent(state);
    expectConsistent(last);
  });

  test('a city that changes owner without a siege has no fate to decide', () => {
    const state = buildFixture();
    const roman = state.armies[FIXTURE.romanArmy];
    if (roman) roman.activity = { kind: 'idle', position: { x: 2229.9, y: 2870.1 } };
    executeOrder(
      state,
      { kind: 'declareWar', faction: FIXTURE.rome, against: FIXTURE.carthage },
      world,
    );
    const next = tick(state, [], world).state;
    expect(reasons(next, { kind: 'sack', faction: FIXTURE.rome, city: FIXTURE.carthago })).toEqual([
      'city carthago belongs to carthage, not rome',
    ]);
    expectConsistent(next);
  });
});

describe('the choice of fate', () => {
  function play(state: GameState, days: number): GameState {
    for (let day = 0; day < days; day++) state = tick(state, [], world).state;
    return state;
  }
  const gold = (state: GameState) => state.factions[FIXTURE.carthage]?.stores.gold ?? 0;
  const manpower = (state: GameState) => state.factions[FIXTURE.carthage]?.stores.manpower ?? 0;

  function afterFate(order: Order | undefined, days: number): GameState {
    const state = capuaFallen();
    if (order) expect(executeOrder(state, order, world)).toBeUndefined();
    return play(state, days);
  }

  test('a sack pays more at once, and an occupied city out-earns it within a year', () => {
    expect(gold(afterFate(sack, 60))).toBeGreaterThan(gold(afterFate(undefined, 60)));
    expect(gold(afterFate(undefined, 365))).toBeGreaterThan(gold(afterFate(sack, 365)));
  });

  test('a sacked city yields half its gold for years after its unrest is over', () => {
    const halfway = afterFate(sack, SACK.unrestDays + 30);
    const capua = halfway.cities[FIXTURE.capua];
    if (!capua) throw new Error('Capua is missing');
    expect(capua.unrestDays).toBe(0);
    const spared = structuredClone(halfway);
    const sparedCapua = spared.cities[FIXTURE.capua];
    if (sparedCapua) sparedCapua.sackedOn = null;
    const balance = (state: GameState) => dailyBalances(state).get(FIXTURE.carthage)?.gold ?? 0;
    expect(balance(spared) - balance(halfway)).toBeCloseTo(
      capua.population * OUTPUT_PER_PERSON.gold * (1 - SACK.poorOutput),
      9,
    );

    const recovered = play(halfway, SACK.poorDays - SACK.unrestDays);
    const later = structuredClone(recovered);
    const laterCapua = later.cities[FIXTURE.capua];
    if (laterCapua) laterCapua.sackedOn = null;
    expect(balance(later)).toBeCloseTo(balance(recovered), 9);
    expectConsistent(recovered);
  });

  test('enslaving gives more manpower at once than the occupied city raises in a year', () => {
    const now = manpower(afterFate(enslave, 0));
    const occupied = manpower(afterFate(undefined, 365));
    const start = manpower(afterFate(undefined, 0));
    expect(now - start).toBeGreaterThan(occupied - start);
  });
});
