import { emit, recordEvents, type DayEvent } from './events.ts';
import type { FactionId } from './ids.ts';
import { executeOrder, type Order, type RejectedOrder } from './orders/orders.ts';
import type { GameState } from './state/game-state.ts';
import { SYSTEMS, type System } from './systems.ts';
import type { World } from './world/world.ts';
import { lapseInvitationsBeforeOrders } from './trade/orders.ts';

export interface TickResult {
  state: GameState;
  rejected: RejectedOrder[];
  /** What happened during the day, in order. */
  events: DayEvent[];
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
  const { tradeRoutes, ...rest } = state;
  const next: GameState = {
    ...(JSON.parse(JSON.stringify(rest)) as Omit<GameState, 'tradeRoutes'>),
    // A trade path is immutable, unlike an army's shrinking waypoints. Sharing it
    // avoids serialising every bend of every road on every day; the moving record is copied.
    tradeRoutes: Object.fromEntries(
      Object.entries(tradeRoutes).map(([id, route]) => [id, { ...route }]),
    ),
  };
  const rejected: RejectedOrder[] = [];
  const events = recordEvents(next, () => {
    lapseInvitationsBeforeOrders(next, orders, world);
    const paid = new Map<FactionId, Order[]>();
    for (const order of orders) {
      const held = next.factions[order.faction]?.stores.gold;
      const rejection = executeOrder(next, order, world);
      const spent = paid.get(order.faction) ?? [];
      if (rejection) {
        rejected.push(rejection);
        const cost = held === undefined ? undefined : priceWithGold(next, order, world);
        if (held !== undefined && cost !== undefined) {
          emit(next, {
            kind: 'orderUnpaid',
            faction: order.faction,
            order,
            cost,
            held,
            paidBefore: spent,
          });
        }
      } else if (held !== undefined && (next.factions[order.faction]?.stores.gold ?? held) < held) {
        paid.set(order.faction, [...spent, order]);
      }
    }
    for (const system of systems) system(next, world);
  });
  return { state: next, rejected, events };
}

/** Far more gold than any order costs, so an order refused with it lacked something else. */
const AMPLE_GOLD = 1e12;

/**
 * The gold a refused order would have paid had its faction held AMPLE_GOLD, or undefined
 * when it is refused even then, so gold was not what it lacked. The price is the lowest the
 * treasury fell, since an order may pay and then take some back, as a peace that cedes a city
 * refunds the building under way there.
 */
function priceWithGold(state: GameState, order: Order, world: World): number | undefined {
  const trial = JSON.parse(JSON.stringify(state)) as GameState;
  const stores = trial.factions[order.faction]?.stores;
  if (!stores) return undefined;
  let gold = AMPLE_GOLD;
  let lowest = AMPLE_GOLD;
  Object.defineProperty(stores, 'gold', {
    enumerable: true,
    get: () => gold,
    set: (next: number) => {
      gold = next;
      lowest = Math.min(lowest, next);
    },
  });
  if (executeOrder(trial, order, world)) return undefined;
  const cost = AMPLE_GOLD - lowest;
  return cost > 0 ? cost : undefined;
}
