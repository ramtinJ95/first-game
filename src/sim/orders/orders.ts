import type { GameState } from '../state/game-state.ts';
import type { World } from '../world/world.ts';
import { declareWar } from './declare-war.ts';
import { enslave } from './enslave.ts';
import { evacuate } from './evacuate.ts';
import { embark } from './embark.ts';
import { halt } from './halt.ts';
import { moveArmy } from './move-army.ts';
import { recruit } from './recruit.ts';
import { retreat } from './retreat.ts';
import { sack } from './sack.ts';
import { setStance } from './set-stance.ts';
import { storm } from './storm.ts';

/**
 * Every order the rules accept, keyed by its kind. A handler either changes the
 * state and returns nothing, or returns the reason it refused and leaves the state alone.
 */
const ORDER_HANDLERS = {
  moveArmy,
  halt,
  embark,
  setStance,
  declareWar,
  retreat,
  recruit,
  evacuate,
  storm,
  sack,
  enslave,
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
export function executeOrder(
  state: GameState,
  order: Order,
  world: World,
): RejectedOrder | undefined {
  const faction = Object.hasOwn(state.factions, order.faction)
    ? state.factions[order.faction]
    : undefined;
  if (!faction) return { order, reason: `faction ${order.faction} does not exist` };
  if (faction.defeatedOn !== null) {
    return { order, reason: `faction ${order.faction} is out of the game` };
  }
  const handler = ORDER_HANDLERS[order.kind] as (
    state: GameState,
    order: Order,
    world: World,
  ) => string | undefined;
  const reason = handler(state, order, world);
  return reason === undefined ? undefined : { order, reason };
}
