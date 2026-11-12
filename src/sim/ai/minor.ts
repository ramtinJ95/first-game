import type { Order } from '../orders/orders.ts';
import { RALLY_DISTANCE, UPKEEP_PER_MAN } from '../systems/economy.ts';
import { TROOPS, type Troop } from '../troops.ts';
import { distance } from '../world/find-path.ts';
import { retreats, type Context } from './armies.ts';
import { balanceOf, byLand, meanMorale, menInTraining, sorted } from './situation.ts';
import { MARCH_MORALE, MINOR_DEFICIT_DAYS } from './thresholds.ts';

const CHEAPEST: Troop = (Object.keys(TROOPS) as Troop[]).reduce((a, b) =>
  TROOPS[b].recruit.gold < TROOPS[a].recruit.gold ? b : a,
);

/**
 * A minor never declares war. At war, it defends its city: it raises its cheapest troop
 * whenever its gold covers the cost, and its gold and food each cover MINOR_DEFICIT_DAYS
 * of the deficit the new upkeep would leave, keeps its armies at the city so that they fight anyone who besieges it,
 * once their morale is back to MARCH_MORALE, and retreats from a battle it is losing.
 */
export function minorOrders(context: Context): Order[] {
  const { state, world, faction, enemies } = context;
  if (enemies.size === 0) return [];
  const orders = retreats(context);
  const [home] = sorted(state.cities).filter((city) => city.owner === faction);
  if (!home) return orders;

  for (const army of sorted(state.armies)) {
    if (army.owner !== faction || army.activity.kind !== 'idle') continue;
    if (meanMorale(state, army) < MARCH_MORALE) continue;
    const at = army.activity.position;
    if (distance(at, home.position) > RALLY_DISTANCE && byLand(world, at, home.position)) {
      orders.push({ kind: 'moveArmy', faction, army: army.id, to: home.position });
    }
  }

  const stores = state.factions[faction]?.stores;
  const balance = balanceOf(state, faction);
  if (!stores || !balance || home.unrestDays > 0) return orders;
  const { men, gold } = TROOPS[CHEAPEST].recruit;
  const upkeep = (menInTraining(state, faction) + men) * UPKEEP_PER_MAN.gold;
  const covers = (store: 'gold' | 'food', cost: number) =>
    stores[store] >= cost + Math.max(0, upkeep - balance[store]) * MINOR_DEFICIT_DAYS;
  if (stores.manpower >= men && covers('gold', gold) && covers('food', 0)) {
    orders.push({ kind: 'recruit', faction, city: home.id, troop: CHEAPEST });
  }
  return orders;
}
