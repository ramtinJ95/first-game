import { ENSLAVE } from '../cities.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
import type { World } from '../world/world.ts';
import { fallenCity } from './fallen-city.ts';

export interface EnslaveOrder {
  kind: 'enslave';
  faction: FactionId;
  city: CityId;
}

/**
 * Carries off a share of the city's people at the cost of a long unrest. Some of the
 * captives become manpower at once, and the rest join the owner's capital.
 */
export function enslave(state: GameState, order: EnslaveOrder, world: World): string | undefined {
  const city = fallenCity(state, order.faction, order.city);
  if (typeof city === 'string') return city;
  const stores = state.factions[order.faction]?.stores;
  if (!stores) return `faction ${order.faction} does not exist`;
  const capital = capitalOf(state, world, order.faction, city);
  if (!capital) return `${order.faction} has no other city to take captives to`;
  const captives = Math.floor(city.population * ENSLAVE.populationShare);
  const manpower = Math.round(captives * ENSLAVE.manpowerShare);
  city.population -= captives;
  capital.population += captives - manpower;
  stores.manpower += manpower;
  city.unrestDays = ENSLAVE.unrestDays;
  city.fellOn = null;
  return undefined;
}

/**
 * The faction's own capital from the map, which is a great power's capital province
 * or a minor's one city, while the faction holds it. Once it is lost, the faction's
 * most populous other city. Ties go to the lower id.
 */
function capitalOf(
  state: GameState,
  world: World,
  faction: FactionId,
  fallen: City,
): City | undefined {
  const home = world.map.provinces.find((province) =>
    province.owner === 'independent'
      ? (province.id as string) === faction
      : province.owner === faction && province.capital,
  );
  const own = home && state.cities[home.id as string as CityId];
  if (own && own.owner === faction && own.id !== fallen.id) return own;
  return Object.values(state.cities)
    .filter((other) => other.owner === faction && other.id !== fallen.id)
    .sort((a, b) => b.population - a.population || (a.id < b.id ? -1 : 1))[0];
}
