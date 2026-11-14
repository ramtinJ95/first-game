import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { FactionId } from '../ids.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { TRUCE_DAYS } from '../peace/truce.ts';
import { expectConsistent } from '../references.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import type { PeaceTerms } from '../state/peace.ts';
import { tick } from '../tick.ts';
import { decideOrders } from './decide.ts';
import { peaceAnswer, peaceOrders, peaceWish, proposal } from './peace.ts';
import { warKey } from '../state/war.ts';
import { createRouter } from './routes.ts';
import { enemiesOf } from './situation.ts';
import {
  MIN_WAR_DAYS,
  OFFER_GAP_DAYS,
  OTHER_WAR_POINTS,
  PEACE_RESOLVE,
  SHORTAGE_POINTS,
  WEARY_DAYS,
} from './thresholds.ts';

const world = fixtureWorld();
const f = FIXTURE;
const AS_THINGS_STAND: PeaceTerms = { kind: 'asThingsStand' };

function run(state: GameState, order: Order) {
  expect(executeOrder(state, order, world)).toBeUndefined();
}

/** Rome and Carthage at war since day 1, on the given day. */
function warOn(day: number): GameState {
  const state = buildFixture();
  run(state, { kind: 'declareWar', faction: f.rome, against: f.carthage });
  state.day = day as Day;
  return state;
}

function context(state: GameState, faction: FactionId) {
  return {
    state,
    world,
    faction,
    enemies: enemiesOf(state, faction),
    router: createRouter(state, world, faction),
  };
}

const gold = (payer: FactionId, amount: number): PeaceTerms => ({
  kind: 'payment',
  payer,
  gold: amount,
  cities: [],
});

