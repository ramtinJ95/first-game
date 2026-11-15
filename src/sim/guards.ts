import type { DeepReadonly } from './deep-readonly.ts';
import type { CityId, FactionId } from './ids.ts';
import { ownedCity } from './orders/owned-city.ts';
import type { City } from './state/city.ts';
import type { GameState } from './state/game-state.ts';
import { beleaguered, CITY_DEFENCES, fullDefences } from './systems/sieges.ts';

/** Men a city hires, or lets go, at one order. */
export const GUARD_BAND = 500;
/** Gold paid at the order for one band. Guards cost no manpower. */
export const GUARD_GOLD = 1500;
/** Gold each guard costs his city's owner each day, twice a soldier's. Guards eat no food. */
export const GUARD_UPKEEP = 0.02;

export interface HireGuardsOrder {
  kind: 'hireGuards';
  faction: FactionId;
  city: CityId;
}

export interface DismissGuardsOrder {
  kind: 'dismissGuards';
  faction: FactionId;
  city: CityId;
}

/** The most guards a city holds: its rank's full garrison, so a capital holds 3,000. */
export function guardLimit(city: DeepReadonly<Pick<City, 'rank'>>): number {
  return CITY_DEFENCES[city.rank].garrison;
}

/**
 * Why the faction cannot hire a band of guards in the city now, or undefined when it can.
 * Only the owner hires, in a calm city with no enemy at its walls and room for the band,
 * and only with the gold the band costs.
 */
export function guardRefusal(
  state: DeepReadonly<GameState>,
  city: DeepReadonly<City>,
  faction: FactionId,
): string | undefined {
  if (city.owner !== faction) return `${city.id} belongs to ${city.owner}, not ${faction}`;
  if (city.unrestDays > 0) return `${city.id} is in unrest for ${city.unrestDays} more days`;
  if (beleaguered(state, city)) return `an enemy stands at the walls of ${city.id}`;
  if (city.guards + GUARD_BAND > guardLimit(city)) {
    return `${city.id} holds ${city.guards} guards, and ${guardLimit(city)} is the most it can`;
  }
  const gold = state.factions[faction]?.stores.gold ?? 0;
  if (gold < GUARD_GOLD) {
    return `${GUARD_BAND} guards cost ${GUARD_GOLD} gold, but ${faction} has ${Math.floor(gold)}`;
  }
  return undefined;
}

/** Why the faction cannot let guards go in the city, or undefined when it can. */
export function dismissRefusal(city: DeepReadonly<City>, faction: FactionId): string | undefined {
  if (city.owner !== faction) return `${city.id} belongs to ${city.owner}, not ${faction}`;
  if (city.guards === 0) return `${city.id} holds no guards`;
  return undefined;
}

/** The guards one dismissal lets go: a band, or what is left after unpaid guards walked off. */
export function dismissedGuards(city: DeepReadonly<City>): number {
  return Math.min(GUARD_BAND, city.guards);
}

/** Pays for a band and puts it on the walls at once, raising the garrison and the full garrison. */
export function hireGuards(state: GameState, order: HireGuardsOrder): string | undefined {
  const city = ownedCity(state, order.faction, order.city);
  if (typeof city === 'string') return city;
  const refusal = guardRefusal(state, city, order.faction);
  if (refusal) return refusal;
  const stores = state.factions[order.faction]?.stores;
  if (!stores) return `faction ${order.faction} does not exist`;
  stores.gold -= GUARD_GOLD;
  city.guards += GUARD_BAND;
  city.garrison += GUARD_BAND;
  return undefined;
}

/** Lets a band go, with no gold back, and the garrison shrinks to the new full garrison. */
export function dismissGuards(state: GameState, order: DismissGuardsOrder): string | undefined {
  const city = ownedCity(state, order.faction, order.city);
  if (typeof city === 'string') return city;
  const refusal = dismissRefusal(city, order.faction);
  if (refusal) return refusal;
  loseGuards(city, dismissedGuards(city));
  return undefined;
}

/** Takes guards off the city, and the garrison with them where it stood above the new full garrison. */
export function loseGuards(city: City, guards: number): void {
  city.guards -= guards;
  city.garrison = Math.min(city.garrison, fullDefences(city).garrison);
}
