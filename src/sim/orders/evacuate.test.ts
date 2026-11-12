import { describe, expect, test } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../fixture.ts';
import { expectConsistent } from '../references.ts';
import { tick } from '../tick.ts';
import { executeOrder, type Order } from './orders.ts';

const world = fixtureWorld();

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
    expect(executeOrder(state, order(), world)).toBeUndefined();
    expect(state.cities[FIXTURE.capua]?.population).toBe(13_500);
    const columns = Object.values(state.refugeeColumns);
    expect(columns).toMatchObject([
      {
        id: 'refugeeColumn-1',
        owner: FIXTURE.rome,
        people: 4500,
        from: FIXTURE.capua,
        to: FIXTURE.roma,
        position: { x: 2638.8, y: 2448.3 },
      },
    ]);
    expect(columns[0]?.waypoints.at(-1)).toEqual({ x: 2511.3, y: 2335.8 });
    expectConsistent(state);

    let walking = state;
    for (let day = 0; day < 60; day += 1) {
      const next = tick(walking, [], world).state;
      if (Object.keys(next.refugeeColumns).length === 0) {
        const roma = walking.cities[FIXTURE.roma]?.population ?? 0;
        expect(next.cities[FIXTURE.roma]?.population).toBeCloseTo(
          roma * 1.02 ** (1 / 365) + 4500,
          6,
        );
        expectConsistent(next);
        return;
      }
      walking = next;
    }
    throw new Error('the column never arrived');
  });

  test('is rejected when no land route leads to the other city', () => {
    const state = buildFixture();
    const syracusae = state.cities[FIXTURE.syracusae];
    if (!syracusae) throw new Error('the fixture lacks Syracusae');
    syracusae.owner = FIXTURE.rome;
    const before = structuredClone(state);
    expect(executeOrder(state, order({ to: FIXTURE.syracusae }), world)?.reason).toBe(
      'no land route leads from capua to syracusae',
    );
    expect(state).toEqual(before);
    expectConsistent(state);
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
    expect(executeOrder(state, rejected, world)).toEqual({ order: rejected, reason });
    expect(state).toEqual(buildFixture());
    expectConsistent(state);
  });
});
