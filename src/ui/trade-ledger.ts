import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId } from '../sim/ids.ts';
import { truceBetween } from '../sim/peace/truce.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { TradeRoute } from '../sim/state/trade-route.ts';
import { adminShareOf } from '../sim/systems/economy.ts';
import { routeOpeningCost } from '../sim/trade/routes.ts';
import { areAtWar } from '../sim/wars.ts';
import { whole } from '../app/names.ts';

type State = DeepReadonly<GameState>;
type Route = DeepReadonly<TradeRoute>;

/**
 * What a route has meant to one of its ends: the price that end paid, the gold its
 * arrivals have brought it, and the part of the price not yet earned back. Arrivals are
 * counted at today's administrative share, since the route keeps no tally of past pay.
 */
export interface RouteLedger {
  readonly cost: number;
  readonly received: number;
  readonly owed: number;
}

export function routeLedger(state: State, route: Route, faction: FactionId): RouteLedger {
  const ends = Number(route.owner === faction) + Number(route.partner === faction);
  const cost = route.owner === faction ? route.cost : 0;
  const received =
    route.deliveries * route.daily * route.days * adminShareOf(state, faction) * ends;
  return { cost, received, owed: Math.max(0, cost - received) };
}

const cityName = (state: State, route: Route, end: 'from' | 'to') =>
  state.cities[route[end]]?.name ?? route[end];

export function routeName(state: State, route: Route): string {
  return `${cityName(state, route, 'from')} to ${cityName(state, route, 'to')} by ${route.mode}`;
}

/** "cost 1,345 gold, brought about 137, 1,208 still unpaid", from the player's side. */
export function ledgerText(state: State, route: Route): string {
  const { cost, received, owed } = routeLedger(state, route, state.player);
  const paid = cost
    ? `cost ${whole(cost)} gold`
    : `cost you nothing, as ${state.factions[route.owner]?.name ?? route.owner} paid`;
  return `${paid}, brought about ${whole(received)}, ${whole(owed)} still unpaid`;
}

/** The question Close route asks before it ends a running route. */
export function closeText(state: State, route: Route): string {
  const domestic = route.owner === route.partner;
  return `Close ${routeName(state, route)}? It ${ledgerText(state, route)}. Closing gives no refund, and opening it again costs the full price, ${whole(routeOpeningCost(route.km, domestic))} gold.`;
}

/**
 * The factions a declaration puts at war with the player at once: the target, and a
 * minor's league partner, which joins every war on its partner unless a truce holds it.
 */
export function warJoiners(state: State, against: FactionId): FactionId[] {
  const league = state.factions[against]?.league;
  const joins =
    league &&
    league !== state.player &&
    state.factions[league]?.defeatedOn === null &&
    !areAtWar(state, league, state.player) &&
    !truceBetween(state, league, state.player);
  return joins ? [against, league] : [against];
}

/** The routes and invitations a war on `against` ends, each with what it cost and earned. */
export function warTradeLines(state: State, against: FactionId): string[] {
  const enemies = new Set(warJoiners(state, against));
  const ends = (r: Route) =>
    (r.owner === state.player && enemies.has(r.partner)) ||
    (r.partner === state.player && enemies.has(r.owner));
  const routes = Object.values(state.tradeRoutes).filter(ends);
  const running = routes.filter((r) => r.status === 'running');
  const offered = routes.length - running.length;
  const lines = running.map((r) => `It closes ${routeName(state, r)}: ${ledgerText(state, r)}.`);
  const [, joiner] = [...enemies];
  if (joiner && routes.some((r) => r.owner === joiner || r.partner === joiner))
    lines.push(
      `${state.factions[joiner]?.name ?? joiner} joins as ${state.factions[against]?.name ?? against}'s league partner, so its routes close too.`,
    );
  if (offered)
    lines.push(
      offered === 1 ? 'An invitation to trade lapses.' : `${offered} invitations to trade lapse.`,
    );
  const roads = Object.values(state.tradeRoutes).filter(
    (r) =>
      r.status === 'running' &&
      r.mode === 'land' &&
      !ends(r) &&
      (r.owner === state.player || r.partner === state.player),
  ).length;
  if (roads)
    lines.push(
      `Their armies could then raid your ${roads === 1 ? 'other land road' : `${roads} other land roads`}.`,
    );
  return lines;
}
