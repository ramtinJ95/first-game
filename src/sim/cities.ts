import type { DeepReadonly } from './deep-readonly.ts';
import { defeatFaction } from './defeat.ts';
import type { CityId, FactionId } from './ids.ts';
import type { GameState } from './state/game-state.ts';
import type { Troop } from './troops.ts';

/** How long a city that changed owner stays in unrest. Its output recovers evenly over these days. */
export const UNREST_DAYS = 90;

/** The new owner may sack or enslave a fallen city for this many days after the fall. */
export const FATE_DAYS = 10;

/**
 * Sacking takes gold worth `wealthYears` of the city's gold output at full at once,
 * kills `populationShare` of its people, and sets `unrestDays` of unrest. For
 * `poorDays` after the sack the city yields only `poorOutput` of its gold. An occupied
 * city out-earns a sacked one within a year.
 */
export const SACK = {
  wealthYears: 0.75,
  populationShare: 0.4,
  unrestDays: 365,
  poorDays: 3 * 365,
  poorOutput: 0.5,
} as const;

/**
 * Enslaving carries off this share of the city's people. This share of the captives
 * becomes manpower at once, and the rest join the owner's capital.
 */
export const ENSLAVE = { populationShare: 0.3, manpowerShare: 0.25, unrestDays: 365 } as const;

/** The longest unrest a city can have: the longest a fate gives. */
export const MAX_UNREST_DAYS = Math.max(UNREST_DAYS, SACK.unrestDays, ENSLAVE.unrestDays);

/**
 * Hands a city and its province to a new owner. The city starts its full period of
 * unrest. A city falls only to a siege, which musters what the city trains, so no
 * recruit is left to lose. A fate is never open after this alone: the siege that takes
 * a city opens it. An old owner left without a city is out of the game.
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

export interface EarlyMuster {
  city: CityId;
  owner: FactionId;
  troops: Troop[];
}

/**
 * The recruits that a siege mustered before their training ended, between one day and
 * the next: each city that kept its owner and lost recruits from training that were not
 * due yet.
 */
export function earlyMusters(
  before: DeepReadonly<GameState>,
  after: DeepReadonly<GameState>,
): EarlyMuster[] {
  const musters: EarlyMuster[] = [];
  for (const city of Object.values(after.cities)) {
    const was = before.cities[city.id];
    if (!was || was.owner !== city.owner) continue;
    const left = [...city.recruits];
    const troops: Troop[] = [];
    for (const recruit of was.recruits) {
      const at = left.findIndex((r) => r.troop === recruit.troop && r.readyOn === recruit.readyOn);
      if (at >= 0) left.splice(at, 1);
      else if (recruit.readyOn > before.day) troops.push(recruit.troop);
    }
    if (troops.length > 0) musters.push({ city: city.id, owner: city.owner, troops });
  }
  return musters;
}
