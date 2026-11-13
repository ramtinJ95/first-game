import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { ArmyId, CityId } from '../sim/ids.ts';
import {
  CONVOY_KM_PER_DAY,
  MARCH_KM_PER_DAY,
  marchDays,
  marchPath,
  MAX_MARCH_DAYS,
} from '../sim/march.ts';
import { AT_PORT_KM, type EmbarkOrder } from '../sim/orders/embark.ts';
import type { MoveArmyOrder } from '../sim/orders/move-army.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { Army } from '../sim/state/army.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { areAtWar } from '../sim/wars.ts';
import { distance, findPath, surfaceAt } from '../sim/world/find-path.ts';
import type { World } from '../sim/world/world.ts';
import { movedArmy } from './clock.ts';
import { factionName, placeName, refusalText } from './names.ts';

type State = DeepReadonly<GameState>;

/**
 * A way that takes more than this many times the days of the quickest way is not offered,
 * so a march this much longer than the way by sea asks which way to go. Between cities within the AI's war reach, a march that no
 * crossing beats by this much takes at most 65 days, and one that a crossing does beat is
 * most often a walk of 100 days or more round a sea. It is also the weight the AI gives a
 * km at sea against a km of road.
 */
export const FAR_LONGER = 1.5;

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

/** The way by sea from the army to the place: the order that starts it, and its legs in days. */
interface SeaWay {
  readonly order: EmbarkOrder | MoveArmyOrder;
  readonly port: DeepReadonly<City>;
  readonly landing: DeepReadonly<City>;
  readonly walk: number;
  readonly sail: number;
  readonly ashore: number;
}

function wayDays(way: SeaWay): number {
  return way.walk + way.sail + way.ashore;
}

/**
 * The quickest way by sea for the army to the place: a march of at most MAX_MARCH_DAYS to
 * a port of its owner, or none when it stands at one, a crossing to a port, and a march
 * of at most MAX_MARCH_DAYS from that port's harbour, or none when the place is that port.
 */
