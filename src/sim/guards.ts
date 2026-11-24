import type { DeepReadonly } from './deep-readonly.ts';
import type { CityId, FactionId } from './ids.ts';
import { ownedCity } from './orders/owned-city.ts';
import type { City, GuardBand } from './state/city.ts';
import type { Day } from './state/day.ts';
import type { GameState } from './state/game-state.ts';
import { beleaguered, CITY_DEFENCES } from './systems/sieges.ts';

/** Men a city hires at one order. */
export const GUARD_BAND = 500;
/** Gold paid at the order for one band's term. Guards cost no manpower, food, or upkeep. */
export const GUARD_GOLD = 2000;
/** Days a band serves before it leaves, so the choice to hire comes back each year. */
export const GUARD_DAYS = 365;
/**
 * Days from its hire that a great power counts a band against a war on the city's owner.
 * After that it reckons on the hirelings leaving, so guards held year after year buy no
 * lasting peace, while the band still holds the walls for its whole term.
 */
export const GUARD_DETER_DAYS = 90;

export interface HireGuardsOrder {
  kind: 'hireGuards';
  faction: FactionId;
  city: CityId;
}

/** The men the city's bands of guards hold its walls with. */
export function guardMen(city: DeepReadonly<Pick<City, 'guards'>>): number {
  return city.guards.length * GUARD_BAND;
}

/** The first day a great power no longer counts the band against a war. */
export function deterrentUntil(band: DeepReadonly<GuardBand>): Day {
  return (band.until - GUARD_DAYS + GUARD_DETER_DAYS) as Day;
}

/** The garrison a great power weighs before it declares: the guards past GUARD_DETER_DAYS left out. */
export function weighedGarrison(
  city: DeepReadonly<Pick<City, 'garrison' | 'guards'>>,
  day: Day,
): number {
  const stale = city.guards.filter((band) => deterrentUntil(band) <= day).length;
  return Math.max(0, city.garrison - stale * GUARD_BAND);
}

/** The most guards a city holds, in men: its rank's full garrison, so a capital holds 3,000. */
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
  if (guardMen(city) + GUARD_BAND > guardLimit(city) && replaced(city, state.day) < 0) {
    return `${city.id} holds ${guardMen(city)} guards, and ${guardLimit(city)} is the most it can`;
  }
  const gold = state.factions[faction]?.stores.gold ?? 0;
  if (gold < GUARD_GOLD) {
    return `${GUARD_BAND} guards cost ${GUARD_GOLD} gold, but ${faction} has ${Math.floor(gold)}`;
  }
  return undefined;
}

/** Pays for a band's year and puts it on the walls at once, raising the garrison and the full garrison. */
export function hireGuards(state: GameState, order: HireGuardsOrder): string | undefined {
  const city = ownedCity(state, order.faction, order.city);
  if (typeof city === 'string') return city;
  const refusal = guardRefusal(state, city, order.faction);
  if (refusal) return refusal;
  const stores = state.factions[order.faction]?.stores;
  if (!stores) return `faction ${order.faction} does not exist`;
  stores.gold -= GUARD_GOLD;
  const old = guardMen(city) + GUARD_BAND > guardLimit(city) ? replaced(city, state.day) : -1;
  if (old >= 0) city.guards.splice(old, 1);
  else city.garrison += GUARD_BAND;
  city.guards.push({ until: (state.day + GUARD_DAYS) as Day });
  return undefined;
}

/**
 * The band a hire at a city full of guards sends home: the one hired first of those great
 * powers no longer count against a war, or -1 for none. Its place goes to the new band, so a
 * warning can still be answered with gold at a city whose guards were hired for an older one.
 */
export function replaced(city: DeepReadonly<Pick<City, 'guards'>>, day: Day): number {
  let oldest = -1;
  city.guards.forEach((band, i) => {
    if (deterrentUntil(band) > day) return;
    if (oldest < 0 || band.until < (city.guards[oldest]?.until ?? Infinity)) oldest = i;
  });
  return oldest;
}
