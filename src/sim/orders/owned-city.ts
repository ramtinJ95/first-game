import type { CityId, FactionId } from '../ids.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';

/** Finds a city the faction owns, or the reason it may not give orders there. */
export function ownedCity(state: GameState, faction: FactionId, id: CityId): City | string {
  const city = Object.hasOwn(state.cities, id) ? state.cities[id] : undefined;
  if (!city) return `city ${id} does not exist`;
  if (city.owner !== faction) return `city ${id} belongs to ${city.owner}, not ${faction}`;
  return city;
}
