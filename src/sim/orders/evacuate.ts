import { allocateId, type CityId, type FactionId } from '../ids.ts';
import { landPath } from '../march.ts';
import type { GameState } from '../state/game-state.ts';
import type { World } from '../world/world.ts';
import { ownedCity } from './owned-city.ts';

export interface EvacuateOrder {
  kind: 'evacuate';
  faction: FactionId;
  city: CityId;
  to: CityId;
  /** The share of the city's people who leave, above 0 and up to 1. */
  share: number;
}

/**
 * Takes the share of the city's people, rounded down, out of the city at once and
 * sets them out as a refugee column on the land path to the other city. The movement
 * system walks the column.
 */
export function evacuate(state: GameState, order: EvacuateOrder, world: World): string | undefined {
  const from = ownedCity(state, order.faction, order.city);
  if (typeof from === 'string') return from;
  const to = ownedCity(state, order.faction, order.to);
  if (typeof to === 'string') return to;
  if (from.id === to.id) return `refugees from ${from.id} need another city to walk to`;
  if (!(order.share > 0 && order.share <= 1)) {
    return `share ${order.share} is not above 0 and up to 1`;
  }
  const people = Math.floor(from.population * order.share);
  if (people < 1) return `${order.share} of ${from.id} is nobody`;
  const path = landPath(world, from.position, to.position);
  if (typeof path === 'string') return `no land route leads from ${from.id} to ${to.id}`;
  from.population -= people;
  const id = allocateId(state, 'refugeeColumn');
  state.refugeeColumns[id] = {
    id,
    owner: order.faction,
    people,
    from: from.id,
    to: to.id,
    position: { x: from.position.x, y: from.position.y },
    waypoints: path,
  };
  return undefined;
}
