import type { BuildingKind } from '../sim/buildings/buildings.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId } from '../sim/ids.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { City } from '../sim/state/city.ts';
import type { Day } from '../sim/state/day.ts';
import type { Stores } from '../sim/state/faction.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { World } from '../sim/world/world.ts';
import { cityBalance, signed } from '../ui/describe.ts';

/** One way to settle a captured city, with what it gives and costs today. */
export interface FateChoice {
  readonly kind: 'occupy' | 'sack' | 'enslave';
  /** The order that settles it. Occupying is what happens when no order comes. */
  readonly order: Order | undefined;
  readonly gold: number;
  readonly manpower: number;
  /** People the city loses: killed, carried off, or none. */
  readonly peopleLost: number;
  /** Captives who settle in the player's other cities. */
  readonly peopleMoved: number;
  readonly unrestDays: number;
  /** The buildings the city keeps, and those the fate destroys with the one at work. */
  readonly buildingsKept: readonly BuildingKind[];
  readonly buildingsLost: readonly BuildingKind[];
  /**
   * What the city adds to the player's stores each day at first, in the depth of its
   * unrest, by the economy's own balance. It rises to `calm` over the last days of unrest.
   */
  readonly unrest: Stores;
  /** What the city adds each day once its unrest is over, as it stands then. */
  readonly calm: Stores;
  /** Why the rules refuse it today, or undefined. */
  readonly refusal: string | undefined;
}

/**
 * The three fates of a city the player captured, each worked out by playing its order
 * on a copy of the day, so the numbers are the rules' own.
 */
export function fateChoices(
  state: DeepReadonly<GameState>,
  world: World,
  id: CityId,
): FateChoice[] {
  const player = state.player;
  const city = state.cities[id];
  const stores = state.factions[player]?.stores;
  if (!city || !stores) return [];
  const occupy: FateChoice = {
    kind: 'occupy',
    order: undefined,
    gold: 0,
    manpower: 0,
    peopleLost: 0,
    peopleMoved: 0,
    unrestDays: city.unrestDays,
    buildingsKept: city.buildings,
    buildingsLost: [],
    unrest: cityBalance(state, city),
    calm: calmBalance(state, city),
    refusal: undefined,
  };
  const others = (s: DeepReadonly<GameState>) =>
    Object.values(s.cities).reduce(
      (sum, c) => (c.owner === player && c.id !== id ? sum + c.population : sum),
      0,
    );
  const tried = (['sack', 'enslave'] as const).map((kind): FateChoice => {
    const order: Order = { kind, faction: player, city: id };
    const copy = structuredClone(state) as GameState;
    const rejected = executeOrder(copy, order, world);
    const after = copy.cities[id];
    const has = copy.factions[player]?.stores;
    if (rejected || !after || !has) {
      return { ...occupy, kind, order, refusal: rejected?.reason ?? 'the city is gone' };
    }
    return {
      kind,
      order,
      gold: has.gold - stores.gold,
      manpower: has.manpower - stores.manpower,
      peopleLost: city.population - after.population,
      peopleMoved: others(copy) - others(state),
      unrestDays: after.unrestDays,
      buildingsKept: after.buildings,
      buildingsLost: standing(city).filter((kind) => !standing(after).includes(kind)),
      unrest: cityBalance(copy, after),
      calm: calmBalance(copy, after),
      refusal: undefined,
    };
  });
  return [occupy, ...tried];
}

/** The buildings that stand in the city, and the one at work. */
function standing(city: DeepReadonly<City>): BuildingKind[] {
  return [...city.buildings, ...(city.construction ? [city.construction.building] : [])];
}

/**
 * The city's daily yield on the day its unrest ends, by the economy's own balance: the
 * same city on that day with no unrest left, so a sack's poor years still count.
 */
function calmBalance(state: DeepReadonly<GameState>, city: DeepReadonly<City>): Stores {
  const day = (state.day + city.unrestDays) as Day;
  return cityBalance({ ...state, day }, { ...city, unrestDays: 0 });
}

const STORE_ORDER = ['gold', 'food', 'manpower'] as const;

/** A day's yield, such as "+2.1 gold, −0.4 food, +0.3 manpower". */
export function dailyText(daily: Stores): string {
  return STORE_ORDER.map((store) => `${signed(daily[store])} ${store}`).join(', ');
}
