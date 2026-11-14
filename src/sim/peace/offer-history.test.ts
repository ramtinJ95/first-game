import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../cities.ts';
import { recordEvents } from '../events.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../fixture.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import { loadGame, saveGame, SAVE_FORMAT } from '../save.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import { newWar, warKey } from '../state/war.ts';
import { proposal } from '../ai/peace.ts';
import { advanceDay } from '../systems/advance-day.ts';

const world = fixtureWorld();
const key = warKey(f.rome, f.carthage);
const payment = (gold: number): Order => ({
  kind: 'offerPeace',
  faction: f.carthage,
  to: f.rome,
  terms: { kind: 'payment', payer: f.rome, gold, cities: [] },
});
const refuse: Order = { kind: 'refusePeace', faction: f.rome, from: f.carthage };

function run(state: GameState, order: Order) {
  expect(executeOrder(state, order, world)).toBeUndefined();
  expectConsistent(state);
}

function firstOffer() {
  const state = buildFixture(30);
  state.day = 201 as Day;
  state.wars[key] = newWar(f.carthage, f.rome, 1 as Day);
  const treasury = state.factions[f.rome];
  if (!treasury) throw new Error('fixture');
  treasury.stores.gold = 8940;
  run(state, payment(4500));
  return state;
}

describe('a rising peace price has a remembered, measured reason', () => {
  test('an expired offer remains the comparison point for the next demand', () => {
    const state = firstOffer();
    state.day = 230 as Day;
    advanceDay(state);
    expect(state.peaceOffers[key]).toBeUndefined();
    state.day = 291 as Day;
    run(state, payment(5100));
    expect(state.peaceOffers[key]?.change).toContain('last time you give 4,500 gold');
    expectConsistent(state);
  });

  test('actual AI proposals name the treasury cap when a richer player is asked for more', () => {
    const state = buildFixture(30);
    state.day = 601 as Day;
    state.wars[key] = newWar(f.carthage, f.rome, 1 as Day);
    changeCityOwner(state, f.capua, f.carthage);
    const treasury = state.factions[f.rome];
    if (!treasury) throw new Error('fixture');
    treasury.stores.gold = 2000;
    const first = proposal(state, f.carthage, f.rome);
    expect(first).toEqual({ kind: 'payment', payer: f.rome, gold: 2000, cities: [] });
    if (!first) throw new Error('no proposal');
    run(state, { kind: 'offerPeace', faction: f.carthage, to: f.rome, terms: first });
    run(state, refuse);
    state.day = 691 as Day;
    treasury.stores.gold = 3000;
    const next = proposal(state, f.carthage, f.rome);
    expect(next).toEqual({ kind: 'payment', payer: f.rome, gold: 3000, cities: [] });
    if (!next) throw new Error('no proposal');
    run(state, { kind: 'offerPeace', faction: f.carthage, to: f.rome, terms: next });
    expect(state.peaceOffers[key]?.change).toContain(
      'Your treasury rose from 2,000 to 3,000 gold.',
    );
    expect(state.peaceOffers[key]?.change).toContain(
      'The previous gold demand reached all the gold you held.',
    );
    expectConsistent(state);
  });

  test('remembers the last price through refusal and a save/load, then names a new conquest', () => {
    const state = firstOffer();
    run(state, refuse);
    const loaded = loadGame(saveGame(state));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.state).toEqual(state);
    const next = loaded.state;
    next.day = 291 as Day;
    changeCityOwner(next, f.capua, f.carthage);
    const events = recordEvents(next, () => run(next, payment(5100)));
    const change = next.peaceOffers[key]?.change;
    expect(change).toContain(
      'The price rose: last time you give 4,500 gold; now you give 5,100 gold.',
    );
    expect(change).toContain('it took Capua');
    expect(change).toContain('its war standing changed from 0 to 15');
    expect(events).toContainEqual(expect.objectContaining({ kind: 'peaceOffered', change }));
    expectConsistent(next);
  });

  test('a counter-offer never replaces the enemy price history; an unchanged or lower price is not a rise', () => {
    const state = firstOffer();
    run(state, refuse);
    state.day = 202 as Day;
    run(state, {
      kind: 'offerPeace',
      faction: f.rome,
      to: f.carthage,
      terms: { kind: 'asThingsStand' },
    });
    state.day = 291 as Day;
    run(state, payment(4500));
    expect(state.peaceOffers[key]?.change).toBeUndefined();
    run(state, refuse);
    state.day = 381 as Day;
    run(state, payment(4400));
    expect(state.peaceOffers[key]?.change).toBeUndefined();
    run(state, refuse);
    state.day = 382 as Day;
    run(state, payment(4600));
    expect(state.peaceOffers[key]?.change).toContain('last time you give 4,400 gold');
    expect(state.peaceOffers[key]?.change).toContain(
      'No change in the recorded war facts explains this higher demand.',
    );
    expectConsistent(state);
  });

  test('a change in the player’s other wars explains a price increase even if the enemy front did not change', () => {
    const state = firstOffer();
    run(state, refuse);
    state.day = 202 as Day;
    run(state, { kind: 'declareWar', faction: f.syracusaeFaction, against: f.rome });
    const minor = state.factions[f.syracusaeFaction];
    if (!minor) throw new Error('fixture');
    minor.kind = 'greatPower';
    state.day = 291 as Day;
    run(state, payment(5100));
    expect(state.peaceOffers[key]?.change).toContain('Rome is also at war with Syracusae.');
    expectConsistent(state);
  });

  test('registers the new saved history and refuses a last offer attributed to another faction', () => {
    expect(SAVE_FORMAT).toContain('peace-offer-price-history');
    const state = firstOffer();
    const last = state.wars[key]?.sides[f.carthage]?.lastOffer;
    if (!last) throw new Error('no history');
    last.from = f.rome;
    const loaded = loadGame(saveGame(state));
    expect(loaded.ok).toBe(false);
    if (loaded.ok) throw new Error('invalid history loaded');
    expect(loaded.error).toContain("keeps another side's last offer");
  });
});
