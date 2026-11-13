import { removeBesieger } from '../armies.ts';
import type { DeepReadonly } from '../deep-readonly.ts';
import { allocateId, type ArmyId, type CityId, type FactionId } from '../ids.ts';
import { busyReason, marchPath } from '../march.ts';
import type { Army } from '../state/army.ts';
import type { City } from '../state/city.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { distance, findPath } from '../world/find-path.ts';
import { nearestSea, type World } from '../world/world.ts';
import { SIEGE_DISTANCE } from '../systems/sieges.ts';
import { ownedArmy } from './owned-army.ts';

/** An army this close to a port city of its faction, or to that city's harbour, stands at that port. */
export const AT_PORT_KM = 10;
/** An army this close to the sea stands on the shore, where it can gather ships. */
export const SHORE_KM = AT_PORT_KM;
/**
 * The days an army waits on a shore that is not a port of its own while it gathers ships.
 * It is a third of the 29 days of the crossing from Carthago to Roma, so a port of one's own
 * within 10 days' march is the quicker start, and a beaten army overseas is still home in
 * about six weeks.
 */
export const GATHER_DAYS = 10;

export interface EmbarkOrder {
  kind: 'embark';
  faction: FactionId;
  army: ArmyId;
  /** The port city where the army lands. */
  to: CityId;
  /**
   * Where the army marches on to once it lands. Without it the army marches into the port
   * city when its harbour lies farther from it than SIEGE_DISTANCE, and stands at the harbour otherwise.
   */
  then?: MapPoint;
}

/** Where an army sails from: the harbour of its own port, or a point of the shore after GATHER_DAYS. */
export interface Embarkation {
  readonly from: MapPoint;
  /** The army's own port it sails from, absent on any other shore. */
  readonly port: DeepReadonly<City> | undefined;
  readonly waitDays: number;
}

/**
 * Where the army at the point would sail from. A port of its owner, within AT_PORT_KM of the
 * city or its harbour, has ships ready. Any other shore within SHORE_KM of the sea, an enemy
 * or a neutral port included, takes GATHER_DAYS to gather them, so no army is ever shut in
 * where it stands.
 */
export function embarkationAt(
  state: DeepReadonly<GameState>,
  world: World,
  owner: FactionId,
  at: MapPoint,
): Embarkation | undefined {
  let port: DeepReadonly<City> | undefined;
  let portDistance = Number.POSITIVE_INFINITY;
  for (const id of Object.keys(state.cities).sort()) {
    const city = state.cities[id as CityId];
    const harbour = city && world.harbours.get(city.id);
    if (!city || !harbour || city.owner !== owner) continue;
    const away = Math.min(distance(at, city.position), distance(at, harbour));
    if (away <= AT_PORT_KM && away < portDistance) {
      port = city;
      portDistance = away;
    }
  }
  const harbour = port && world.harbours.get(port.id);
  if (port && harbour) return { from: harbour, port, waitDays: 0 };
  const shore = nearestSea(world.mesh, at);
  if (!shore || distance(at, shore) > SHORE_KM) return undefined;
  return { from: shore, port: undefined, waitDays: GATHER_DAYS };
}

/** Where the army stands, if it may set out by sea from there today. */
function standing(army: Army): MapPoint | string {
  const { activity } = army;
  if (activity.kind === 'idle' || activity.kind === 'marching' || activity.kind === 'besieging') {
    return activity.position;
  }
  return busyReason(army) ?? `army ${army.id} cannot set out`;
}

/**
 * Puts an army that stands at a port of its own, or on any shore, aboard a new convoy that
 * sails to the harbour of the destination port, from that port's harbour at once or from
 * the shore once it has gathered its ships. A besieging army leaves its siege. Once it lands,
 * the army marches on, along a land path found now, to the order's point, or to the port
 * city when its harbour lies farther from it than SIEGE_DISTANCE, so it stands at the city.
 */
export function embark(state: GameState, order: EmbarkOrder, world: World): string | undefined {
  const army = ownedArmy(state, order.faction, order.army);
  if (typeof army === 'string') return army;
  const at = standing(army);
  if (typeof at === 'string') return at;
  const start = embarkationAt(state, world, army.owner, at);
  if (!start) return `army ${army.id} stands at no port of ${army.owner} and on no shore`;
  const destination = Object.hasOwn(state.cities, order.to) ? state.cities[order.to] : undefined;
  const landing = world.harbours.get(order.to);
  if (!destination) return `city ${order.to} does not exist`;
  if (!landing) return `${destination.name} is not a port`;
  if (destination.id === start.port?.id || distance(start.from, landing) < 1) {
    return `army ${army.id} already stands at ${destination.name}`;
  }
  const path = findPath(world.mesh, start.from, landing, 'sea');
  if (!path) return `no sea route leads to ${destination.name}`;
  const ashore =
    order.then ??
    (distance(landing, destination.position) > SIEGE_DISTANCE ? destination.position : undefined);
  const march = ashore && marchPath(world, landing, ashore);
  if (typeof march === 'string' && order.then) return march;

  if (army.activity.kind === 'besieging') removeBesieger(state, army.activity.siege, army.id);
  const convoy = allocateId(state, 'convoy');
  state.convoys[convoy] = {
    id: convoy,
    owner: army.owner,
    position: { x: start.from.x, y: start.from.y },
    armies: [army.id],
    waypoints: path,
    ...(start.waitDays > 0 && { departsOn: (state.day + start.waitDays) as Day }),
  };
  army.activity = {
    kind: 'embarked',
    convoy,
    ...(march && typeof march !== 'string' && march.length > 0 && { march }),
  };
  return undefined;
}
