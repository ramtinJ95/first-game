import { FATE_DAYS } from '../cities.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
import { SIEGE_DISTANCE } from '../systems/sieges.ts';
import { ownedCity } from './owned-city.ts';

/**
 * Finds a city whose fate the faction may still decide: it fell to the faction within
 * FATE_DAYS, no fate was chosen yet, and an army of the faction stands at it.
 */
export function fallenCity(state: GameState, faction: FactionId, id: CityId): City | string {
  const city = ownedCity(state, faction, id);
  if (typeof city === 'string') return city;
  if (city.fellOn === null) return `city ${city.id} has no fate left to decide`;
  if (state.day - city.fellOn > FATE_DAYS) {
    return `city ${city.id} fell on day ${city.fellOn}, more than ${FATE_DAYS} days ago`;
  }
  const present = Object.values(state.armies).some(
    (army) =>
      army.owner === faction &&
      army.activity.kind !== 'embarked' &&
      Math.hypot(
        army.activity.position.x - city.position.x,
        army.activity.position.y - city.position.y,
      ) <= SIEGE_DISTANCE,
  );
  if (!present) return `no army of ${faction} stands at ${city.id}`;
  return city;
}
