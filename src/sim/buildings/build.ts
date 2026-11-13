import type { DeepReadonly } from '../deep-readonly.ts';
import type { CityId, FactionId } from '../ids.ts';
import { ownedCity } from '../orders/owned-city.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
import { beleaguered } from '../systems/sieges.ts';
import { BUILDINGS, CANCEL_REFUND, hasBuilt, type BuildingKind } from './buildings.ts';

export interface BuildOrder {
  kind: 'build';
  faction: FactionId;
  city: CityId;
  building: BuildingKind;
}

export interface CancelBuildingOrder {
  kind: 'cancelBuilding';
  faction: FactionId;
  city: CityId;
}

/**
 * Why the city cannot start this building now, or undefined when it can. A city builds
 * one building at a time, each once, while it is calm and no enemy stands at its walls,
 * and only with the people the building needs and the gold it costs.
 */
export function buildRefusal(
  state: DeepReadonly<GameState>,
  city: DeepReadonly<City>,
  building: BuildingKind,
): string | undefined {
  if (!Object.hasOwn(BUILDINGS, building)) return `building ${building} does not exist`;
  const row = BUILDINGS[building];
  if (hasBuilt(city, building)) return `city ${city.id} has a ${building} already`;
  if (city.construction) return `city ${city.id} is building a ${city.construction.building}`;
  if (city.population < row.needs.people) {
    return `a ${building} needs ${row.needs.people} people, but city ${city.id} has ${Math.floor(city.population)}`;
  }
  if (city.unrestDays > 0) return `city ${city.id} is in unrest for ${city.unrestDays} more days`;
  if (beleaguered(state, city)) return `city ${city.id} is under siege`;
  const gold = state.factions[city.owner]?.stores.gold ?? 0;
  if (gold < row.gold) {
    return `a ${building} costs ${row.gold} gold, but ${city.owner} has ${Math.floor(gold)}`;
  }
  return undefined;
}

/** Pays the building's gold now and starts its days of work, which the construction system counts down. */
export function build(state: GameState, order: BuildOrder): string | undefined {
  const city = ownedCity(state, order.faction, order.city);
  if (typeof city === 'string') return city;
  const refusal = buildRefusal(state, city, order.building);
  if (refusal) return refusal;
  const row = BUILDINGS[order.building];
  const stores = state.factions[order.faction]?.stores;
  if (!stores) return `faction ${order.faction} does not exist`;
  stores.gold -= row.gold;
  city.construction = { building: order.building, daysLeft: row.days };
  return undefined;
}

/** The gold that cancelling the city's work gives back. */
export function cancelRefund(building: BuildingKind): number {
  return Math.round(BUILDINGS[building].gold * CANCEL_REFUND);
}

/** Stops the city's work and gives back CANCEL_REFUND of its gold, however far it got. */
export function cancelBuilding(state: GameState, order: CancelBuildingOrder): string | undefined {
  const city = ownedCity(state, order.faction, order.city);
  if (typeof city === 'string') return city;
  if (!city.construction) return `city ${city.id} is building nothing`;
  const stores = state.factions[order.faction]?.stores;
  if (!stores) return `faction ${order.faction} does not exist`;
  stores.gold += cancelRefund(city.construction.building);
  city.construction = null;
  return undefined;
}
