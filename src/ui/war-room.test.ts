import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import {
  declarationFacts,
  newestOfferToPlayer,
  peaceChoices,
  peaceVerdict,
  truceText,
  warRoomOf,
} from './war-room.ts';
import { peaceAnswer } from '../sim/ai/peace.ts';
import { tick } from '../sim/tick.ts';
import { expectConsistent } from '../sim/references.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import type { PeaceTerms } from '../sim/state/peace.ts';
import { decideOrders } from '../sim/ai/decide.ts';
import { dateText } from '../app/names.ts';

const world = fixtureWorld();
const f = FIXTURE;

function run(state: GameState, order: Order) {
  expect(executeOrder(state, order, world)).toBeUndefined();
}

/** Rome declared war on Carthage on day 1, and it is now the given day. */
function warOn(day: number): GameState {
  const state = buildFixture();
  run(state, { kind: 'declareWar', faction: f.rome, against: f.carthage });
  state.day = day as Day;
  return state;
}

describe('the wars panel', () => {
  test.each([1, 2])(
    "a minor losing by %i offers no demand for the winner's city when gold is short",
    (score) => {
      const state = buildFixture();
      const war = newWar(f.rome, f.syracusaeFaction, state.day);
      const side = war.sides[f.syracusaeFaction];
      const rome = state.factions[f.rome];
      if (!side || !rome) throw new Error('fixture');
      side.lost = Math.round((score * 2000) / 30);
      state.wars[warKey(f.rome, f.syracusaeFaction)] = war;
      state.day = 65 as Day;
      rome.stores.gold = 0;
      const choices = peaceChoices(state, f.syracusaeFaction);
      expect(choices).toHaveLength(1);
      expect(choices[0]).toMatchObject({
        label: 'Peace as things stand',
        terms: { kind: 'asThingsStand' },
        answer: { accepts: true },
      });
      expectConsistent(state);
    },
  );

  test('warns only about battles and sieges in this war, including a battle with no siege', () => {
    let state = warOn(226);
    expect(warRoomOf(state, [], world).wars[0]?.volatile).toBe(false);
    const roman = state.armies[f.romanArmy];
    const punic = state.armies[f.punicArmy];
    if (!roman || !punic || roman.activity.kind !== 'idle') throw new Error('fixture');
    punic.activity = { kind: 'idle', position: { ...roman.activity.position } };
    state = tick(state, [], world).state;
    expect(Object.keys(state.battles)).toHaveLength(1);
    expect(warRoomOf(state, [], world).wars[0]?.volatile).toBe(true);
    expectConsistent(state);
  });

  test('uses faction names rather than raw ids in an unaffordable terms verdict', () => {
    const state = warOn(226);
    const carthage = state.factions[f.carthage];
    if (!carthage) throw new Error('fixture');
    carthage.stores.gold = 416;
    const answer = peaceAnswer(state, f.carthage, f.rome, {
      kind: 'payment',
      payer: f.carthage,
      gold: 900,
      cities: [],
    });
    if (!answer) throw new Error('no answer');
    expect(peaceVerdict(state, answer)).toBe(
      'These terms cannot be met: Carthage has 416 gold, not the 900 the terms ask.',
    );
    expectConsistent(state);
  });
  test('lists each war with how it stands, from what the player can see', () => {
    const state = warOn(201);
    changeCityOwner(state, f.capua, f.carthage);
    const [war] = warRoomOf(state, [], world).wars;
    expect(war?.summary).toBe('The war goes against you (-15)');
    expect(war?.facts).toEqual([
      'You declared it on Year 1, day 1, 200 days ago.',
      'Carthage took Capua.',
    ]);
  });

  test('says what the enemy would answer to each ready choice, by the rule the AI answers with', () => {
    const state = warOn(201);
    changeCityOwner(state, f.capua, f.carthage);
    const [war] = warRoomOf(state, [], world).wars;
    expect(war?.choices.map((choice) => [choice.label, choice.answer.verdict])).toEqual([
      [
        'Peace as things stand',
        'Carthage would refuse. It wants terms worth 17 points more, such as 1,700 gold more.',
      ],
      ['The least Carthage takes', 'Carthage would accept.'],
    ]);
    expect(war?.choices[1]?.terms).toEqual({
      kind: 'payment',
      payer: f.rome,
      gold: 1700,
      cities: [],
    });
  });

  test("shows the enemy's offer with what refusing means, and the player's own offer while it waits", () => {
    const state = warOn(201);
    run(state, {
      kind: 'offerPeace',
      faction: f.carthage,
      to: f.rome,
      terms: { kind: 'asThingsStand' },
    });
    const [war] = warRoomOf(state, [], world).wars;
    expect(war?.theirOffer).toEqual({
      terms: { kind: 'asThingsStand' },
      text: 'Carthage offers peace as things stand.',
      funds: undefined,
      change: undefined,
      problem: undefined,
      refusing: 'Refuse, and the war goes on. Carthage makes no new offer for 90 days.',
      truce: 'This peace starts a truce of 365 days, until Year 2, day 201.',
      answered: undefined,
      counter: undefined,
    });
    const queued: Order = {
      kind: 'offerPeace',
      faction: f.rome,
      to: f.carthage,
      terms: { kind: 'payment', payer: f.rome, gold: 300, cities: [] },
    };
    expect(warRoomOf(state, [queued], world).wars[0]?.ourOffer).toBe(
      'You offer Carthage peace: you give 300 gold. Carthage hears it with the next day.',
    );
  });

  test("a demand for gold counts the gold promised to today's orders, so a peace it lets the player accept is paid", () => {
    const base = warOn(201);
    changeCityOwner(base, f.capua, f.carthage);
    const terms: PeaceTerms = { kind: 'payment', payer: f.rome, gold: 2500, cities: [] };
    const study: Order = { kind: 'study', faction: f.rome, advance: 'citizenRolls' };
    const accept: Order = { kind: 'acceptPeace', faction: f.rome, from: f.carthage, terms };
    for (const gold of [5000, 5500, 5499]) {
      const state = structuredClone(base);
      const rome = state.factions[f.rome];
      if (!rome) throw new Error('fixture');
      rome.stores.gold = gold;
      run(state, { kind: 'offerPeace', faction: f.carthage, to: f.rome, terms });
      const offer = warRoomOf(state, [study], world).wars[0]?.theirOffer;
      const result = tick(state, [study, accept], world);
      expect(result.rejected.length === 0).toBe(offer?.problem === undefined);
      expectConsistent(result.state);
    }
    const state = structuredClone(base);
    const rome = state.factions[f.rome];
    if (!rome) throw new Error('fixture');
    rome.stores.gold = 5000;
    run(state, { kind: 'offerPeace', faction: f.carthage, to: f.rome, terms });
    expect(warRoomOf(state, [], world).wars[0]?.theirOffer?.problem).toBeUndefined();
    expect(warRoomOf(state, [study], world).wars[0]?.theirOffer?.problem).toBe(
      'Rome has 2000 gold, not the 2500 the terms ask, once the orders given today are paid',
    );
    expect(warRoomOf(state, [study], world).wars[0]?.theirOffer?.funds).toBe(
      "You hold 5,000 gold. 3,000 of it is promised to today's orders. You need 500 gold more to pay the 2,500 asked.",
    );
    expect(
      warRoomOf(state, [study], world).wars[0]?.choices.filter(
        (choice) =>
          choice.terms.kind === 'payment' &&
          choice.terms.payer === f.rome &&
          choice.terms.gold > 2000 &&
          choice.answer.problem === undefined,
      ),
    ).toEqual([]);
  });

  test('a demand above what the enemy would take offers the cheaper terms as a counter', () => {
    const state = warOn(201);
    changeCityOwner(state, f.capua, f.carthage);
    const rome = state.factions[f.rome];
    if (!rome) throw new Error('fixture');
    rome.stores.gold = 5000;
    run(state, {
      kind: 'offerPeace',
      faction: f.carthage,
      to: f.rome,
      terms: { kind: 'payment', payer: f.rome, gold: 3000, cities: [] },
    });
    const offer = warRoomOf(state, [], world).wars[0]?.theirOffer;
    expect(offer?.counter?.terms).toEqual({
      kind: 'payment',
      payer: f.rome,
      gold: 1700,
      cities: [],
    });
    expect(offer?.counter?.answer.accepts).toBe(true);
    expect(offer?.counter?.text).toBe(
      'Carthage asks more than it would take. By its reckoning today it would accept peace in which you give 1,700 gold. A counter-offer replaces its demand, and Carthage answers with the next day. This peace starts a truce of 875 days, until Year 3, day 347.',
    );
    const atFloor = warOn(201);
    changeCityOwner(atFloor, f.capua, f.carthage);
    const purse = atFloor.factions[f.rome];
    if (!purse) throw new Error('fixture');
    purse.stores.gold = 5000;
    run(atFloor, {
      kind: 'offerPeace',
      faction: f.carthage,
      to: f.rome,
      terms: { kind: 'payment', payer: f.rome, gold: 1700, cities: [] },
    });
    expect(warRoomOf(atFloor, [], world).wars[0]?.theirOffer?.counter).toBeUndefined();
    const refused = warRoomOf(
      state,
      [{ kind: 'refusePeace', faction: f.rome, from: f.carthage }],
      world,
    ).wars[0]?.theirOffer?.answered;
    expect(refused).toBe('You refuse. Carthage hears it with the next day.');
    expectConsistent(state);
    expectConsistent(atFloor);
  });

  test('the war confirmation names a league partner, closed routes, and when talks open', () => {
    const state = buildFixture();
    expect(declarationFacts(state, f.carthage)).toEqual([
      'The war begins with the next day, and Carthage may march on your cities.',
      'Carthage will not talk of peace for 60 days. A peace starts a truce of 365 days, and 30 more for each 100 gold, or its worth in cities, that one side pays, up to 730 more.',
    ]);
    const carthage = state.factions[f.carthage];
    const syracusae = state.factions[f.syracusaeFaction];
    if (!carthage || !syracusae) throw new Error('fixture');
    carthage.league = f.syracusaeFaction;
    syracusae.league = f.carthage;
    expect(declarationFacts(state, f.syracusaeFaction)).toContain(
      'Carthage is leagued with Syracusae. It declares war on you too, and marches to lift any siege of Syracusae.',
    );
    expectConsistent(state);
  });

  test('selects only an offer made to the player, not one another power receives the same day', () => {
    const state = warOn(201);
    state.wars[warKey(f.rome, f.syracusaeFaction)] = newWar(f.syracusaeFaction, f.rome, 1 as Day);
    state.wars[warKey(f.carthage, f.syracusaeFaction)] = newWar(
      f.syracusaeFaction,
      f.carthage,
      1 as Day,
    );
    run(state, {
      kind: 'offerPeace',
      faction: f.syracusaeFaction,
      to: f.carthage,
      terms: { kind: 'asThingsStand' },
    });
    expect(newestOfferToPlayer(state, -1)).toBeUndefined();
    run(state, {
      kind: 'offerPeace',
      faction: f.carthage,
      to: f.rome,
      terms: { kind: 'asThingsStand' },
    });
    expect(newestOfferToPlayer(state, -1)).toEqual({ from: f.carthage, madeOn: state.day });
    expect(newestOfferToPlayer(state, state.day)).toBeUndefined();
    expectConsistent(state);
  });

  test('lists each truce with the days left', () => {
    const state = warOn(201);
    run(state, {
      kind: 'offerPeace',
      faction: f.rome,
      to: f.carthage,
      terms: { kind: 'asThingsStand' },
    });
    run(state, {
      kind: 'acceptPeace',
      faction: f.carthage,
      from: f.rome,
      terms: { kind: 'asThingsStand' },
    });
    state.day = 301 as Day;
    expect(warRoomOf(state, [], world)).toEqual({
      wars: [],
      truces: [
        {
          enemy: f.carthage,
          name: 'Carthage',
          daysLeft: 265,
          text: 'Truce with Carthage: 265 days left. Neither side may declare war before Year 2, day 201.',
        },
      ],
    });
  });

  test('already formats every absolute peace date as year/day, while durations remain day counts', () => {
    const state = warOn(900);
    const war = state.wars[warKey(f.rome, f.carthage)];
    if (!war) throw new Error('fixture');
    war.since = 885 as Day;
    const answer = peaceAnswer(state, f.carthage, f.rome, { kind: 'asThingsStand' });
    if (!answer) throw new Error('no answer');
    expect(peaceVerdict(state, answer)).toBe(
      'Carthage will not talk of peace before Year 3, day 215.',
    );
    expect(warRoomOf(state, [], world).wars[0]?.facts).toContain(
      'You declared it on Year 3, day 155, 15 days ago.',
    );
    state.wars = {};
    state.truces[warKey(f.rome, f.carthage)] = { since: 3549 as Day, endsOn: 3914 as Day };
    state.day = 3900 as Day;
    expect(warRoomOf(state, [], world).truces[0]?.text).toBe(
      'Truce with Carthage: 14 days left. Neither side may declare war before Year 11, day 264.',
    );
    expectConsistent(state);
  });
});

