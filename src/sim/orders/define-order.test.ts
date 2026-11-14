import { describe, expect, it } from 'vitest';
import { defineOrder } from './define-order.ts';
import { moveArmy } from './move-army.ts';
import { recruit } from './recruit.ts';

describe('order registration types', () => {
  it('keeps the exact handler kind and army slot', () => {
    expect(defineOrder('moveArmy', moveArmy, 'movement')).toEqual({
      kind: 'moveArmy',
      handler: moveArmy,
      slot: 'movement',
    });
    expect(defineOrder('recruit', recruit, undefined).slot).toBeUndefined();
    // @ts-expect-error The handler, not a shared list, fixes the kind.
    defineOrder('recruit', moveArmy, 'movement');
    // @ts-expect-error An army order must decide which pending slot it replaces.
    defineOrder('moveArmy', moveArmy, undefined);
    // @ts-expect-error An order without an army must not claim an army slot.
    defineOrder('recruit', recruit, 'movement');
  });
});
