import type { GameState } from '../state/game-state.ts';
import { declareWar } from './declare-war.ts';
import { evacuate } from './evacuate.ts';
import { moveArmy } from './move-army.ts';
import { recruit } from './recruit.ts';
import { retreat } from './retreat.ts';
import { setStance } from './set-stance.ts';

/**
 * Every order the rules accept, keyed by its kind. A handler either changes the
 * state and returns nothing, or returns the reason it refused and leaves the state alone.
 */
const ORDER_HANDLERS = {
  moveArmy,
  setStance,
  declareWar,
  retreat,
  recruit,
  evacuate,
};

type Handlers = typeof ORDER_HANDLERS;

export type Order = {
  [K in keyof Handlers]: Parameters<Handlers[K]>[1] & { kind: K };
}[keyof Handlers];

export type OrderKind = Order['kind'];

export interface RejectedOrder {
  order: Order;
  reason: string;
}

/** Applies one order to the state, or returns why it was rejected. */
export function executeOrder(state: GameState, order: Order): RejectedOrder | undefined {
  if (!Object.hasOwn(state.factions, order.faction))
    return { order, reason: `faction ${order.faction} does not exist` };
  const handler = ORDER_HANDLERS[order.kind] as (
    state: GameState,
    order: Order,
  ) => string | undefined;
  const reason = handler(state, order);
  return reason === undefined ? undefined : { order, reason };
}
