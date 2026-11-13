import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { ArmyId, FactionId } from '../sim/ids.ts';
import {
  CONVOY_KM_PER_DAY,
  MARCH_KM_PER_DAY,
  marchDays,
  marchPath,
  MAX_MARCH_DAYS,
} from '../sim/march.ts';
import {
  embarkationAt,
  GATHER_DAYS,
  type EmbarkOrder,
  type Embarkation,
} from '../sim/orders/embark.ts';
import type { MoveArmyOrder } from '../sim/orders/move-army.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { Army } from '../sim/state/army.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { menOf } from '../sim/systems/economy.ts';
import { BLOCKADE_ODDS, SIEGE_DISTANCE } from '../sim/systems/sieges.ts';
import { areAtWar } from '../sim/wars.ts';
import { connected, distance, findPath, locate, surfaceAt } from '../sim/world/find-path.ts';
import { nearestSea, type World } from '../sim/world/world.ts';
import { movedArmy } from './clock.ts';
import { factionName, placeName, refusalText, whole } from './names.ts';

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
  | {
      readonly kind: 'issue';
      readonly order: Order;
      readonly notice?: string;
      /** What the order does, such as the days a march takes, told when no notice warns. */
      readonly info: string;
    }
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
  const landing = convoy.waypoints.at(-1) ?? convoy.position;
  const ashore = after?.kind === 'embarked' ? (after.march ?? []) : [];
  return {
    path: [before.position, convoy.position, ...convoy.waypoints, ...ashore],
    days:
      (convoy.departsOn === undefined ? 0 : convoy.departsOn - state.day) +
      travelDays(convoy.position, convoy.waypoints, CONVOY_KM_PER_DAY) +
      (ashore.length > 0 ? travelDays(landing, ashore, MARCH_KM_PER_DAY) : 0),
  };
}

/** Where the army would sail from today for the sea point, chosen as the embark order chooses it. */
function embarkationOf(
  state: State,
  world: World,
  army: DeepReadonly<Army>,
  toward: MapPoint,
): Embarkation | undefined {
  const { activity } = army;
  if (activity.kind !== 'idle' && activity.kind !== 'marching' && activity.kind !== 'besieging') {
    return undefined;
  }
  return embarkationAt(state, world, army.owner, activity.position, toward);
}

