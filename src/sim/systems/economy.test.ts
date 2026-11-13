import { STARTING_GENERAL_SKILL } from '../new-game.ts';
import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { FormationId } from '../ids.ts';
import { executeOrder } from '../orders/orders.ts';
import { expectConsistent } from '../references.ts';
import { loadGame, saveGame } from '../save.ts';
import type { GameState } from '../state/game-state.ts';
import { tick } from '../tick.ts';
import { TROOPS } from '../troops.ts';
import {
  dailyBalances,
  FOOD_PER_PERSON,
  GRANARY_DAYS,
  limitsOf,
  MANPOWER_SHARE,
  menOf,
  OUTPUT_PER_PERSON,
  UPKEEP_PER_MAN,
} from './economy.ts';

const world = fixtureWorld();

function stores(state: GameState, faction = FIXTURE.rome) {
  const found = state.factions[faction]?.stores;
  if (!found) throw new Error(`faction ${faction} is missing`);
  return found;
}

function romanMen(state: GameState) {
  const army = state.armies[FIXTURE.romanArmy];
  if (!army) throw new Error('the Roman army is missing');
  return menOf(state, army);
}

function play(state: GameState, days: number): GameState {
  for (let day = 0; day < days; day += 1) state = tick(state, [], world).state;
  return state;
}

describe('production and upkeep', () => {
  test('one day adds each city output to its owner and takes each army upkeep', () => {
    const next = tick(buildFixture(), [], world).state;
    // Rome: 58,000 people make 24.36 gold and 34.8 food and eat 23.2 of it; 1,500 men cost
    // 15 gold and eat 9 food. Its 2,000 manpower is already above its limit: 4% of its
    // people less its 1,500 men under arms, 820.
    expect(stores(next).gold).toBeCloseTo(5009.36, 9);
    expect(stores(next).food).toBeCloseTo(1002.6, 9);
    expect(stores(next).manpower).toBe(2000);
    // Carthage: 50,000 people make 21 gold and 30 food and eat 20 food. Its 1,000
    // manpower is above its limit of 2,000 less 1,500 men.
    expect(stores(next, FIXTURE.carthage).gold).toBeCloseTo(3006, 9);
    expect(stores(next, FIXTURE.carthage).food).toBeCloseTo(1001, 9);
    expect(stores(next, FIXTURE.carthage).manpower).toBe(1000);
    expect(romanMen(next)).toBe(1500);
    expectConsistent(next);
  });

  test('dailyBalances gives the same change the day brings', () => {
    const state = buildFixture();
    const balance = dailyBalances(state).get(FIXTURE.rome);
    expect(balance?.gold).toBeCloseTo(9.36, 9);
    expect(balance?.food).toBeCloseTo(2.6, 9);
    expect(balance?.manpower).toBeCloseTo(5.8, 9);
    expectConsistent(state);
  });
});

