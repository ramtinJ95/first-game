import { defeatFaction } from './defeat.ts';
import type { CityId, FactionId } from './ids.ts';
import type { GameState } from './state/game-state.ts';

/** How long a city that changed owner stays in unrest. Its output recovers evenly over these days. */
export const UNREST_DAYS = 90;

/** The new owner may sack or enslave a fallen city for this many days after the fall. */
export const FATE_DAYS = 10;

/**
 * Sacking takes gold worth this many years of the city's gold output at full at once,
 * kills this share of its people, and sets this unrest.
 */
export const SACK = { wealthYears: 1, populationShare: 0.4, unrestDays: 180 } as const;

/**
 * Enslaving carries off this share of the city's people. This share of the captives
 * becomes manpower at once, and the rest join the owner's capital.
 */
export const ENSLAVE = { populationShare: 0.3, manpowerShare: 0.08, unrestDays: 365 } as const;

/** The longest unrest a city can have: the longest a fate gives. */
export const MAX_UNREST_DAYS = Math.max(UNREST_DAYS, SACK.unrestDays, ENSLAVE.unrestDays);

/**
 * Hands a city and its province to a new owner. The city starts its full period of
 * unrest, and every formation the old owner was raising there is lost without refund.
 * A fate is never open after this alone: the siege that takes a city opens it. An old
 * owner left without a city is out of the game.
 */
export function changeCityOwner(state: GameState, cityId: CityId, owner: FactionId): void {
  const city = Object.hasOwn(state.cities, cityId) ? state.cities[cityId] : undefined;
  if (!city) throw new Error(`city ${cityId} does not exist`);
  if (!Object.hasOwn(state.factions, owner)) throw new Error(`faction ${owner} does not exist`);
  const previous = city.owner;
  city.owner = owner;
  city.unrestDays = UNREST_DAYS;
  city.recruits = [];
  city.fellOn = null;
  if (!Object.values(state.cities).some((other) => other.owner === previous)) {
    defeatFaction(state, previous);
  }
}
