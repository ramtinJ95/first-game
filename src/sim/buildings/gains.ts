import type { DeepReadonly } from '../deep-readonly.ts';
import type { CityId } from '../ids.ts';
import type { City } from '../state/city.ts';
import type { Stores } from '../state/faction.ts';
import type { GameState } from '../state/game-state.ts';
import { dailyBalances, limitsOf } from '../systems/economy.ts';
import { fullDefences } from '../systems/sieges.ts';
import {
  BUILDINGS,
  extraSlotsOf,
  templeReachOf,
  tradeShareOf,
  type BuildingKind,
} from './buildings.ts';

/** What one building would change for its city's owner, by the rules as they stand today. */
export interface BuildingGain {
  /** The owner's daily gold, food, and manpower. */
  readonly daily: Stores;
  /** The men more the owner's realm could call up. */
  readonly levy: number;
  /** The city's full walls and garrison. */
  readonly walls: number;
  readonly garrison: number;
  /** The share of its days a recruit trains in the city. */
  readonly trainingShare: number;
  /** The owner's cities whose unrest would count down faster: within the temple's new reach, which no temple reached before. */
  readonly calmed: readonly CityId[];
  /** How far the city's temple would reach, in km, when the buildings change it. */
  readonly reachKm: number | undefined;
  /** The route slots more the city would hold. */
  readonly slots: number;
  /** The share more its end of each route would earn. */
  readonly tradeShare: number;
}

/**
 * Plays the city with and without the building through the rules' own sums, so a panel,
 * the AI, and a script read the same numbers the economy and the sieges use.
 */
export function buildingGain(
  state: DeepReadonly<GameState>,
  city: DeepReadonly<City>,
  kind: BuildingKind,
): BuildingGain {
  return gainOf(state, city, [kind]);
}

/** What the buildings together change for the city's owner, such as a first level and its second. */
export function gainOf(
  state: DeepReadonly<GameState>,
  city: DeepReadonly<City>,
  kinds: readonly BuildingKind[],
): BuildingGain {
  const realm = realmOf(state, city);
  const rest = city.buildings.filter((b) => !kinds.includes(b));
  const without = withBuildings(realm, city, rest);
  const withIt = withBuildings(realm, city, [...rest, ...kinds]);
  const changesReach = kinds.includes('temple') || kinds.includes('sanctuary');
  const beforeCity = without.cities[city.id] ?? city;
  const afterCity = withIt.cities[city.id] ?? city;
  const before = dailyBalances(without).get(city.owner) ?? { gold: 0, food: 0, manpower: 0 };
  const after = dailyBalances(withIt).get(city.owner) ?? { gold: 0, food: 0, manpower: 0 };
  const levyBefore = limitsOf(without).get(city.owner)?.manpower ?? 0;
  const levyAfter = limitsOf(withIt).get(city.owner)?.manpower ?? 0;
  const fullBefore = fullDefences(without.cities[city.id] ?? city);
  const fullAfter = fullDefences(withIt.cities[city.id] ?? city);
  return {
    daily: {
      gold: after.gold - before.gold,
      food: after.food - before.food,
      manpower: after.manpower - before.manpower,
    },
    levy: levyAfter - levyBefore,
    walls: fullAfter.walls - fullBefore.walls,
    garrison: fullAfter.garrison - fullBefore.garrison,
    trainingShare: kinds.includes('barracks') ? BUILDINGS.barracks.trainingShare : 1,
    calmed: changesReach
      ? calmedBy(realm, without.cities[city.id] ?? city, withIt.cities[city.id] ?? city)
      : [],
    reachKm: changesReach ? templeReachOf(withIt.cities[city.id] ?? city) : undefined,
    slots: extraSlotsOf(afterCity) - extraSlotsOf(beforeCity),
    tradeShare: tradeShareOf(afterCity) - tradeShareOf(beforeCity),
  };
}

/**
 * The owner's cities alone, with no armies. A building changes its owner's sums by the
 * same amount without the rest of the world, and the realm's size, which sets the share
 * each city yields, stays the same.
 */
function realmOf(
  state: DeepReadonly<GameState>,
  city: DeepReadonly<City>,
): DeepReadonly<GameState> {
  const cities: Record<string, DeepReadonly<City>> = {};
  for (const other of Object.values(state.cities)) {
    if (other.owner === city.owner) cities[other.id] = other;
  }
  return { ...state, cities: cities as DeepReadonly<GameState>['cities'], armies: {} };
}

function withBuildings(
  state: DeepReadonly<GameState>,
  city: DeepReadonly<City>,
  buildings: readonly BuildingKind[],
): DeepReadonly<GameState> {
  return { ...state, cities: { ...state.cities, [city.id]: { ...city, buildings } } };
}

function calmedBy(
  state: DeepReadonly<GameState>,
  before: DeepReadonly<City>,
  after: DeepReadonly<City>,
): CityId[] {
  const reaches = (temple: DeepReadonly<City>, city: DeepReadonly<City>) =>
    templeReachOf(temple) > 0 &&
    Math.hypot(temple.position.x - city.position.x, temple.position.y - city.position.y) <=
      templeReachOf(temple);
  const temples = Object.values(state.cities).filter(
    (other) => other.owner === before.owner && other.id !== before.id,
  );
  return Object.values(state.cities)
    .filter(
      (city) =>
        city.owner === before.owner &&
        reaches(after, city) &&
        !reaches(before, city) &&
        !temples.some((other) => reaches(other, city)),
    )
    .map((city) => city.id)
    .sort();
}
