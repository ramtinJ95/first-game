import { ADVANCE_KINDS, ADVANCES, type AdvanceKind } from '../advances/advances.ts';
import { advanceGain } from '../advances/gains.ts';
import { studyRefusal } from '../advances/study.ts';
import type { FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import { UPKEEP_PER_MAN } from '../systems/economy.ts';
import { TROOPS } from '../troops.ts';
import { mostNeeded } from './budget.ts';
import { FOOD_MARGIN_MEN, FOOD_PRICE, MANPOWER_PRICE } from './build.ts';
import { balanceOf, reserveOf, type State } from './situation.ts';

/** A realm studies only an advance that pays its gold back within this many years. */
export const STUDY_PAYBACK_YEARS = 6;

const CHEAPEST = Math.min(...ADVANCE_KINDS.map((kind) => ADVANCES[kind].gold));

/**
 * What an advance is worth to the realm in gold a day, priced as a building is: gold as it
 * is, manpower at MANPOWER_PRICE, and food at FOOD_PRICE while the realm's harvest feeds
 * fewer than FOOD_MARGIN_MEN more men.
 */
export function advanceWorth(state: State, faction: FactionId, kind: AdvanceKind): number {
  const { gold, food, manpower } = advanceGain(state, faction, kind).daily;
  const fed = (balanceOf(state, faction)?.food ?? 0) / UPKEEP_PER_MAN.food;
  return gold + (fed < FOOD_MARGIN_MEN ? food * FOOD_PRICE : 0) + manpower * MANPOWER_PRICE;
}

/** The years an advance takes to pay back its gold in the realm today, or undefined if never. */
export function studyPayback(state: State, faction: FactionId, kind: AdvanceKind) {
  const worth = advanceWorth(state, faction, kind);
  return worth > 0 ? ADVANCES[kind].gold / worth / 365 : undefined;
}

/**
 * The advance the realm would do best to study today: of those it can start, the one that
 * pays back its gold soonest, if within STUDY_PAYBACK_YEARS, the first in the table on a tie.
 * `spare` is the gold the realm may spend on it.
 */
export function bestStudy(
  state: State,
  faction: FactionId,
  spare: number,
): { advance: AdvanceKind; payback: number } | undefined {
  let best: { advance: AdvanceKind; payback: number } | undefined;
  if (spare < CHEAPEST) return undefined;
  for (const advance of ADVANCE_KINDS) {
    if (ADVANCES[advance].gold > spare || studyRefusal(state, faction, advance)) continue;
    const payback = studyPayback(state, faction, advance);
    if (payback === undefined || payback > STUDY_PAYBACK_YEARS) continue;
    if (!best || payback < best.payback) best = { advance, payback };
  }
  return best;
}

/**
 * Starts at most one advance, on a day the power raised no recruit and started no building:
 * the one that pays back soonest (`bestStudy`), with gold left over the reserve for its men
 * and the price of the recruit it would raise next, so study never stops it keeping or
 * growing an army.
 */
export function studies(state: State, faction: FactionId, busy: boolean): Order[] {
  const record = state.factions[faction];
  if (!record || busy || record.study || record.kind !== 'greatPower') return [];
  const next = TROOPS[mostNeeded(state, faction)].recruit.gold;
  const spare = record.stores.gold - reserveOf(state, faction, 'gold') - next;
  const best = bestStudy(state, faction, spare);
  return best ? [{ kind: 'study', faction, advance: best.advance }] : [];
}