describe("the AI's answer", () => {
  test('unpayable and invalid-city verdicts name the faction, not its lowercase id', () => {
    const state = warOn(226);
    const faction = state.factions[f.carthage];
    if (!faction) throw new Error('fixture');
    faction.name = 'Lugdunum';
    faction.stores.gold = 416;
    expect(peaceAnswer(state, f.carthage, f.rome, gold(f.carthage, 900))?.verdict).toBe(
      'These terms cannot be met: Lugdunum has 416 gold, not the 900 the terms ask.',
    );
    expect(
      peaceAnswer(state, f.carthage, f.rome, {
        kind: 'payment',
        payer: f.carthage,
        gold: 0,
        cities: [f.capua],
      })?.verdict,
    ).toBe('These terms cannot be met: Lugdunum does not hold Capua.');
    expectConsistent(state);
  });

  test.each([1, 2, 5, 15, 30])(
    'a minor losing by %i never demands its winner pay gold or cities',
    (score) => {
      const state = warOn(65);
      const minor = state.factions[f.carthage];
      const war = state.wars[warKey(f.rome, f.carthage)];
      const side = war?.sides[f.carthage];
      if (!minor || !side) throw new Error('fixture');
      minor.kind = 'minor';
      const survivors = state.formations[f.citizenSpears];
      if (!survivors) throw new Error('fixture');
      survivors.men = 500;
      side.lost = Math.round((score * 2000) / 30);
      const answer = peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND);
      expect(answer?.accepts).toBe(true);
      expect(answer?.short).toBe(0);
      expect(peaceWish(state, f.carthage, f.rome)?.wish).toBeGreaterThanOrEqual(0);
      expect(answer?.wish.factors.reduce((sum, factor) => sum + factor.points, 0)).toBe(
        answer?.wish.wish,
      );
      if (score <= 5)
        expect(answer?.wish.factors).toContainEqual({
          kind: 'restraint',
          points: 11 - score,
          text: 'Carthage cannot demand payment while losing',
        });
      const terms = proposal(state, f.carthage, f.rome);
      expect(terms?.kind === 'payment' && terms.payer === f.rome).toBe(false);
      expectConsistent(state);
    },
  );

  test('the losing-side floor never makes a winner give up a new conquest for free', () => {
    const state = warOn(65);
    changeCityOwner(state, f.capua, f.carthage);
    expect(peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND)).toMatchObject({
      accepts: false,
      short: 26,
    });
    expect(proposal(state, f.rome, f.carthage)).toBeUndefined();
    expectConsistent(state);
  });

  test('does not talk of peace in a war younger than MIN_WAR_DAYS', () => {
    const state = warOn(MIN_WAR_DAYS);
    const answer = peaceAnswer(state, f.carthage, f.rome, gold(f.rome, 3000));
    expect(answer?.accepts).toBe(false);
    expect(answer?.verdict).toBe(`Carthage will not talk of peace before day ${1 + MIN_WAR_DAYS}.`);
    expect(
      peaceAnswer(warOn(MIN_WAR_DAYS + 1), f.carthage, f.rome, gold(f.rome, 3000))?.accepts,
    ).toBe(true);
  });

  test('in an even war, refuses peace as things stand until the war has worn it down, and names what it wants', () => {
    const early = 1 + WEARY_DAYS * (PEACE_RESOLVE - 5);
    const refused = peaceAnswer(warOn(early), f.carthage, f.rome, AS_THINGS_STAND);
    expect(refused).toMatchObject({ accepts: false, short: 5 });
    expect(refused?.verdict).toBe(
      'Carthage would refuse. It wants terms worth 5 points more, such as 500 gold more.',
    );
    expect(refused?.wish.factors.map((factor) => [factor.kind, factor.points])).toEqual([
      ['weariness', PEACE_RESOLVE - 5],
      ['resolve', -PEACE_RESOLVE],
      ['restraint', 0],
    ]);
    expect(peaceAnswer(warOn(early), f.carthage, f.rome, gold(f.rome, 500))?.verdict).toBe(
      'Carthage would accept.',
    );
    expect(peaceAnswer(warOn(early), f.carthage, f.rome, gold(f.rome, 450))?.accepts).toBe(false);
    expect(
      peaceAnswer(warOn(1 + WEARY_DAYS * PEACE_RESOLVE), f.carthage, f.rome, AS_THINGS_STAND)
        ?.accepts,
    ).toBe(true);
  });

  test('a side that is winning asks for more, and a side that is losing pays to end it', () => {
    const state = warOn(1 + WEARY_DAYS * PEACE_RESOLVE);
    changeCityOwner(state, f.capua, f.carthage);
    const winner = peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND);
    expect(winner).toMatchObject({ accepts: false, short: 15 });
    expect(winner?.wish.factors[0]).toEqual({
      kind: 'standing',
      points: -15,
      text: 'Carthage is winning the war',
    });
    expect(peaceAnswer(state, f.carthage, f.rome, gold(f.rome, 1500))?.accepts).toBe(true);
    const loser = peaceAnswer(state, f.rome, f.carthage, gold(f.rome, 1500));
    expect(loser?.accepts).toBe(true);
    expect(peaceAnswer(state, f.rome, f.carthage, gold(f.rome, 1600))?.accepts).toBe(false);
    expectConsistent(state);
  });

  test('another war with a great power and empty stores each make it readier for peace', () => {
    const state = warOn(1 + WEARY_DAYS * PEACE_RESOLVE);
    changeCityOwner(state, f.capua, f.carthage);
    const carthage = state.factions[f.carthage];
    if (!carthage) throw new Error('fixture');
    carthage.stores.gold = -10;
    const answer = peaceAnswer(state, f.carthage, f.rome, AS_THINGS_STAND);
    expect(answer?.wish.factors.find((factor) => factor.kind === 'shortage')).toEqual({
      kind: 'shortage',
      points: SHORTAGE_POINTS,
      text: 'Carthage is short of gold',
    });
    expect(answer?.accepts).toBe(true);

    const egypt = 'egypt' as FactionId;
    state.factions[egypt] = {
      ...carthage,
      id: egypt,
      name: 'Egypt',
      stores: { gold: 0, food: 0, manpower: 0 },
    };
    run(state, { kind: 'declareWar', faction: egypt, against: f.rome });
    expect(peaceAnswer(state, f.rome, f.carthage, AS_THINGS_STAND)?.wish.factors).toContainEqual({
      kind: 'otherWars',
      points: OTHER_WAR_POINTS,
      text: 'Rome is also at war with Egypt',
    });
  });
});

