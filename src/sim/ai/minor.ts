import type { Order } from '../orders/orders.ts';
import { RALLY_DISTANCE, UPKEEP_PER_MAN } from '../systems/economy.ts';
import { TROOPS, type Troop } from '../troops.ts';
import { distance } from '../world/find-path.ts';
import { endOverlongMarches, retreats, type Context } from './armies.ts';
import type { FactionId } from '../ids.ts';
import { balanceOf, besieged, enemiesOf, meanMorale, menInTraining, sorted } from './situation.ts';
import { MARCH_MORALE, MINOR_DEFICIT_DAYS } from './thresholds.ts';

const CHEAPEST: Troop = (Object.keys(TROOPS) as Troop[]).reduce((a, b) =>
  TROOPS[b].recruit.gold < TROOPS[a].recruit.gold ? b : a,
);

/** The faction's league partner while it is still in the game. */
function partnerOf({ state, faction }: Context): FactionId | undefined {
  const partner = state.factions[faction]?.league;
  return partner && state.factions[partner]?.defeatedOn === null ? partner : undefined;
}

/** A war on the faction's league partner that the faction has not joined yet, lowest id first. */
function leagueWar(context: Context): Order[] {
  const { state, faction, enemies } = context;
  const partner = partnerOf(context);
  if (!partner) return [];
  const [against] = [...enemiesOf(state, partner)]
    .filter((enemy) => enemy !== faction && !enemies.has(enemy))
    .sort();
  return against ? [{ kind: 'declareWar', faction, against }] : [];
}

/**
 * A minor declares war only to join a war on its league partner. At war, it defends its city: it raises its cheapest troop
 * whenever its gold covers the cost, and its gold and food each cover MINOR_DEFICIT_DAYS
 * of the deficit the new upkeep would leave, keeps its armies at the city so that they fight anyone who besieges it,
 * once their morale is back to MARCH_MORALE, or at its partner's city while that is besieged and its own is not, and retreats from a battle it is losing.
 */
export function minorOrders(context: Context): Order[] {
  const { state, router, faction, enemies } = context;
  const joining = leagueWar(context);
  if (enemies.size === 0) return [...endOverlongMarches(context), ...joining];
  const orders = [...endOverlongMarches(context), ...joining, ...retreats(context)];
  const [home] = sorted(state.cities).filter((city) => city.owner === faction);
  if (!home) return orders;
  const partner = partnerOf(context);
  const [ally] = partner ? sorted(state.cities).filter((city) => city.owner === partner) : [];
  const post = ally && besieged(state, ally) && !besieged(state, home) ? ally : home;

  for (const army of sorted(state.armies)) {
    if (army.owner !== faction || army.activity.kind !== 'idle') continue;
    if (meanMorale(state, army) < MARCH_MORALE) continue;
    const at = army.activity.position;
    if (distance(at, post.position) > RALLY_DISTANCE && router.marches(at, post.position)) {
      orders.push({ kind: 'moveArmy', faction, army: army.id, to: post.position });
    }
  }

  const stores = state.factions[faction]?.stores;
  const balance = balanceOf(state, faction);
  if (!stores || !balance || home.unrestDays > 0 || besieged(state, home)) return orders;
  const { men, gold } = TROOPS[CHEAPEST].recruit;
  const extra = menInTraining(state, faction) + men;
  const covers = (store: 'gold' | 'food', cost: number) =>
    stores[store] >=
    cost + Math.max(0, extra * UPKEEP_PER_MAN[store] - balance[store]) * MINOR_DEFICIT_DAYS;
  if (stores.manpower >= men && covers('gold', gold) && covers('food', 0)) {
    orders.push({ kind: 'recruit', faction, city: home.id, troop: CHEAPEST });
  }
  return orders;
}
