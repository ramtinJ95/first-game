import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import type { FactionId, SiegeId } from '../ids.ts';
import { expectConsistent } from '../references.ts';
import { areAtWar } from '../wars.ts';
import { executeOrder, type Order } from './orders.ts';

const world = fixtureWorld();

describe('moveArmy', () => {
  test('sets an idle army marching from where it stands along a path that ends at the point', () => {
    const state = buildFixture();
    const capua = { x: 2638.8, y: 2448.3 };
    expect(
      executeOrder(
        state,
        { kind: 'moveArmy', faction: FIXTURE.rome, army: FIXTURE.romanArmy, to: capua },
        world,
      ),
    ).toBeUndefined();
    const activity = state.armies[FIXTURE.romanArmy]?.activity;
    expect(activity).toMatchObject({ kind: 'marching', position: { x: 2516.3, y: 2340.8 } });
    expect(activity?.kind === 'marching' && activity.waypoints.at(-1)).toEqual(capua);
    expectConsistent(state);
  });

  test('is rejected for a besieging army, which keeps its siege', () => {
    const state = buildFixture();
    const army = state.armies[FIXTURE.romanArmy];
    if (!army) throw new Error('fixture lacks the Roman army');
    const siege = 'siege-1' as SiegeId;
    army.activity = { kind: 'besieging', position: { x: 0, y: 0 }, siege };
    const before = structuredClone(state);
    const order: Order = {
      kind: 'moveArmy',
      faction: FIXTURE.rome,
      army: army.id,
      to: { x: 1, y: 1 },
    };
    expect(executeOrder(state, order, world)).toEqual({
      order,
      reason: 'army army-roman is besieging and must lift siege siege-1 first',
    });
    expect(state).toEqual(before);
  });

  test('is rejected for a destination that is not a finite point', () => {
    const state = buildFixture();
    const order: Order = {
      kind: 'moveArmy',
      faction: FIXTURE.rome,
      army: FIXTURE.romanArmy,
      to: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
    };
    expect(executeOrder(state, order, world)?.reason).toBe(
      'destination NaN, Infinity is not a point on the map',
    );
    expect(state).toEqual(buildFixture());
  });
});

describe('setStance', () => {
  test('changes the stance of an owned army', () => {
    const state = buildFixture();
    executeOrder(
      state,
      {
        kind: 'setStance',
        faction: FIXTURE.carthage,
        army: FIXTURE.punicArmy,
        stance: 'skirmishAndWithdraw',
      },
      world,
    );
    expect(state.armies[FIXTURE.punicArmy]?.stance).toBe('skirmishAndWithdraw');
    expectConsistent(state);
  });
});

describe('declareWar', () => {
  test('puts both factions at war with each other from today', () => {
    const state = buildFixture();
    expect(
      executeOrder(
        state,
        { kind: 'declareWar', faction: FIXTURE.rome, against: FIXTURE.carthage },
        world,
      ),
    ).toBeUndefined();
    expect(areAtWar(state, FIXTURE.rome, FIXTURE.carthage)).toBe(true);
    expect(areAtWar(state, FIXTURE.carthage, FIXTURE.rome)).toBe(true);
    expect(Object.values(state.wars)).toEqual([{ since: 1 }]);
    expectConsistent(state);
  });

  test('is rejected when the two are already at war, whichever side declared', () => {
    const state = buildFixture();
    executeOrder(
      state,
      { kind: 'declareWar', faction: FIXTURE.carthage, against: FIXTURE.rome },
      world,
    );
    const before = structuredClone(state);
    expect(
      executeOrder(
        state,
        { kind: 'declareWar', faction: FIXTURE.rome, against: FIXTURE.carthage },
        world,
      )?.reason,
    ).toBe('rome is already at war with carthage');
    expect(state).toEqual(before);
    expectConsistent(state);
  });

  test('is rejected against itself or against a faction that does not exist', () => {
    const state = buildFixture();
    expect(
      executeOrder(
        state,
        { kind: 'declareWar', faction: FIXTURE.rome, against: FIXTURE.rome },
        world,
      )?.reason,
    ).toBe('faction rome cannot declare war on itself');
    expect(
      executeOrder(
        state,
        {
          kind: 'declareWar',
          faction: FIXTURE.rome,
          against: 'sparta' as FactionId,
        },
        world,
      )?.reason,
    ).toBe('faction sparta does not exist');
    expect(state).toEqual(buildFixture());
    expectConsistent(state);
  });
});

describe('every order', () => {
  test('is rejected with a reason, and changes nothing, when the faction does not own the army', () => {
    const orders: Order[] = [
      { kind: 'moveArmy', faction: FIXTURE.rome, army: FIXTURE.punicArmy, to: { x: 0, y: 0 } },
      {
        kind: 'setStance',
        faction: FIXTURE.rome,
        army: FIXTURE.punicArmy,
        stance: 'allOutAssault',
      },
      { kind: 'retreat', faction: FIXTURE.rome, army: FIXTURE.punicArmy },
    ];
    for (const order of orders) {
      const state = buildFixture();
      expect(executeOrder(state, order, world)).toEqual({
        order,
        reason: 'army army-punic belongs to carthage, not rome',
      });
      expect(state).toEqual(buildFixture());
      expectConsistent(state);
    }
  });

  test('is rejected from a faction that does not exist', () => {
    const state = buildFixture();
    const order: Order = {
      kind: 'setStance',
      faction: 'sparta' as FactionId,
      army: FIXTURE.romanArmy,
      stance: 'allOutAssault',
    };
    expect(executeOrder(state, order, world)?.reason).toBe('faction sparta does not exist');
  });
});
