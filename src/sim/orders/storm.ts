import type { CityId, FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import { canBesiege, siegeAt, stormCity } from '../systems/sieges.ts';

export interface StormOrder {
  kind: 'storm';
  faction: FactionId;
  city: CityId;
}

/** Sends the faction's armies that besiege the city at its walls today. */
export function storm(state: GameState, order: StormOrder): string | undefined {
  const city = Object.hasOwn(state.cities, order.city) ? state.cities[order.city] : undefined;
  if (!city) return `city ${order.city} does not exist`;
  const siege = siegeAt(state, city);
  if (!siege) return `city ${city.id} is not under siege`;
  const ready = siege.besiegers.some((id) => {
    const army = state.armies[id];
    return army?.owner === order.faction && canBesiege(state, army);
  });
  if (!ready) {
    return `${order.faction} has no army in the siege of ${city.id} that can storm, unbroken and supplied`;
  }
  stormCity(state, siege, order.faction);
  return undefined;
}
