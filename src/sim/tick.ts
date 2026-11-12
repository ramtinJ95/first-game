import { executeOrder, type Order, type RejectedOrder } from './orders/orders.ts';
import type { GameState } from './state/game-state.ts';
import { SYSTEMS, type System } from './systems.ts';
import type { World } from './world/world.ts';

export interface TickResult {
  state: GameState;
  rejected: RejectedOrder[];
}

/**
 * Plays one game day. The input state is never changed: the tick works on its own
 * copy and returns it, so the caller keeps the previous day intact. The world is the
 * map the orders and systems read, and it never changes.
 */
export function tick(
  state: GameState,
  orders: readonly Order[],
  world: World,
  systems: readonly System[] = SYSTEMS,
): TickResult {
  const next = JSON.parse(JSON.stringify(state)) as GameState;
  const rejected: RejectedOrder[] = [];
  for (const order of orders) {
    const rejection = executeOrder(next, order, world);
    if (rejection) rejected.push(rejection);
  }
  for (const system of systems) system(next, world);
  return { state: next, rejected };
}
