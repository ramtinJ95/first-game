import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE } from '../fixture.ts';
import { expectConsistent } from '../references.ts';
import { tick } from '../tick.ts';
import { executeOrder, type Order } from './orders.ts';

const order = (changes: Partial<Extract<Order, { kind: 'evacuate' }>> = {}): Order => ({
  kind: 'evacuate',
  faction: FIXTURE.rome,
  city: FIXTURE.capua,
  to: FIXTURE.roma,
  share: 0.25,
  ...changes,
});

describe('evacuate', () => {
  test('people leave the city at once and join the destination when their column stands there', () => {
    const state = buildFixture();
    expect(executeOrder(state, order())).toBeUndefined();
    expect(state.cities[FIXTURE.capua]?.population).toBe(13_500);
    const columns = Object.values(state.refugeeColumns);
    expect(columns).toEqual([
      {
        id: 'refugeeColumn-1',
        owner: FIXTURE.rome,
        people: 4500,
        from: FIXTURE.capua,
        to: FIXTURE.roma,
        position: { x: 1300, y: 660 },
      },
    ]);
    expectConsistent(state);

    const walking = tick(state, []).state;
    expect(Object.keys(walking.refugeeColumns)).toHaveLength(1);
    const roma = walking.cities[FIXTURE.roma]?.population ?? 0;

    const column = Object.values(walking.refugeeColumns)[0];
    if (!column) throw new Error('the column is missing');
    column.position = { x: 1240, y: 610 };
    const arrived = tick(walking, []).state;
    expect(arrived.refugeeColumns).toEqual({});
    expect(arrived.cities[FIXTURE.roma]?.population).toBeCloseTo(
      roma * 1.02 ** (1 / 365) + 4500,
      6,
    );
    expectConsistent(arrived);
  });

  test.each([
    [order({ share: 0 }), 'share 0 is not above 0 and up to 1'],
    [order({ share: 1.5 }), 'share 1.5 is not above 0 and up to 1'],
    [order({ share: Number.NaN }), 'share NaN is not above 0 and up to 1'],
    [order({ share: 0.00001 }), '0.00001 of capua is nobody'],
    [order({ to: FIXTURE.capua }), 'refugees from capua need another city to walk to'],
    [order({ to: FIXTURE.carthago }), 'city carthago belongs to carthage, not rome'],
    [order({ city: FIXTURE.carthago }), 'city carthago belongs to carthage, not rome'],
  ])('is rejected with a reason and changes nothing (%#)', (rejected, reason) => {
    const state = buildFixture();
    expect(executeOrder(state, rejected)).toEqual({ order: rejected, reason });
    expect(state).toEqual(buildFixture());
    expectConsistent(state);
  });
});
