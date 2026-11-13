import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { FactionId } from '../ids.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import type { PeaceTerms } from '../state/peace.ts';
import { warKey } from '../state/war.ts';
import { tick } from '../tick.ts';
import { areAtWar } from '../wars.ts';
import { OFFER_DAYS } from './offer.ts';
import { CITY_POINTS, warStanding } from './standing.ts';
import { TRUCE_DAYS, truceDaysLeft } from './truce.ts';

const world = fixtureWorld();
const f = FIXTURE;
const CARTHAGO = { x: 2224.9, y: 2870.1 };

function run(state: GameState, order: Order): string | undefined {
  return executeOrder(state, order, world)?.reason;
}

function atWar(): GameState {
  const state = buildFixture();
  expect(run(state, { kind: 'declareWar', faction: f.rome, against: f.carthage })).toBeUndefined();
  return state;
}

function offerAndAccept(state: GameState, from: FactionId, to: FactionId, terms: PeaceTerms) {
  expect(run(state, { kind: 'offerPeace', faction: from, to, terms })).toBeUndefined();
  return run(state, { kind: 'acceptPeace', faction: to, from });
}

describe('how a war stands', () => {
  test('a new war stands even and remembers who declared it and when', () => {
    const state = atWar();
    state.day = 41 as Day;
    expect(warStanding(state, f.carthage, f.rome)).toMatchObject({
      since: 1,
      days: 40,
      declaredBy: f.rome,
      taken: [],
      lost: [],
      score: 0,
    });
    expectConsistent(state);
  });

  test('a city counts for the side that took it and holds it, and stops counting once it is won back', () => {
    const state = atWar();
    changeCityOwner(state, f.capua, f.carthage);
    expect(warStanding(state, f.carthage, f.rome)).toMatchObject({
      taken: [f.capua],
      score: CITY_POINTS.greatPowerCity,
    });
    expect(warStanding(state, f.rome, f.carthage)).toMatchObject({
      lost: [f.capua],
      score: -CITY_POINTS.greatPowerCity,
    });
    expectConsistent(state);
    changeCityOwner(state, f.capua, f.rome);
    expect(warStanding(state, f.rome, f.carthage)).toMatchObject({ taken: [], lost: [], score: 0 });
    expectConsistent(state);
  });

  test('the men each side loses in battle against the other tilt the war toward the side that lost fewer', () => {
    let state = atWar();
    const punic = state.armies[f.punicArmy];
    const roman = state.armies[f.romanArmy];
    if (!punic || !roman || roman.activity.kind !== 'idle') throw new Error('fixture');
    punic.activity = { kind: 'idle', position: { ...roman.activity.position } };
    for (let day = 0; day < 3; day += 1) state = tick(state, [], world).state;
    const [battle] = Object.values(state.battles);
    const rome = warStanding(state, f.rome, f.carthage);
    expect(battle).toBeDefined();
    expect(rome?.menLost).toBe(
      battle?.sides.attackers.factions.includes(f.rome)
        ? battle.sides.attackers.lost
        : battle?.sides.defenders.lost,
    );
    expect(rome?.menLost).toBeGreaterThan(0);
    expect(Math.sign(rome?.score ?? 0)).toBe(
      Math.sign((rome?.enemyMenLost ?? 0) - (rome?.menLost ?? 0)),
    );
    expectConsistent(state);
  });

  test('a siege under way counts half the besieged city for the besiegers', () => {
    let state = atWar();
    const roman = state.armies[f.romanArmy];
    const punic = state.armies[f.punicArmy];
    if (!roman || !punic) throw new Error('fixture');
    roman.activity = { kind: 'idle', position: CARTHAGO };
    punic.activity = { kind: 'idle', position: { x: 2600, y: 2380 } };
    state = tick(state, [], world).state;
    expect(warStanding(state, f.rome, f.carthage)).toMatchObject({
      besieging: [f.carthago],
      score: CITY_POINTS.capital / 2,
    });
    expectConsistent(state);
  });
});

