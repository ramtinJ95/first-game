import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE } from '../fixture.ts';
import type { FactionId, SiegeId } from '../ids.ts';
import { executeOrder, type Order } from './orders.ts';

describe('moveArmy', () => {
  test('sets an idle army marching from where it stands to the point', () => {
    const state = buildFixture();
    expect(
      executeOrder(state, {
        kind: 'moveArmy',
        faction: FIXTURE.rome,
        army: FIXTURE.romanArmy,
        to: { x: 1300, y: 660 },
      }),
    ).toBeUndefined();
    expect(state.armies[FIXTURE.romanArmy]?.activity).toEqual({
      kind: 'marching',
      position: { x: 1245, y: 615 },
      destination: { x: 1300, y: 660 },
    });
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
    expect(executeOrder(state, order)).toEqual({
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
    expect(executeOrder(state, order)?.reason).toBe(
      'destination NaN, Infinity is not a point on the map',
    );
    expect(state).toEqual(buildFixture());
  });
});

describe('setStance', () => {
  test('changes the stance of an owned army', () => {
    const state = buildFixture();
    executeOrder(state, {
      kind: 'setStance',
      faction: FIXTURE.carthage,
      army: FIXTURE.punicArmy,
      stance: 'skirmishAndWithdraw',
    });
    expect(state.armies[FIXTURE.punicArmy]?.stance).toBe('skirmishAndWithdraw');
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
    ];
    for (const order of orders) {
      const state = buildFixture();
      expect(executeOrder(state, order)).toEqual({
        order,
        reason: 'army army-punic belongs to carthage, not rome',
      });
      expect(state).toEqual(buildFixture());
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
    expect(executeOrder(state, order)?.reason).toBe('faction sparta does not exist');
  });
});
