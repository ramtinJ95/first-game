import type { DeepReadonly } from '../deep-readonly.ts';
import { truceBetween } from '../peace/truce.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import type { TradeRoute } from '../state/trade-route.ts';
import type { World } from '../world/world.ts';
import { tradeReserve } from './budget.ts';
import { createRouter } from './routes.ts';
import { enemiesOf } from './situation.ts';
import { warDeclaration } from './war.ts';
import { minorOrders } from './minor.ts';

/** An invitation is not a commitment to spend tomorrow's military reserve. */
export function invitationProblem(
  current: DeepReadonly<GameState>,
  world: World,
  route: DeepReadonly<TradeRoute>,
): string | undefined {
  // Order handlers receive a mutable tick copy; AI collection caches require a snapshot.
  const state = JSON.parse(JSON.stringify(current)) as GameState;
  const gold = state.factions[route.owner]?.stores.gold ?? 0;
  if (gold - route.cost < tradeReserve(state, route.owner))
    return 'the inviter must keep its military reserve';
  const policy = state.factions[route.owner]?.kind === 'minor' ? minorOrders : warDeclaration;
  const declares = (current: DeepReadonly<GameState>) =>
    policy({
      state: current,
      world,
      faction: route.owner,
      enemies: enemiesOf(current, route.owner),
      router: createRouter(current, world, route.owner),
    }).some((order) => order.kind === 'declareWar' && order.against === route.partner);
  if (declares(state)) return 'the inviter intends war with its partner';
  // A truce ending tomorrow is already known, unlike tomorrow's battles or captures.
  const truce = truceBetween(state, route.owner, route.partner);
  if (truce?.endsOn === state.day + 1 && declares({ ...state, day: (state.day + 1) as Day }))
    return 'the inviter intends war when the truce ends tomorrow';
  return undefined;
}
