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
import { muster } from '../systems/economy.ts';
import { NOTICE_DAYS } from './thresholds.ts';

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
  const truce = truceBetween(state, route.owner, route.partner);
  const endingTruce = truce?.endsOn === state.day + 1;
  const readyRecruits = Object.values(state.cities).some(
    (city) =>
      city.owner === route.owner && city.recruits.some((recruit) => recruit.readyOn <= state.day),
  );
  const since = state.factions[route.owner]?.noticeSince ?? null;
  const noticeEnds =
    route.partner === state.player && since !== null && state.day + 1 - since === NOTICE_DAYS;
  if (endingTruce || readyRecruits || noticeEnds) {
    // These facts are already scheduled. Never simulate or foresee battle rolls.
    const tomorrow = JSON.parse(JSON.stringify(state)) as GameState;
    muster(tomorrow);
    tomorrow.day = (state.day + 1) as Day;
    if (declares(tomorrow))
      return endingTruce
        ? 'the inviter intends war when the truce ends tomorrow'
        : noticeEnds
          ? `the inviter intends war tomorrow, when its ${NOTICE_DAYS} days on notice are out`
          : 'the inviter intends war with known reinforcements tomorrow';
  }
  return undefined;
}
