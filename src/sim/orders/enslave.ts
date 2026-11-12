import { ENSLAVE } from '../cities.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
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
export function enslave(state: GameState, order: EnslaveOrder): string | undefined {
  const city = fallenCity(state, order.faction, order.city);
  if (typeof city === 'string') return city;
  const stores = state.factions[order.faction]?.stores;
  if (!stores) return `faction ${order.faction} does not exist`;
  const capital = capitalOf(state, order.faction, city);
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
 * The state records no capital, so the faction's capital is its most populous city of
 * capital rank other than the fallen one, or, when it holds none, its most populous
 * other city. Ties go to the lower id.
 */
function capitalOf(state: GameState, faction: FactionId, fallen: City): City | undefined {
  const others = Object.values(state.cities)
    .filter((other) => other.owner === faction && other.id !== fallen.id)
    .sort((a, b) => b.population - a.population || (a.id < b.id ? -1 : 1));
  return others.find((other) => other.rank === 'capital') ?? others[0];
}