describe('terms of peace', () => {
  test('peace as things stand ends the war, starts a truce, and moves nothing', () => {
    const state = atWar();
    const before = structuredClone(state.factions);
    expect(offerAndAccept(state, f.rome, f.carthage, { kind: 'asThingsStand' })).toBeUndefined();
    expect(areAtWar(state, f.rome, f.carthage)).toBe(false);
    expect(state.factions).toEqual(before);
    expect(truceDaysLeft(state, f.rome, f.carthage)).toBe(TRUCE_DAYS);
    expectConsistent(state);
  });

  test('a payment in gold moves the gold from the payer to the other side', () => {
    const state = atWar();
    const terms: PeaceTerms = { kind: 'payment', payer: f.rome, gold: 1200, cities: [] };
    expect(offerAndAccept(state, f.rome, f.carthage, terms)).toBeUndefined();
    expect(state.factions[f.rome]?.stores.gold).toBe(5000 - 1200);
    expect(state.factions[f.carthage]?.stores.gold).toBe(3000 + 1200);
    expectConsistent(state);
  });

  test('a payment in cities hands each city to the other side', () => {
    const state = atWar();
    const terms: PeaceTerms = { kind: 'payment', payer: f.rome, gold: 0, cities: [f.capua] };
    expect(offerAndAccept(state, f.carthage, f.rome, terms)).toBeUndefined();
    expect(state.cities[f.capua]?.owner).toBe(f.carthage);
    expect(state.cities[f.capua]?.fellOn).toBeNull();
    expectConsistent(state);
  });

  test('refuses terms the payer cannot meet: gold it lacks, a city it does not hold, or its last city', () => {
    const state = atWar();
    const offer = (terms: PeaceTerms) =>
      run(state, { kind: 'offerPeace', faction: f.carthage, to: f.rome, terms });
    expect(offer({ kind: 'payment', payer: f.carthage, gold: 9000, cities: [] })).toBe(
      'carthage has 3000 gold, not the 9000 the terms ask',
    );
    expect(offer({ kind: 'payment', payer: f.carthage, gold: 0, cities: [f.roma] })).toBe(
      'carthage does not hold Roma',
    );
    expect(offer({ kind: 'payment', payer: f.carthage, gold: 0, cities: [f.carthago] })).toBe(
      'carthage would hand over its last city',
    );
    expect(state.peaceOffers).toEqual({});
  });

  test('an offer is refused by the other side, or lapses after OFFER_DAYS, and the war goes on', () => {
    const state = atWar();
    const order: Order = {
      kind: 'offerPeace',
      faction: f.rome,
      to: f.carthage,
      terms: { kind: 'asThingsStand' },
    };
    expect(run(state, order)).toBeUndefined();
    expect(run(state, { kind: 'refusePeace', faction: f.carthage, from: f.rome })).toBeUndefined();
    expect(state.peaceOffers).toEqual({});
    expect(areAtWar(state, f.rome, f.carthage)).toBe(true);

    expect(run(state, order)).toBeUndefined();
    state.day = (state.day + OFFER_DAYS) as Day;
    expect(run(state, { kind: 'acceptPeace', faction: f.carthage, from: f.rome })).toBe(
      'rome offers carthage no peace',
    );
    expect(run(state, { kind: 'acceptPeace', faction: f.rome, from: f.rome })).toBe(
      'rome offers rome no peace',
    );
    expect(areAtWar(state, f.rome, f.carthage)).toBe(true);
    expectConsistent(state);
  });

  test('gold spent before the answer makes the offer fail', () => {
    const state = atWar();
    const terms: PeaceTerms = { kind: 'payment', payer: f.rome, gold: 4000, cities: [] };
    expect(
      run(state, { kind: 'offerPeace', faction: f.rome, to: f.carthage, terms }),
    ).toBeUndefined();
    const rome = state.factions[f.rome];
    if (rome) rome.stores.gold = 100;
    expect(run(state, { kind: 'acceptPeace', faction: f.carthage, from: f.rome })).toBe(
      'rome has 100 gold, not the 4000 the terms ask',
    );
    expect(areAtWar(state, f.rome, f.carthage)).toBe(true);
  });
});

describe('the truce', () => {
  test('neither side may declare war on the other until the truce ends', () => {
    const state = atWar();
    expect(offerAndAccept(state, f.rome, f.carthage, { kind: 'asThingsStand' })).toBeUndefined();
    const endsOn = state.day + TRUCE_DAYS;
    const declare = (faction: FactionId, against: FactionId) =>
      run(state, { kind: 'declareWar', faction, against });
    expect(declare(f.carthage, f.rome)).toBe(
      `carthage keeps a truce with rome until day ${endsOn}`,
    );
    expect(declare(f.rome, f.carthage)).toBe(
      `rome keeps a truce with carthage until day ${endsOn}`,
    );
    state.day = (endsOn - 1) as Day;
    expect(truceDaysLeft(state, f.rome, f.carthage)).toBe(1);
    expect(declare(f.rome, f.carthage)).toBeDefined();
    state.day = endsOn as Day;
    expect(truceDaysLeft(state, f.rome, f.carthage)).toBe(0);
    expect(declare(f.carthage, f.rome)).toBeUndefined();
    expect(state.truces[warKey(f.rome, f.carthage)]).toBeUndefined();
    expectConsistent(state);
  });

  test('a truce binds only the two that made peace', () => {
    const state = atWar();
    expect(offerAndAccept(state, f.rome, f.carthage, { kind: 'asThingsStand' })).toBeUndefined();
    expect(
      run(state, { kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction }),
    ).toBeUndefined();
  });
});
