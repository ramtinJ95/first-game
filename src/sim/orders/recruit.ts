import type { CityId, FactionId } from '../ids.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import { beleaguered } from '../systems/sieges.ts';
import { TROOPS, type Troop } from '../troops.ts';
import { ownedCity } from './owned-city.ts';

export interface RecruitOrder {
  kind: 'recruit';
  faction: FactionId;
  city: CityId;
  troop: Troop;
}

/**
 * Pays the troop's gold and manpower now. The economy system musters the formation
 * when its days of training are over. A besieged city musters what it trains at once
 * and starts no new training, nor does a city with an enemy army at its walls.
 */
export function recruit(state: GameState, order: RecruitOrder): string | undefined {
  if (!Object.hasOwn(TROOPS, order.troop)) return `troop ${order.troop} does not exist`;
  const city = ownedCity(state, order.faction, order.city);
  if (typeof city === 'string') return city;
  if (city.unrestDays > 0) return `city ${city.id} is in unrest for ${city.unrestDays} more days`;
  if (beleaguered(state, city)) return `city ${city.id} is under siege`;
  const { men, gold, days } = TROOPS[order.troop].recruit;
  const stores = state.factions[order.faction]?.stores;
  if (!stores) return `faction ${order.faction} does not exist`;
  if (stores.gold < gold)
    return `${order.troop} cost ${gold} gold, but ${order.faction} has ${Math.floor(stores.gold)}`;
  if (stores.manpower < men) {
    return `${order.troop} need ${men} manpower, but ${order.faction} has ${Math.floor(stores.manpower)}`;
  }
  stores.gold -= gold;
  stores.manpower -= men;
  city.recruits.push({ troop: order.troop, readyOn: (state.day + days) as Day });
  return undefined;
}
