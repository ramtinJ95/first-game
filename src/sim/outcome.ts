import type { DeepReadonly } from './deep-readonly.ts';
import type { CityId, FactionId } from './ids.ts';
import type { Day } from './state/day.ts';
import type { GameState } from './state/game-state.ts';
import type { World } from './world/world.ts';

/**
 * A great power wins when it holds this share of all provinces and this many of the
 * great capitals, its own among them. With 80 provinces that is 32 provinces and its
 * own capital and two others. The AI powers settle at 16 to 18 cities each.
 */
export const VICTORY = { provinceShare: 0.4, greatCapitals: 3 } as const;

/** How far a faction stands from victory. */
export interface Standing {
  readonly provinces: number;
  readonly provincesNeeded: number;
  /** The great capitals it holds, its own included, in id order. */
  readonly capitals: readonly CityId[];
  readonly capitalsNeeded: number;
  /** Its own capital from the map, or undefined for a minor. */
  readonly home: CityId | undefined;
  readonly holdsHome: boolean;
}

export type Outcome =
  | { readonly kind: 'playing' }
  | { readonly kind: 'won' }
  | { readonly kind: 'lost'; readonly on: Day };

type State = DeepReadonly<GameState>;

export function standingOf(state: State, world: World, faction: FactionId): Standing {
  const cities = Object.values(state.cities);
  const all = Object.keys(state.provinces).length;
  const home = world.map.provinces.find(
    (province) => province.capital && (province.owner as string) === faction,
  )?.id as string as CityId | undefined;
  return {
    provinces: Object.values(state.provinces).filter(
      (province) => state.cities[province.city]?.owner === faction,
    ).length,
    provincesNeeded: Math.ceil(all * VICTORY.provinceShare),
    capitals: cities
      .filter((city) => city.rank === 'capital' && city.owner === faction)
      .map((city) => city.id)
      .sort(),
    capitalsNeeded: VICTORY.greatCapitals,
    home,
    holdsHome: home !== undefined && state.cities[home]?.owner === faction,
  };
}

/**
 * A faction has lost once it holds no city, which `defeatFaction` marks with the day.
 * It has won while it holds the share of provinces and the great capitals of
 * `VICTORY`, its own capital among them.
 */
export function outcomeOf(state: State, world: World, faction: FactionId): Outcome {
  const on = state.factions[faction]?.defeatedOn;
  if (on !== null && on !== undefined) return { kind: 'lost', on };
  const standing = standingOf(state, world, faction);
  const won =
    standing.holdsHome &&
    standing.provinces >= standing.provincesNeeded &&
    standing.capitals.length >= standing.capitalsNeeded;
  return won ? { kind: 'won' } : { kind: 'playing' };
}