describe('food', () => {
  test('every man under arms eats food each day, as well as costing gold', () => {
    const state = buildFixture();
    const before = dailyBalances(state).get(FIXTURE.rome);
    const hastati = state.formations[FIXTURE.hastati];
    if (!hastati || !before) throw new Error('the fixture lacks the hastati');
    hastati.men += 1000;
    const after = dailyBalances(state).get(FIXTURE.rome);
    expect(after?.food).toBeCloseTo(before.food - 1000 * UPKEEP_PER_MAN.food, 9);
    expect(after?.gold).toBeCloseTo(before.gold - 1000 * UPKEEP_PER_MAN.gold, 9);
  });

  test('a city eats by its people, and in unrest it eats as much while it grows less', () => {
    const state = buildFixture();
    const syracusae = state.cities[FIXTURE.syracusae];
    if (!syracusae) throw new Error('the fixture lacks Syracusae');
    const calm = dailyBalances(state).get(FIXTURE.syracusaeFaction)?.food ?? 0;
    expect(calm).toBeCloseTo(syracusae.population * (OUTPUT_PER_PERSON.food - FOOD_PER_PERSON), 9);
    syracusae.unrestDays = 200;
    const restless = dailyBalances(state).get(FIXTURE.syracusaeFaction)?.food ?? 0;
    expect(restless).toBeLessThan(0);
    expect(restless).toBeCloseTo(
      syracusae.population * (0.25 * OUTPUT_PER_PERSON.food - FOOD_PER_PERSON),
      9,
    );
  });

  test('a running deficit drains the granary day by day, so the shortage shows before it bites', () => {
    const state = buildFixture();
    const hastati = state.formations[FIXTURE.hastati];
    if (!hastati) throw new Error('the fixture lacks the hastati');
    hastati.men = 3000;
    stores(state).food = 50;
    const deficit = dailyBalances(state).get(FIXTURE.rome)?.food ?? 0;
    expect(deficit).toBeLessThan(0);
    const daysLeft = Math.floor(50 / -deficit);
    const before = play(state, daysLeft);
    expect(stores(before).food).toBeGreaterThanOrEqual(0);
    expect(before.formations[FIXTURE.hastati]?.men).toBe(3000);
    const after = play(before, 2);
    expect(stores(after).food).toBeLessThan(0);
    expect(after.formations[FIXTURE.hastati]?.men).toBeLessThan(3000);
    expectConsistent(after);
  });

  test('food beyond the granaries spoils, and manpower stops at its share of the people less the men under arms', () => {
    const state = buildFixture();
    const limit = limitsOf(state).get(FIXTURE.carthage);
    if (!limit) throw new Error('Carthage is missing');
    expect(limit.manpower).toBeCloseTo(50_000 * MANPOWER_SHARE - 1500, 9);
    expect(limit.food).toBeCloseTo(
      GRANARY_DAYS * (50_000 * FOOD_PER_PERSON + 1500 * UPKEEP_PER_MAN.food),
      9,
    );
    stores(state, FIXTURE.carthage).food = limit.food - 0.5;
    stores(state, FIXTURE.carthage).manpower = limit.manpower - 1;
    const next = play(state, 3);
    const grown = limitsOf(next).get(FIXTURE.carthage);
    // The limit grows with the people, a day behind the stores.
    expect(stores(next, FIXTURE.carthage).food).toBeGreaterThan(limit.food);
    expect(stores(next, FIXTURE.carthage).food).toBeLessThanOrEqual(grown?.food ?? 0);
    expect(stores(next, FIXTURE.carthage).manpower).toBeGreaterThan(limit.manpower - 1);
    expect(stores(next, FIXTURE.carthage).manpower).toBeLessThanOrEqual(grown?.manpower ?? 0);
    expectConsistent(next);
  });
});

describe('shortage', () => {
  test('armies desert while gold is in debt, and stop once income pays it back', () => {
    const state = buildFixture();
    stores(state).gold = -10;
    const first = tick(state, [], world).state;
    expect(stores(first).gold).toBeCloseTo(-0.64, 9);
    expect(first.formations[FIXTURE.hastati]?.men).toBe(1188);
    expect(first.formations[FIXTURE.equites]?.men).toBe(297);

    const second = tick(first, [], world).state;
    expect(stores(second).gold).toBeCloseTo(8.87, 2);
    expect(romanMen(second)).toBe(1485);
    expect(romanMen(play(second, 30))).toBe(1485);
    expectConsistent(second);
  });

  test('a food shortage makes armies desert and cities shrink until food is back', () => {
    const state = buildFixture();
    stores(state).food = -10;
    const first = tick(state, [], world).state;
    expect(romanMen(first)).toBe(1485);
    const roma = first.cities[FIXTURE.roma]?.population ?? 0;
    expect(roma).toBeLessThan(40_000);

    let fed = first;
    for (let day = 0; day < 10 && stores(fed).food < 0; day++) fed = tick(fed, [], world).state;
    expect(stores(fed).food).toBeGreaterThanOrEqual(0);
    const men = romanMen(fed);
    expect(men).toBeLessThan(1485);
    const later = play(fed, 30);
    expect(romanMen(later)).toBe(men);
    expect(later.cities[FIXTURE.roma]?.population).toBeGreaterThan(
      fed.cities[FIXTURE.roma]?.population ?? 0,
    );
    expectConsistent(later);
  });

  test('a small formation keeps deserting through a long debt but never empties', () => {
    const state = buildFixture();
    const equites = state.formations[FIXTURE.equites];
    if (!equites) throw new Error('the fixture lacks the equites');
    equites.men = 99;
    stores(state).gold = -1_000_000;
    const first = tick(state, [], world).state;
    expect(first.formations[FIXTURE.equites]?.men).toBe(98);
    const later = play(first, 365);
    expect(later.formations[FIXTURE.equites]?.men).toBe(1);
    expectConsistent(later);
  });

  test('a shortage never adds men, even to an empty formation', () => {
    const state = buildFixture();
    const equites = state.formations[FIXTURE.equites];
    if (!equites) throw new Error('the fixture lacks the equites');
    equites.men = 0;
    stores(state).gold = -1_000_000;
    stores(state).food = -1_000_000;
    const later = play(state, 30);
    expect(later.formations[FIXTURE.equites]?.men).toBe(0);
    expectConsistent(later);
  });

  test('short of both stores, armies desert twice as fast', () => {
    const state = buildFixture();
    stores(state).gold = -1000;
    stores(state).food = -1000;
    const next = tick(state, [], world).state;
    expect(next.formations[FIXTURE.hastati]?.men).toBe(1176);
    expectConsistent(next);
  });

  test('an army larger than the income can keep shrinks until the debt is paid', () => {
    const state = buildFixture();
    const hastati = state.formations[FIXTURE.hastati];
    if (!hastati) throw new Error('the fixture lacks the hastati');
    hastati.men = 4700;
    stores(state).gold = 0;
    stores(state).food = 0;
    const later = play(state, 365);
    expect(romanMen(later)).toBeLessThan(2030);
    expect(stores(later).gold).toBeGreaterThan(0);
    expect(stores(later).food).toBeGreaterThan(0);
    expect(dailyBalances(later).get(FIXTURE.rome)?.gold).toBeGreaterThan(0);
    expectConsistent(later);
  });
});

