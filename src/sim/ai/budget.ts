import type { FactionId } from '../ids.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import type { GameState } from '../state/game-state.ts';
import type { World } from '../world/world.ts';
import { goldPerManOf, UPKEEP_PER_MAN } from '../systems/economy.ts';
import { SHARED_TROOPS, TROOPS, troopsFor, type Troop } from '../troops.ts';
import {
  besieged,
  formationsOf,
  menInTraining,
  menUnderArms,
  reserveOf,
  sorted,
  type CityView,
  type State,
  balanceOf,
} from './situation.ts';
import { MIN_BALANCE_SHARE, SIGNATURE_SHARE, TROOP_MIX } from './thresholds.ts';

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
  if (besieged(state, muster)) return [];
  const troop = mostNeeded(state, faction);
  const { men, gold } = TROOPS[troop].recruit;
  const { stores } = record;
  if (stores.manpower < men) return [];
  if (stores.gold - gold < reserveOf(state, faction, 'gold', men)) return [];
  if (stores.food < reserveOf(state, faction, 'food', men)) return [];

  const balance = balanceOf(state, faction);
  if (!balance) return [];
  const armed = menUnderArms(state, faction);
  const after = armed + menInTraining(state, faction) + men;
  for (const store of ['gold', 'food'] as const) {
    const perMan = store === 'gold' ? goldPerManOf(state, faction) : UPKEEP_PER_MAN.food;
    const income = balance[store] + armed * perMan;
    if (income - after * perMan < MIN_BALANCE_SHARE * income) return [];
  }
  return [{ kind: 'recruit', faction, city: muster.id, troop }];
}

/** The share of its men a faction wants in each troop it may raise. */
export function mixFor(faction: FactionId): Map<Troop, number> {
  const mix = new Map<Troop, number>(Object.entries(TROOP_MIX) as [Troop, number][]);
  for (const troop of troopsFor(faction)) {
    const { signature } = TROOPS[troop];
    if (!signature) continue;
    const given = TROOP_MIX[signature.resembles] * SIGNATURE_SHARE;
    mix.set(signature.resembles, (mix.get(signature.resembles) ?? 0) - given);
    mix.set(troop, (mix.get(troop) ?? 0) + given);
  }
  return mix;
}

export function mostNeeded(state: State, faction: FactionId): Troop {
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
  for (const [troop, share] of mixFor(faction)) {
    const gap = share - (total === 0 ? 0 : (men.get(troop) ?? 0) / total);
    if (gap > bestGap) {
      best = troop;
      bestGap = gap;
    }
  }
  return best;
}

/** Trade waits behind the military reserve and the next formation's purchase. */
export function tradeReserve(state: State, faction: FactionId): number {
  const next =
    state.factions[faction]?.kind === 'greatPower'
      ? TROOPS[mostNeeded(state, faction)].recruit.gold
      : Math.min(...SHARED_TROOPS.map((troop) => TROOPS[troop].recruit.gold));
  return Math.max(600, reserveOf(state, faction, 'gold')) + next;
}

/** The same day's already chosen spending must settle before a trade commitment. */
export function afterSpending(state: State, orders: readonly Order[], world: World): State {
  const spending = orders.filter((order) =>
    ['recruit', 'build', 'cancelBuilding', 'study', 'sack', 'enslave', 'acceptPeace'].includes(
      order.kind,
    ),
  );
  if (!spending.length) return state;
  const copy = JSON.parse(JSON.stringify(state)) as GameState;
  for (const order of spending) executeOrder(copy, order, world);
  return copy;
}
