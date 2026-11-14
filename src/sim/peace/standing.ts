import type { DeepReadonly } from '../deep-readonly.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { CityRank } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
import { warKey } from '../state/war.ts';

/** What a city is worth in the reckoning of a war and of a peace, by its rank. */
export const CITY_POINTS: Readonly<Record<CityRank, number>> = {
  capital: 40,
  greatPowerCity: 15,
  minorCity: 10,
};
/** The most the men lost in battle add to either side's standing. */
export const BATTLE_POINTS = 30;
/** Battles that cost both sides fewer men than this together count for less. */
export const BATTLE_SCALE = 2000;
/** A siege under way counts this share of the besieged city's points. */
export const SIEGE_SHARE = 0.5;
/** A standing lies between minus and plus this. */
export const MAX_STANDING = 100;

export interface WarStanding {
  readonly faction: FactionId;
  readonly enemy: FactionId;
  readonly since: number;
  readonly days: number;
  readonly declaredBy: FactionId;
  /** The enemy's cities the faction took in the war and still holds. */
  readonly taken: readonly CityId[];
  /** The faction's cities the enemy took in the war and still holds. */
  readonly lost: readonly CityId[];
  readonly menLost: number;
  readonly enemyMenLost: number;
  /** The enemy's cities that the faction's armies besiege now. */
  readonly besieging: readonly CityId[];
  /** The faction's cities that the enemy's armies besiege now. */
  readonly besieged: readonly CityId[];
  readonly points: { readonly cities: number; readonly battles: number; readonly sieges: number };
  /** Above 0 the faction is winning, below 0 it is losing, from -MAX_STANDING to MAX_STANDING. */
  readonly score: number;
}

/**
 * How the war between the two stands for the first, from what the player can see: the
 * cities each side took and holds, the men each lost in battle, and the sieges under way.
 */
export function warStanding(
  state: DeepReadonly<GameState>,
  faction: FactionId,
  enemy: FactionId,
): WarStanding | undefined {
  if (faction === enemy) return undefined;
  const key = warKey(faction, enemy);
  const war = Object.hasOwn(state.wars, key) ? state.wars[key] : undefined;
  const own = war?.sides[faction];
  const theirs = war?.sides[enemy];
  if (!war || !own || !theirs) return undefined;
  const worth = (id: CityId) => {
    const city = state.cities[id];
    return city ? CITY_POINTS[city.rank] : 0;
  };
  const sum = (ids: readonly CityId[], share = 1) =>
    ids.reduce((total, id) => total + worth(id) * share, 0);
  const besieging: CityId[] = [];
  const besieged: CityId[] = [];
  for (const id of Object.keys(state.sieges).sort()) {
    const siege = state.sieges[id as keyof typeof state.sieges];
    const city = siege && state.cities[siege.city];
    if (!siege || !city) continue;
    const by = new Set(siege.besiegers.map((army) => state.armies[army]?.owner));
    if (city.owner === enemy && by.has(faction)) besieging.push(city.id);
    if (city.owner === faction && by.has(enemy)) besieged.push(city.id);
  }
  const cities = sum(own.taken) - sum(theirs.taken);
  const sieges = sum(besieging, SIEGE_SHARE) - sum(besieged, SIEGE_SHARE);
  const battles =
    (BATTLE_POINTS * (theirs.lost - own.lost)) / Math.max(BATTLE_SCALE, theirs.lost + own.lost);
  const score = Math.round(
    Math.max(-MAX_STANDING, Math.min(MAX_STANDING, cities + sieges + battles)),
  );
  return {
    faction,
    enemy,
    since: war.since,
    days: state.day - war.since,
    declaredBy: war.declaredBy,
    taken: [...own.taken],
    lost: [...theirs.taken],
    menLost: own.lost,
    enemyMenLost: theirs.lost,
    besieging,
    besieged,
    points: { cities, battles: Math.round(battles), sieges },
    score,
  };
}
