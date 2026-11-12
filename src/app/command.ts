import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId } from '../sim/ids.ts';
import { CONVOY_KM_PER_DAY, MARCH_KM_PER_DAY } from '../sim/march.ts';
import { AT_PORT_KM, type EmbarkOrder } from '../sim/orders/embark.ts';
import type { MoveArmyOrder } from '../sim/orders/move-army.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { Army } from '../sim/state/army.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { areAtWar } from '../sim/wars.ts';
import { distance } from '../sim/world/find-path.ts';
import type { World } from '../sim/world/world.ts';
import { factionName, refusalText } from './names.ts';

type State = DeepReadonly<GameState>;

/** What a right click points at: a city drawn on the map, or a point of the map. */
export type CommandTarget =
  | { readonly kind: 'city'; readonly city: DeepReadonly<City> }
  | { readonly kind: 'point'; readonly point: MapPoint };

/** One way to a city that a menu offers, with how many days it takes. */
export interface MenuOption {
  readonly group: 'sea' | 'land';
  readonly label: string;
  readonly detail: string;
  readonly order: Order;
}

export interface OrderMenu {
  readonly title: string;
  readonly options: readonly MenuOption[];
}

/** What a right click does with the selected army. A notice tells the player why. */
export type Plan =
  | { readonly kind: 'issue'; readonly order: Order; readonly notice?: string }
  | { readonly kind: 'menu'; readonly menu: OrderMenu; readonly notice?: string }
  | { readonly kind: 'refuse'; readonly notice: string };

/** The way an order sends its army, from where the army stands, and its days on the way. */
export interface Route {
  readonly path: readonly MapPoint[];
  readonly days: number;
}

function travelDays(from: MapPoint, waypoints: readonly MapPoint[], kmPerDay: number): number {
  let km = 0;
  let at = from;
  for (const point of waypoints) {
    km += distance(at, point);
    at = point;
  }
  return Math.max(1, Math.ceil(km / kmPerDay));
}

/**
 * Where the march or the crossing takes its army if it applies today, or the reason the
 * rules refuse it. The rules play the order on a copy, so the answer is always theirs.
 */
export function route(
  state: State,
  world: World,
  order: MoveArmyOrder | EmbarkOrder,
): Route | string {
  const trial = structuredClone(state) as GameState;
  const rejected = executeOrder(trial, order, world);
  if (rejected) return rejected.reason;
  const after = trial.armies[order.army]?.activity;
  if (after?.kind === 'marching') {
    return {
      path: [after.position, ...after.waypoints],
      days: travelDays(after.position, after.waypoints, MARCH_KM_PER_DAY),
    };
  }
  const before = state.armies[order.army]?.activity;
  const convoy = after?.kind === 'embarked' ? trial.convoys[after.convoy] : undefined;
  if (!convoy || !before || before.kind === 'embarked') {
    throw new Error(`${order.kind} of army ${order.army} applied without setting it on its way`);
  }
  return {
    path: [before.position, convoy.position, ...convoy.waypoints],
    days: travelDays(convoy.position, convoy.waypoints, CONVOY_KM_PER_DAY),
  };
}

/** The port of its owner that the army stands at, chosen as the embark order chooses it. */
function portOf(
  state: State,
  world: World,
  army: DeepReadonly<Army>,
): DeepReadonly<City> | undefined {
  const { activity } = army;
  if (activity.kind !== 'idle' && activity.kind !== 'marching') return undefined;
  let port: DeepReadonly<City> | undefined;
  let portKm = Number.POSITIVE_INFINITY;
  for (const id of Object.keys(state.cities).sort()) {
    const city = state.cities[id as CityId];
    const harbour = city && world.harbours.get(city.id);
    if (!city || !harbour || city.owner !== army.owner) continue;
    const km = Math.min(
      distance(activity.position, city.position),
      distance(activity.position, harbour),
    );
    if (km <= AT_PORT_KM && km < portKm) {
      port = city;
      portKm = km;
    }
  }
  return port;
}

function daysText(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * What a right click on the target does with the player's army, decided before any
 * order waits. The army marches to the city or the point. From one of its ports, a
 * click on another port offers the ways there that the rules allow. What the rules
 * would refuse is refused at once, in words, and never queued.
 */
export function planCommand(
  state: State,
  world: World,
  army: DeepReadonly<Army>,
  target: CommandTarget,
): Plan {
  const city = target.kind === 'city' ? target.city : undefined;
  const to = target.kind === 'city' ? target.city.position : target.point;
  const march: MoveArmyOrder = {
    kind: 'moveArmy',
    faction: army.owner,
    army: army.id,
    to: { x: to.x, y: to.y },
  };
  const notice =
    city && city.owner !== army.owner && !areAtWar(state, army.owner, city.owner)
      ? `At peace with ${factionName(state, city.owner)}. Declare war to besiege it.`
      : undefined;

  const port = city && world.harbours.has(city.id) ? portOf(state, world, army) : undefined;
  if (city && port && port.id !== city.id) {
    const sail: EmbarkOrder = { kind: 'embark', faction: army.owner, army: army.id, to: city.id };
    const ways = [
      { group: 'sea', label: `Sail from ${port.name} to ${city.name}`, order: sail },
      { group: 'land', label: `March to ${city.name}`, order: march },
    ] as const;
    const options = ways.flatMap((way) => {
      const found = route(state, world, way.order);
      return typeof found === 'string' ? [] : [{ ...way, detail: daysText(found.days) }];
    });
    if (options.length === 0) {
      return {
        kind: 'refuse',
        notice: `Order refused. No way by sea or by land leads from ${port.name} to ${city.name}.`,
      };
    }
    return { kind: 'menu', menu: { title: `Orders for ${city.name}`, options }, notice };
  }

  const found = route(state, world, march);
  if (typeof found === 'string') {
    // The rules name a destination by its coordinates. A city the player clicked reads better by name.
    const reason = city ? found.replace(`${to.x}, ${to.y}`, city.id) : found;
    return { kind: 'refuse', notice: refusalText(state, reason) };
  }
  return { kind: 'issue', order: march, notice };
}
