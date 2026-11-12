import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId } from '../sim/ids.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { World } from '../sim/world/world.ts';

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
      refusal: undefined,
    };
  });
  return [occupy, ...tried];
}
