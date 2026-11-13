import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warRoomOf } from './war-room.ts';

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
  test('lists each war with how it stands, from what the player can see', () => {
    const state = warOn(201);
    changeCityOwner(state, f.capua, f.carthage);
    const [war] = warRoomOf(state, []).wars;
    expect(war?.summary).toBe('The war goes against you (-15)');
    expect(war?.facts).toEqual([
      'You declared it on Year 1, day 1, 200 days ago.',
      'Carthage took Capua.',
    ]);
  });

  test('says what the enemy would answer to each ready choice, by the rule the AI answers with', () => {
    const state = warOn(201);
    changeCityOwner(state, f.capua, f.carthage);
    const [war] = warRoomOf(state, []).wars;
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
    const [war] = warRoomOf(state, []).wars;
    expect(war?.theirOffer).toEqual({
      terms: { kind: 'asThingsStand' },
      text: 'Carthage offers peace as things stand.',
      refusing: 'Refuse, and the war goes on. Carthage makes no new offer for 90 days.',
    });
    const queued: Order = {
      kind: 'offerPeace',
      faction: f.rome,
      to: f.carthage,
      terms: { kind: 'payment', payer: f.rome, gold: 300, cities: [] },
    };
    expect(warRoomOf(state, [queued]).wars[0]?.ourOffer).toBe(
      'You offer Carthage peace: you give 300 gold. Carthage hears it with the next day.',
    );
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
    expect(warRoomOf(state, [])).toEqual({
      wars: [],
      truces: [
        {
          enemy: f.carthage,
          name: 'Carthage',
          daysLeft: 265,
          text: 'Truce with Carthage: 265 days left. Neither side may declare war before day 566.',
        },
      ],
    });
  });
});
