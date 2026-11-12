import type { CityId, FactionId } from './ids.ts';
import type { GameState } from './state/game-state.ts';

/** How long a city that changed owner stays in unrest. Its output recovers evenly over these days. */
export const UNREST_DAYS = 90;

/**
 * Hands a city and its province to a new owner. The city starts its full period of
 * unrest, and every formation the old owner was raising there is lost without refund.
 */
export function changeCityOwner(state: GameState, cityId: CityId, owner: FactionId): void {
  const city = Object.hasOwn(state.cities, cityId) ? state.cities[cityId] : undefined;
  if (!city) throw new Error(`city ${cityId} does not exist`);
  if (!Object.hasOwn(state.factions, owner)) throw new Error(`faction ${owner} does not exist`);
  city.owner = owner;
  city.unrestDays = UNREST_DAYS;
  city.recruits = [];
}