describe('the truce a written offer buys', () => {
  test('names its days and its last day for each payment, from the day the answer comes', () => {
    const state = buildFixture();
    state.day = 100 as Day;
    const pay = (gold: number) =>
      truceText(
        state,
        FIXTURE.carthage,
        { kind: 'payment', payer: FIXTURE.rome, gold, cities: [] },
        state.day + 1,
      );
    expect(truceText(state, FIXTURE.carthage, { kind: 'asThingsStand' }, state.day + 1)).toBe(
      'This peace starts a truce of 365 days, until Year 2, day 101.',
    );
    expect(pay(1_000)).toBe('This peace starts a truce of 665 days, until Year 3, day 36.');
    expect(pay(2_500)).toBe('This peace starts a truce of 1,095 days, until Year 4, day 101.');
  });
});

describe('the truce shown before terms are sent is the truce they buy', () => {
  const key = warKey(f.rome, f.carthage);

  /** Carthage took Capua in a war Rome declared 225 days ago, so it wants gold for peace. */
  function carthageAhead(): GameState {
    const state = warOn(226);
    changeCityOwner(state, f.capua, f.carthage);
    const rome = state.factions[f.rome];
    if (!rome) throw new Error('fixture');
    rome.stores.gold = 20_000;
    return state;
  }

  /** The line for the truce the peace in the state made, as the panel words it. */
  function made(state: GameState): string {
    const truce = state.truces[key];
    if (!truce) throw new Error('no peace was made');
    expect(state.wars[key]).toBeUndefined();
    expectConsistent(state);
    return `This peace starts a truce of ${(truce.endsOn - truce.since).toLocaleString('en-GB')} days, until ${dateText(truce.endsOn)}.`;
  }

  /** Rome sends the terms, and Carthage answers the next day as the AI does. */
  function sent(state: GameState, terms: PeaceTerms): GameState {
    const offered = tick(
      state,
      [{ kind: 'offerPeace', faction: f.rome, to: f.carthage, terms }],
      world,
    );
    return tick(offered.state, decideOrders(offered.state, world, f.carthage), world).state;
  }

  test('a one-click suggestion', () => {
    const state = carthageAhead();
    const choice = warRoomOf(state, [], world).wars[0]?.choices.find(
      (c) => c.terms.kind === 'payment',
    );
    if (!choice) throw new Error('no paid suggestion');
    expect(choice.answer.accepts).toBe(true);
    expect(choice.truce).toBe(made(sent(state, choice.terms)));
  });

  test('a one-click suggestion in which the enemy pays, as the tester sent it', () => {
    const state = warOn(226);
    const losses = state.wars[key]?.sides[f.carthage];
    const carthage = state.factions[f.carthage];
    if (!losses || !carthage) throw new Error('fixture');
    losses.lost = 1000;
    carthage.stores.gold = 5_000;
    const choice = warRoomOf(state, [], world).wars[0]?.choices.find(
      (c) => c.terms.kind === 'payment' && c.terms.payer === f.carthage,
    );
    if (!choice) throw new Error('no suggestion in which Carthage pays');
    expect(choice.label).toBe('The most Carthage gives');
    expect(choice.truce).toBe(made(sent(state, choice.terms)));
    expect(choice.truce).not.toContain('365 days');
  });

  test('terms written on the form', () => {
    const state = carthageAhead();
    const terms: PeaceTerms = { kind: 'payment', payer: f.rome, gold: 4_000, cities: [] };
    expect(peaceAnswer(state, f.carthage, f.rome, terms)?.accepts).toBe(true);
    expect(truceText(state, f.carthage, terms, state.day + 1)).toBe(made(sent(state, terms)));
  });

  test("an enemy's offer accepted, and the cheaper counter-offer to it", () => {
    const state = carthageAhead();
    const demand: PeaceTerms = { kind: 'payment', payer: f.rome, gold: 9_000, cities: [] };
    const offered = tick(
      state,
      [{ kind: 'offerPeace', faction: f.carthage, to: f.rome, terms: demand }],
      world,
    ).state;
    const theirs = warRoomOf(offered, [], world).wars[0]?.theirOffer;
    if (!theirs?.counter) throw new Error('no offer with a cheaper counter-offer');
    const accepted = tick(
      offered,
      [{ kind: 'acceptPeace', faction: f.rome, from: f.carthage, terms: demand }],
      world,
    ).state;
    expect(theirs.truce).toBe(made(accepted));
    expect(theirs.counter.truce).toBe(made(sent(offered, theirs.counter.terms)));
    expect(theirs.counter.text).toContain(theirs.counter.truce);
  });
});
