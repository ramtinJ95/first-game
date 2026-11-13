import { SACK } from '../cities.ts';
import { emit } from '../events.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import { OUTPUT_PER_PERSON } from '../systems/economy.ts';
import { fallenCity } from './fallen-city.ts';

export interface SackOrder {
  kind: 'sack';
  faction: FactionId;
  city: CityId;
}

/**
 * Takes the city's wealth as gold at once, at the cost of a share of its people, a long
 * unrest, and every building in it.
 */
export function sack(state: GameState, order: SackOrder): string | undefined {
  const city = fallenCity(state, order.faction, order.city);
  if (typeof city === 'string') return city;
  const stores = state.factions[order.faction]?.stores;
  if (!stores) return `faction ${order.faction} does not exist`;
  stores.gold += city.population * OUTPUT_PER_PERSON.gold * 365 * SACK.wealthYears;
  city.population *= 1 - SACK.populationShare;
  city.unrestDays = SACK.unrestDays;
  city.fellOn = null;
  city.sackedOn = state.day;
  const lost = [...city.buildings, ...(city.construction ? [city.construction.building] : [])];
  city.buildings = [];
  city.construction = null;
  if (lost.length > 0) {
    emit(state, {
      kind: 'buildingsLost',
      city: city.id,
      owner: order.faction,
      buildings: lost,
      cause: 'sack',
      position: city.position,
    });
  }
  return undefined;
}