function daysText(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The way by sea from the army to the place: the order that starts it, and its legs in days. */
interface SeaWay {
  readonly order: EmbarkOrder | MoveArmyOrder;
  readonly start: Embarkation;
  readonly landing: DeepReadonly<City>;
  readonly walk: number;
  readonly sail: number;
  readonly ashore: number;
  readonly here: boolean;
}

function wayDays(way: SeaWay): number {
  return way.walk + way.start.waitDays + way.sail + way.ashore;
}

/**
 * The quickest way by sea for the army to the place: a march of at most MAX_MARCH_DAYS to
 * a port of its owner or to the nearest shore of the sea the landing lies on, or none when it stands at its own port or
 * sails from the shore it stands on, the days it
 * waits for ships on a shore that is no port of its own, a crossing to a port, and a march
 * of at most MAX_MARCH_DAYS from that port's harbour to the place.
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
  const landings =
    city && world.harbours.has(city.id)
      ? [city]
      : ports.filter((port) => distance(harbour(port), to) <= reach);
  // Where the army sails from depends on the sea it sails on, so the starts are found once for each sea.
  const startsBySea = new Map<number, { here: Embarkation | undefined; starts: Embarkation[] }>();
  const startsFor = (landing: DeepReadonly<City>) => {
    const toward = harbour(landing);
    const sea = world.mesh.component[locate(world.mesh, toward, 'sea')] as number;
    let found = startsBySea.get(sea);
    if (!found) {
      const here = embarkationAt(state, world, army.owner, at, toward);
      const shore = here ? undefined : nearestSea(world.mesh, at, sea);
      const starts: Embarkation[] = here?.port
        ? [here]
        : [
            ...(here ? [here] : []),
            ...ports
              .filter(
                (port) =>
                  port.owner === army.owner &&
                  distance(at, port.position) <= reach &&
                  connected(world.mesh, harbour(port), toward, 'sea'),
              )
              .map((port) => ({ from: harbour(port), port, waitDays: 0 })),
            ...(shore && distance(at, shore) <= reach
              ? [{ from: shore, port: undefined, waitDays: GATHER_DAYS }]
              : []),
          ];
      found = { here, starts };
      startsBySea.set(sea, found);
    }
    return found;
  };

  const marched = new Map<string, number | undefined>();
  const march = (from: MapPoint, end: MapPoint) => {
    const key = `${from.x},${from.y};${end.x},${end.y}`;
    if (!marched.has(key)) {
      const path = marchPath(world, from, end);
      marched.set(key, typeof path === 'string' ? undefined : marchDays(from, path));
    }
    return marched.get(key);
  };
  const walkTo = (start: Embarkation) => (start.port ? start.port.position : start.from);
  const pairs = landings
    .flatMap((landing) => {
      const { here, starts } = startsFor(landing);
      return starts
        .filter(
          (start) => landing.id !== start.port?.id && distance(harbour(landing), start.from) >= 1,
        )
        .map((start) => ({ start, landing, here: start === here }));
    })
    .map((pair) => ({
      ...pair,
      bound:
        (pair.here ? 0 : distance(at, walkTo(pair.start)) / MARCH_KM_PER_DAY) +
        pair.start.waitDays +
        distance(pair.start.from, harbour(pair.landing)) / CONVOY_KM_PER_DAY +
        distance(harbour(pair.landing), to) / MARCH_KM_PER_DAY,
    }))
    .sort((a, b) => a.bound - b.bound);

  let best: SeaWay | undefined;
  for (const { start, landing, bound, here } of pairs) {
    if (best && bound >= wayDays(best)) break;
    const walk = here ? 0 : march(at, walkTo(start));
    if (walk === undefined) continue;
    const ashore =
      city?.id === landing.id && distance(harbour(landing), to) <= SIEGE_DISTANCE
        ? 0
        : march(harbour(landing), to);
    if (ashore === undefined) continue;
    const path = findPath(world.mesh, start.from, harbour(landing), 'sea');
    if (!path) continue;
    const sail = travelDays(start.from, path, CONVOY_KM_PER_DAY);
    const onward = city?.id === landing.id ? {} : { then: { x: to.x, y: to.y } };
    const order: EmbarkOrder | MoveArmyOrder = here
      ? { kind: 'embark', faction: army.owner, army: army.id, to: landing.id, ...onward }
      : { kind: 'moveArmy', faction: army.owner, army: army.id, to: walkTo(start) };
    const way = { order, start, landing, walk, sail, ashore, here };
    if (!best || wayDays(way) < wayDays(best)) best = way;
  }
  return best;
}

/** The menu line of a way by sea, which names each leg and its days. */
function seaOption(state: State, way: SeaWay): MenuOption {
  const legs = [
    ...(way.walk > 0 ? [`${daysText(way.walk)} to the ${way.start.port ? 'port' : 'shore'}`] : []),
    ...(way.start.waitDays > 0 ? [`${daysText(way.start.waitDays)} to gather ships`] : []),
    `${daysText(way.sail)} by sea`,
    ...(way.ashore > 0 ? [`${daysText(way.ashore)} by land`] : []),
  ];
  const from = way.start.port?.name ?? `the shore ${placeName(state, way.start.from)}`;
  return {
    group: 'sea',
    label: way.here
      ? `Sail from ${from} to ${way.landing.name}`
      : `March to ${from} to sail for ${way.landing.name}`,
    detail: legs.map((leg, i) => (i === 0 ? leg : `then ${leg}`)).join(', '),
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
/**
 * Why a siege of the city by the army, with its owner's armies that besiege it already,
 * would not cut the city's food: fewer men than BLOCKADE_ODDS times the garrison, the
 * test the weak-siege news uses. It names the garrison, the men, and the men still needed.
 */
function weakSiegeWarning(
  state: State,
  army: DeepReadonly<Army>,
  city: DeepReadonly<City>,
): string | undefined {
  const siege = Object.values(state.sieges).find((s) => s.city === city.id);
  const others = (siege?.besiegers ?? []).flatMap((id) => {
    const other = state.armies[id];
    return other && other.id !== army.id && other.owner === army.owner ? [other] : [];
  });
  const men = [army, ...others].reduce((sum, one) => sum + menOf(state, one), 0);
  const needed = Math.ceil(BLOCKADE_ODDS * city.garrison) - men;
  if (needed <= 0) return undefined;
  return `${city.name} holds a garrison of ${whole(city.garrison)}, more than the ${whole(men)} men who would besiege it. Its food would not fall, and sallies would cut the besiegers down. ${whole(needed)} more men would hold the siege.`;
}

export function planCommand(
  state: State,
  world: World,
  army: DeepReadonly<Army>,
  target: CommandTarget,
  pending: readonly Order[] = [],
): Plan {
  const city = target.kind === 'city' ? target.city : undefined;
  const to = target.kind === 'city' ? target.city.position : target.point;
  const march: MoveArmyOrder = {
    kind: 'moveArmy',
    faction: army.owner,
    army: army.id,
    to: { x: to.x, y: to.y },
  };
  // A war declared while the game is paused begins on the day the march is given.
  const atWar = (owner: FactionId) =>
    areAtWar(state, army.owner, owner) ||
    pending.some(
      (order) =>
        order.kind === 'declareWar' && order.faction === army.owner && order.against === owner,
    );
  // A march to a point within SIEGE_DISTANCE of an enemy city besieges it as a march to the city does.
  const besieged =
    city ??
    Object.values(state.cities)
      .filter((c) => atWar(c.owner) && distance(c.position, to) <= SIEGE_DISTANCE)
      .sort((a, b) => distance(a.position, to) - distance(b.position, to))[0];
  const notice =
    besieged && besieged.owner !== army.owner
      ? atWar(besieged.owner)
        ? weakSiegeWarning(state, army, besieged)
        : `At peace with ${factionName(state, besieged.owner)}. Declare war to besiege it.`
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

  const landing = city && world.harbours.get(city.id);
  const start = landing && embarkationOf(state, world, army, landing);
  const portToPort = !!start && start.port?.id !== city?.id;
  // No way by sea is quicker than a march in a straight line, so only a longer march can be far longer.
  const straight = Math.max(1, Math.ceil(distance(activity.position, to) / MARCH_KM_PER_DAY));
  const mayBeFar = typeof found === 'string' || found.days > FAR_LONGER * straight;
  const sea = portToPort || mayBeFar ? seaWay(state, world, army, to, city) : undefined;
  const ways: { option: MenuOption; days: number }[] = [];
  if (sea && typeof route(state, world, sea.order) !== 'string') {
    ways.push({ option: seaOption(state, sea), days: wayDays(sea) });
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
    if (start && city && portToPort) {
      const from = start.port?.name ?? `the shore ${placeName(state, start.from)}`;
      return {
        kind: 'refuse',
        notice: `Order refused. No way by sea or by land leads from ${from} to ${city.name}.`,
      };
    }
    return {
      kind: 'refuse',
      notice: `${refusal(found)} No way by sea lands within ${MAX_MARCH_DAYS} days' march of it.`,
    };
  }
  const where = placeName(state, to);
  const named = city?.name ?? (where.startsWith('at ') ? where.slice(3) : `a point ${where}`);
  const info = `March to ${named}: ${daysText(found.days)}.`;
  return { kind: 'issue', order: march, info, ...(notice && { notice }) };
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