describe('recruitment', () => {
  test('spearmen are paid on the order and join the idle army at the city on their day', () => {
    let state = buildFixture();
    const { days, gold, men } = TROOPS.spearmen.recruit;
    const ordered = tick(
      state,
      [{ kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.roma, troop: 'spearmen' }],
      world,
    );
    expect(ordered.rejected).toEqual([]);
    state = ordered.state;
    expect(stores(state).gold).toBeCloseTo(5000 - gold + 9.36, 9);
    // The 1,000 men in training count against the limit, which leaves no room to grow.
    expect(stores(state).manpower).toBe(2000 - men);
    expect(state.cities[FIXTURE.roma]?.recruits).toEqual([
      { troop: 'spearmen', readyOn: 1 + days },
    ]);

    state = play(state, days - 1);
    expect(state.armies[FIXTURE.romanArmy]?.formations).toHaveLength(2);

    state = tick(state, [], world).state;
    const formations = state.armies[FIXTURE.romanArmy]?.formations ?? [];
    expect(formations).toHaveLength(3);
    const raised = state.formations[formations[2] as FormationId];
    expect(raised).toMatchObject({ troop: 'spearmen', men, morale: 1 });
    expect(state.cities[FIXTURE.roma]?.recruits).toEqual([]);
    expect(Object.keys(state.armies)).toHaveLength(2);
    expectConsistent(state);
  });

  test('a recruit at a city with no idle army of its owner forms a new army there', () => {
    let state = tick(
      buildFixture(),
      [{ kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.capua, troop: 'archers' }],
      world,
    ).state;
    state = play(state, TROOPS.archers.recruit.days);
    const raised = Object.values(state.armies).filter(
      (army) => army.id !== FIXTURE.romanArmy && army.owner === FIXTURE.rome,
    );
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      generalSkill: STARTING_GENERAL_SKILL,
      activity: { kind: 'idle', position: { x: 2638.8, y: 2448.3 } },
    });
    expect(raised[0] && menOf(state, raised[0])).toBe(TROOPS.archers.recruit.men);
    expectConsistent(state);
  });

  test('a save and load during training continues the recruitment unchanged', () => {
    let state = tick(
      buildFixture(),
      [{ kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.roma, troop: 'heavyCavalry' }],
      world,
    ).state;
    state = play(state, 10);
    const loaded = loadGame(saveGame(state));
    if (!loaded.ok) throw new Error(loaded.error);
    const kept = play(state, 25);
    const reloaded = play(loaded.state, 25);
    expect(reloaded).toStrictEqual(kept);
    expect(reloaded.armies[FIXTURE.romanArmy]?.formations).toHaveLength(3);
    expectConsistent(reloaded);
  });

  test('the same seed and orders give the same state', () => {
    const run = () => {
      let state = buildFixture(9);
      executeOrder(
        state,
        {
          kind: 'declareWar',
          faction: FIXTURE.rome,
          against: FIXTURE.carthage,
        },
        world,
      );
      state = tick(
        state,
        [
          { kind: 'recruit', faction: FIXTURE.rome, city: FIXTURE.capua, troop: 'swordsmen' },
          { kind: 'recruit', faction: FIXTURE.carthage, city: FIXTURE.carthago, troop: 'spearmen' },
          {
            kind: 'evacuate',
            faction: FIXTURE.rome,
            city: FIXTURE.capua,
            to: FIXTURE.roma,
            share: 0.3,
          },
        ],
        world,
      ).state;
      return play(state, 60);
    };
    const state = run();
    expect(run()).toStrictEqual(state);
    expectConsistent(state);
  });
});
