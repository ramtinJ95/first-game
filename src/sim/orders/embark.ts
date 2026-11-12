import { allocateId, type ArmyId, type CityId, type FactionId } from '../ids.ts';
import { busyReason } from '../march.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
import { distance, findPath } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import { ownedArmy } from './owned-army.ts';

/** An army this close to a port city of its faction, or to that city's harbour, stands at that port. */
export const AT_PORT_KM = 10;

export interface EmbarkOrder {
  kind: 'embark';
  faction: FactionId;
  army: ArmyId;
  /** The port city where the army lands. */
  to: CityId;
}

/**
 * Puts an army that stands at one of its faction's ports aboard a new convoy, which
 * sails from that port's harbour to the harbour of the destination port.
 */
export function embark(state: GameState, order: EmbarkOrder, world: World): string | undefined {
  const army = ownedArmy(state, order.faction, order.army);
  if (typeof army === 'string') return army;
  const { activity } = army;
  if (activity.kind !== 'idle' && activity.kind !== 'marching') return busyReason(army);
  const at = activity.position;

  let port: City | undefined;
  let portDistance = Number.POSITIVE_INFINITY;
  for (const id of Object.keys(state.cities).sort()) {
    const city = state.cities[id as CityId];
    const harbour = city && world.harbours.get(city.id);
    if (!city || !harbour || city.owner !== army.owner) continue;
    const away = Math.min(distance(at, city.position), distance(at, harbour));
    if (away <= AT_PORT_KM && away < portDistance) {
      port = city;
      portDistance = away;
    }
  }
  if (!port) return `army ${army.id} does not stand at a port of ${army.owner}`;
  const destination = Object.hasOwn(state.cities, order.to) ? state.cities[order.to] : undefined;
  const landing = world.harbours.get(order.to);
  if (!destination) return `city ${order.to} does not exist`;
  if (!landing) return `${destination.name} is not a port`;
  if (destination.id === port.id) return `army ${army.id} already stands at ${port.name}`;
  const harbour = world.harbours.get(port.id);
  const path = harbour && findPath(world.mesh, harbour, landing, 'sea');
  if (!harbour || !path) return `no sea route leads from ${port.name} to ${destination.name}`;

  const convoy = allocateId(state, 'convoy');
  state.convoys[convoy] = {
    id: convoy,
    owner: army.owner,
    position: { x: harbour.x, y: harbour.y },
    armies: [army.id],
    waypoints: path,
  };
  army.activity = { kind: 'embarked', convoy };
  return undefined;
}
