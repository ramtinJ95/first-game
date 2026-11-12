import type { FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import { UPKEEP_PER_MAN } from '../systems/economy.ts';
import { TROOPS, type Troop } from '../troops.ts';
import {
  formationsOf,
  menInTraining,
  menUnderArms,
  reserveOf,
  sorted,
  type CityView,
  type State,
  balanceOf,
} from './situation.ts';
import { MIN_BALANCE_SHARE, TROOP_MIX } from './thresholds.ts';

/**
 * Raises at most one formation a day at the muster city. The troop is the one furthest
 * below its TROOP_MIX share of the faction's men, counting recruits in training, and the
 * power waits for it rather than buying another. It recruits only when, after paying,
 * gold and food stay above the reserve for the new upkeep, and the daily balance of gold
 * and food after the upkeep of all its men and recruits stays at least
 * MIN_BALANCE_SHARE of the income.
 */
export function recruitment(
  state: State,
  faction: FactionId,
  muster: CityView | undefined,
): Order[] {
  const record = state.factions[faction];
  if (!record || !muster || muster.owner !== faction || muster.unrestDays > 0) return [];
  const troop = mostNeeded(state, faction);
  const { men, gold } = TROOPS[troop].recruit;
  const { stores } = record;
  if (stores.manpower < men) return [];
  const reserve = reserveOf(state, faction, men);
  if (stores.gold - gold < reserve || stores.food < reserve) return [];

  const balance = balanceOf(state, faction);
  if (!balance) return [];
  const upkeepNow = menUnderArms(state, faction) * UPKEEP_PER_MAN.gold;
  const upkeepAfter =
    (menUnderArms(state, faction) + menInTraining(state, faction) + men) * UPKEEP_PER_MAN.gold;
  for (const store of ['gold', 'food'] as const) {
    const income = balance[store] + upkeepNow;
    if (income - upkeepAfter < MIN_BALANCE_SHARE * income) return [];
  }
  return [{ kind: 'recruit', faction, city: muster.id, troop }];
}

function mostNeeded(state: State, faction: FactionId): Troop {
  const men = new Map<Troop, number>();
  let total = 0;
  const add = (troop: Troop, count: number) => {
    men.set(troop, (men.get(troop) ?? 0) + count);
    total += count;
  };
  for (const army of sorted(state.armies)) {
    if (army.owner !== faction) continue;
    for (const formation of formationsOf(state, army)) add(formation.troop, formation.men);
  }
  for (const city of sorted(state.cities)) {
    if (city.owner !== faction) continue;
    for (const recruit of city.recruits) add(recruit.troop, TROOPS[recruit.troop].recruit.men);
  }
  let best: Troop = 'spearmen';
  let bestGap = Number.NEGATIVE_INFINITY;
  for (const troop of Object.keys(TROOP_MIX) as Troop[]) {
    const gap = TROOP_MIX[troop] - (total === 0 ? 0 : (men.get(troop) ?? 0) / total);
    if (gap > bestGap) {
      best = troop;
      bestGap = gap;
    }
  }
  return best;
}