describe("the AI's offers", () => {
  test('offers nothing while neither side would accept', () => {
    const state = warOn(MIN_WAR_DAYS + 1);
    expect(proposal(state, f.carthage, f.rome)).toBeUndefined();
    expect(peaceOrders(context(state, f.carthage))).toEqual([]);
  });

  test('the winner asks for the most the loser would give, and the loser offers the least the winner takes', () => {
    const state = warOn(1 + WEARY_DAYS * (PEACE_RESOLVE + 10));
    changeCityOwner(state, f.capua, f.carthage);
    expect(proposal(state, f.carthage, f.rome)).toEqual(gold(f.rome, 2500));
    expect(proposal(state, f.rome, f.carthage)).toEqual(gold(f.rome, 500));
  });

  test('a proposal is one that both sides accept by the same rule', () => {
    for (const day of [150, 200, 260, 400]) {
      for (const short of [false, true]) {
        const state = warOn(day);
        const carthage = state.factions[f.carthage];
        if (carthage && short) carthage.stores.food = -5;
        for (const [faction, enemy] of [
          [f.rome, f.carthage],
          [f.carthage, f.rome],
        ] as const) {
          const terms = proposal(state, faction, enemy);
          if (!terms) continue;
          expect(
            peaceAnswer(state, faction, enemy, terms)?.accepts,
            `${faction} on day ${day}`,
          ).toBe(true);
          expect(peaceAnswer(state, enemy, faction, terms)?.accepts, `${enemy} on day ${day}`).toBe(
            true,
          );
        }
      }
    }
  });

  test('a side with too little gold hands over a city instead', () => {
    const state = warOn(1 + WEARY_DAYS * (PEACE_RESOLVE + 10));
    const rome = state.factions[f.rome];
    if (rome) rome.stores.gold = 0;
    changeCityOwner(state, f.syracusae, f.rome);
    changeCityOwner(state, f.capua, f.carthage);
    expect(proposal(state, f.carthage, f.rome)).toEqual({
      kind: 'payment',
      payer: f.rome,
      gold: 0,
      cities: [f.syracusae],
    });
    expectConsistent(state);
  });

  test('offers peace once, waits OFFER_GAP_DAYS after a refusal, and answers an offer the next day', () => {
    let state = warOn(1 + WEARY_DAYS * (PEACE_RESOLVE + 10));
    const offers = peaceOrders(context(state, f.carthage));
    expect(offers).toEqual([
      { kind: 'offerPeace', faction: f.carthage, to: f.rome, terms: AS_THINGS_STAND },
    ]);
    state = tick(state, offers, world).state;
    expect(peaceOrders(context(state, f.carthage))).toEqual([]);
    state = tick(state, [{ kind: 'refusePeace', faction: f.rome, from: f.carthage }], world).state;
    expect(peaceOrders(context(state, f.carthage))).toEqual([]);
    state.day = (state.day + OFFER_GAP_DAYS) as Day;
    expect(peaceOrders(context(state, f.carthage))).toHaveLength(1);

    state = tick(
      state,
      [{ kind: 'offerPeace', faction: f.rome, to: f.carthage, terms: AS_THINGS_STAND }],
      world,
    ).state;
    const answer = decideOrders(state, world, f.carthage);
    expect(answer[0]).toEqual({
      kind: 'acceptPeace',
      faction: f.carthage,
      from: f.rome,
      terms: AS_THINGS_STAND,
      reckon: true,
    });
    const result = tick(state, answer, world);
    expect(result.rejected).toEqual([]);
    expect(result.events.some((event) => event.kind === 'peaceMade')).toBe(true);
    expectConsistent(result.state);
  });

  test('refuses an offer the rule refuses', () => {
    let state = warOn(MIN_WAR_DAYS + 1);
    state = tick(
      state,
      [{ kind: 'offerPeace', faction: f.rome, to: f.carthage, terms: AS_THINGS_STAND }],
      world,
    ).state;
    expect(decideOrders(state, world, f.carthage)[0]).toEqual({
      kind: 'refusePeace',
      faction: f.carthage,
      from: f.rome,
      reckon: true,
    });
  });
});

describe('war during a truce', () => {
  test('the AI declares no war on a faction it keeps a truce with, and declares again once the truce ends', () => {
    const state = buildFixture();
    const hastati = state.formations[f.hastati];
    if (hastati) hastati.men = 1500;
    run(state, { kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction });
    run(state, {
      kind: 'offerPeace',
      faction: f.rome,
      to: f.syracusaeFaction,
      terms: AS_THINGS_STAND,
    });
    run(state, {
      kind: 'acceptPeace',
      faction: f.syracusaeFaction,
      from: f.rome,
      terms: AS_THINGS_STAND,
    });
    const declarations = (s: GameState) =>
      decideOrders(s, world, f.rome).filter((order) => order.kind === 'declareWar');
    expect(declarations(state)).toEqual([]);
    state.day = (state.day + TRUCE_DAYS) as Day;
    expect(declarations(state)).toEqual([
      { kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction },
    ]);
  });

  test('a rival pressed for keeping to its homeland is not pressed during a truce', () => {
    const state = buildFixture();
    const hastati = state.formations[f.hastati];
    const spears = state.formations[f.citizenSpears];
    if (hastati) hastati.men = 2000;
    if (spears) spears.men = 500;
    run(state, { kind: 'declareWar', faction: f.rome, against: f.carthage });
    run(state, { kind: 'offerPeace', faction: f.rome, to: f.carthage, terms: AS_THINGS_STAND });
    run(state, { kind: 'acceptPeace', faction: f.carthage, from: f.rome, terms: AS_THINGS_STAND });
    run(state, { kind: 'declareWar', faction: f.rome, against: f.syracusaeFaction });
    expect(
      decideOrders(state, world, f.rome).filter((order) => order.kind === 'declareWar'),
    ).toEqual([]);
  });
});