function seaWay(
  state: State,
  world: World,
  army: DeepReadonly<Army>,
  to: MapPoint,
  city: DeepReadonly<City> | undefined,
): SeaWay | undefined {
  const { activity } = army;
  if (activity.kind !== 'idle' && activity.kind !== 'marching' && activity.kind !== 'besieging') {
    return undefined;
  }
  const at = activity.position;
  const reach = MAX_MARCH_DAYS * MARCH_KM_PER_DAY;
  const harbour = (port: DeepReadonly<City>) => world.harbours.get(port.id) as MapPoint;
  const ports = Object.values(state.cities)
    .filter((port) => world.harbours.has(port.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const here = portOf(state, world, army);
  const starts = here
    ? [here]
    : ports.filter((port) => port.owner === army.owner && distance(at, port.position) <= reach);
  const landings =
    city && world.harbours.has(city.id)
      ? [city]
      : ports.filter((port) => distance(harbour(port), to) <= reach);

  const marched = new Map<string, number | undefined>();
  const march = (from: MapPoint, end: MapPoint) => {
    const key = `${from.x},${from.y};${end.x},${end.y}`;
    if (!marched.has(key)) {
      const path = marchPath(world, from, end);
      marched.set(key, typeof path === 'string' ? undefined : marchDays(from, path));
    }
    return marched.get(key);
  };
  const pairs = starts
    .flatMap((port) =>
      landings.filter((landing) => landing.id !== port.id).map((landing) => ({ port, landing })),
    )
    .map((pair) => ({
      ...pair,
      bound:
        (pair.port === here ? 0 : distance(at, pair.port.position) / MARCH_KM_PER_DAY) +
        distance(harbour(pair.port), harbour(pair.landing)) / CONVOY_KM_PER_DAY +
        distance(harbour(pair.landing), to) / MARCH_KM_PER_DAY,
    }))
    .sort((a, b) => a.bound - b.bound);

  let best: SeaWay | undefined;
  for (const { port, landing, bound } of pairs) {
    if (best && bound >= wayDays(best)) break;
    const walk = port === here ? 0 : march(at, port.position);
    if (walk === undefined) continue;
    const ashore = city && landing.id === city.id ? 0 : march(harbour(landing), to);
    if (ashore === undefined) continue;
    const path = findPath(world.mesh, harbour(port), harbour(landing), 'sea');
    if (!path) continue;
    const sail = travelDays(harbour(port), path, CONVOY_KM_PER_DAY);
    const order: EmbarkOrder | MoveArmyOrder =
      port === here
        ? { kind: 'embark', faction: army.owner, army: army.id, to: landing.id }
        : {
            kind: 'moveArmy',
            faction: army.owner,
            army: army.id,
            to: { x: port.position.x, y: port.position.y },
          };
    const way = { order, port, landing, walk, sail, ashore };
    if (!best || wayDays(way) < wayDays(best)) best = way;
  }
  return best;
}

/** The menu line of a way by sea, which names each leg and its days. */
function seaOption(way: SeaWay): MenuOption {
  const legs = [
    ...(way.walk > 0 ? [daysText(way.walk)] : []),
    `${way.walk > 0 ? 'then ' : ''}${daysText(way.sail)}${way.walk > 0 ? ' by sea' : ''}`,
    ...(way.ashore > 0 ? [`then ${daysText(way.ashore)} by land`] : []),
  ];
  return {
    group: 'sea',
    label:
      way.order.kind === 'embark'
        ? `Sail from ${way.port.name} to ${way.landing.name}`
        : `March to ${way.port.name} to sail for ${way.landing.name}`,
    detail: legs.join(', '),
    order: way.order,
  };
}

/**
 * What a right click on the target does with the player's army, decided before any
 * order waits. The army marches to the city or the point. The ways there are that march,
 * if the rules allow it, and the quickest way by sea, and a way that takes more than
 * FAR_LONGER times the quickest is dropped. When the march is dropped, or the click is
 * from one of the army's ports on another port and the way by sea stays, a menu offers
 * the ways left with their days. What the rules would refuse is refused at once, in
 * words, and never queued.
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
  const found = route(state, world, march);
  // The rules name a destination by its coordinates. A city the player clicked reads better by name.
  const refusal = (reason: string) =>
    refusalText(state, city ? reason.replace(`${to.x}, ${to.y}`, city.id) : reason);
  const { activity } = army;
  if (activity.kind !== 'idle' && activity.kind !== 'marching' && activity.kind !== 'besieging') {
    return { kind: 'refuse', notice: refusal(typeof found === 'string' ? found : '') };
  }
  if (typeof found === 'string' && surfaceAt(world.mesh, to) !== 'land') {
    return { kind: 'refuse', notice: refusal(found) };
  }

  const port = city && world.harbours.has(city.id) ? portOf(state, world, army) : undefined;
  const portToPort = !!port && port.id !== city?.id;
  // No way by sea is quicker than a march in a straight line, so only a longer march can be far longer.
  const straight = Math.max(1, Math.ceil(distance(activity.position, to) / MARCH_KM_PER_DAY));
  const mayBeFar = typeof found === 'string' || found.days > FAR_LONGER * straight;
  const sea = portToPort || mayBeFar ? seaWay(state, world, army, to, city) : undefined;
  const ways: { option: MenuOption; days: number }[] = [];
  if (sea && typeof route(state, world, sea.order) !== 'string') {
    ways.push({ option: seaOption(sea), days: wayDays(sea) });
  }
  if (typeof found !== 'string') {
    const label = `March to ${city?.name ?? 'that point'}`;
    const option = { group: 'land', label, detail: daysText(found.days), order: march } as const;
    ways.push({ option, days: found.days });
  }
  const quickest = Math.min(...ways.map((way) => way.days));
  const sensible = ways.filter((way) => way.days <= FAR_LONGER * quickest);
  const bySea = sensible.some((way) => way.option.group === 'sea');
  const byLand = sensible.some((way) => way.option.group === 'land');
  if (bySea && (portToPort || !byLand)) {
    const title = `Orders for ${city?.name ?? `the field ${placeName(state, to)}`}`;
    return { kind: 'menu', menu: { title, options: sensible.map((way) => way.option) }, notice };
  }
  if (typeof found === 'string') {
    if (port && city && portToPort) {
      return {
        kind: 'refuse',
        notice: `Order refused. No way by sea or by land leads from ${port.name} to ${city.name}.`,
      };
    }
    return {
      kind: 'refuse',
      notice: `${refusal(found)} No way by sea from a port of yours lands within ${MAX_MARCH_DAYS} days' march of it.`,
    };
  }
  return { kind: 'issue', order: march, notice };
}

/**
 * The paths that the player's waiting march and sail orders will take, and the armies
 * whose movement a waiting order replaces, so their current march is no longer drawn.
 */
export function plannedRoutes(
  state: State,
  world: World,
  pending: readonly Order[],
): { readonly paths: readonly (readonly MapPoint[])[]; readonly replaced: ReadonlySet<ArmyId> } {
  const mine = pending.filter((order) => order.faction === state.player);
  const replaced = new Set(mine.flatMap((order) => movedArmy(order) ?? []));
  const paths = mine.flatMap((order) => {
    if (order.kind !== 'moveArmy' && order.kind !== 'embark') return [];
    const way = route(state, world, order);
    return typeof way === 'string' ? [] : [way.path];
  });
  return { paths, replaced };
}
