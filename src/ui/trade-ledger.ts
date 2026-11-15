import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId } from '../sim/ids.ts';
import { truceBetween } from '../sim/peace/truce.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { TradeRoute } from '../sim/state/trade-route.ts';
import { improvementCost, routeOpeningCost } from '../sim/trade/routes.ts';
import { areAtWar } from '../sim/wars.ts';
import { whole } from '../app/names.ts';

type State = DeepReadonly<GameState>;
type Route = DeepReadonly<TradeRoute>;

/**
 * What a route has meant to one faction: what it paid to open and improve the route, the gold
 * it kept from the route's arrivals (the route's own tally, after the treasury's limit), and
 * the price less those receipts.
 */
export interface RouteLedger {
  readonly cost: number;
  readonly worth: number;
  readonly owed: number;
}

export function routeLedger(state: State, route: Route, faction: FactionId): RouteLedger {
  const improved = route.improvedBy.filter((by) => by === faction).length;
  const cost = (route.openedBy === faction ? route.cost : 0) + improved * improvementCost(route);
  const worth = route.receipts[faction] ?? 0;
  return { cost, worth, owed: Math.max(0, cost - worth) };
}

const cityName = (state: State, route: Route, end: 'from' | 'to') =>
  state.cities[route[end]]?.name ?? route[end];

export function routeName(state: State, route: Route): string {
  return `${cityName(state, route, 'from')} to ${cityName(state, route, 'to')} by ${route.mode}`;
}

/** "cost 1,345 gold, brought 137 gold, 1,208 still unpaid", from the player's side. */
export function ledgerText(state: State, route: Route): string {
  const { cost, worth, owed } = routeLedger(state, route, state.player);
  const paid = cost
    ? `cost ${whole(cost)} gold`
    : `cost you nothing, as ${state.factions[route.openedBy]?.name ?? route.openedBy} paid`;
  return `${paid}, brought ${whole(worth)} gold, ${whole(owed)} still unpaid`;
}

/** The question Close route asks before it ends a running route. */
export function closeText(state: State, route: Route): string {
  const domestic = route.owner === route.partner;
  return [
    `Close ${routeName(state, route)}? It ${ledgerText(state, route)}.`,
    `Closing gives no refund, and opening it again costs the full price, ${whole(routeOpeningCost(route.km, domestic))} gold.`,
  ]
    .filter(Boolean)
    .join(' ');
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
