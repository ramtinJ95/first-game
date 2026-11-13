import type { DeepReadonly } from '../deep-readonly.ts';
import type { CityId } from '../ids.ts';
import type { City } from '../state/city.ts';
import type { Stores } from '../state/faction.ts';
import type { GameState } from '../state/game-state.ts';
import { dailyBalances, limitsOf } from '../systems/economy.ts';
import { fullDefences } from '../systems/sieges.ts';
import { BUILDINGS, hasBuilt, type BuildingKind } from './buildings.ts';

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
  /** The owner's cities whose unrest would count down faster: within the temple's reach, without another temple. */
  readonly calmed: readonly CityId[];
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
  const without = withBuildings(
    state,
    city,
    city.buildings.filter((b) => b !== kind),
  );
  const withIt = withBuildings(state, city, [...city.buildings.filter((b) => b !== kind), kind]);
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
    trainingShare: kind === 'barracks' ? BUILDINGS.barracks.trainingShare : 1,
    calmed: kind === 'temple' ? calmedBy(state, city) : [],
  };
}

function withBuildings(
  state: DeepReadonly<GameState>,
  city: DeepReadonly<City>,
  buildings: readonly BuildingKind[],
): DeepReadonly<GameState> {
  return { ...state, cities: { ...state.cities, [city.id]: { ...city, buildings } } };
}

function calmedBy(state: DeepReadonly<GameState>, temple: DeepReadonly<City>): CityId[] {
  const { reachKm } = BUILDINGS.temple;
  const near = (a: DeepReadonly<City>, b: DeepReadonly<City>) =>
    Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) <= reachKm;
  const temples = Object.values(state.cities).filter(
    (other) => other.owner === temple.owner && other.id !== temple.id && hasBuilt(other, 'temple'),
  );
  return Object.values(state.cities)
    .filter(
      (city) =>
        city.owner === temple.owner &&
        near(city, temple) &&
        !temples.some((other) => near(city, other)),
    )
    .map((city) => city.id)
    .sort();
}
