import {
  ADVANCE_KINDS,
  ADVANCES,
  generalSkillOf,
  hasStudied,
  type AdvanceKind,
} from '../advances/advances.ts';
import { UNREST_DAYS } from '../cities.ts';
import { GUARD_DAYS, GUARD_GOLD } from '../guards.ts';
import { GENERAL_EFFECT } from '../systems/battles.ts';
import { fullDefences, WALL_WEAR_PER_THOUSAND_MEN } from '../systems/sieges.ts';
import { advanceGain } from '../advances/gains.ts';
import { studyPrice, studyRefusal } from '../advances/study.ts';
import type { FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import {
  foodPerManOf,
  menOf,
  OUTPUT_PER_PERSON,
  UNREST_OUTPUT,
  UPKEEP_PER_MAN,
} from '../systems/economy.ts';
import { TROOPS } from '../troops.ts';
import { mostNeeded } from './budget.ts';
import {
  CONQUESTS_A_YEAR,
  FOOD_MARGIN_MEN,
  FOOD_PRICE,
  MANPOWER_PRICE,
  nearestForeign,
  nextBuilding,
} from './build.ts';
import { balanceOf, reserveOf, sorted, type CityView, type State } from './situation.ts';
import { GARRISON_ODDS } from './thresholds.ts';

/** A realm studies only an advance that pays its gold back within this many years. */
export const STUDY_PAYBACK_YEARS = 6;

const CHEAPEST = Math.min(...ADVANCE_KINDS.map((kind) => ADVANCES[kind].gold));

/**
 * What an advance is worth to the realm in gold a day, priced as a building is: gold as it
 * is, manpower at MANPOWER_PRICE, and food at FOOD_PRICE while the realm's harvest feeds
 * fewer than FOOD_MARGIN_MEN more men. Drillmasters are worth the upkeep of the men their
 * harder blows stand for. Siege engineers are worth the besiegers' upkeep over the days
 * they save in CONQUESTS_A_YEAR sieges of a city like the nearest foreign one, blockaded
 * at GARRISON_ODDS and walled at its full walls, and Clemency the output it saves in as
 * many conquests of it, as a temple is. Long contracts are worth the gold the realm's
 * bands would save if hired again on the longer term.
 */
export function advanceWorth(state: State, faction: FactionId, kind: AdvanceKind): number {
  const { gold, food, manpower } = advanceGain(state, faction, kind).daily;
  const fed = (balanceOf(state, faction)?.food ?? 0) / UPKEEP_PER_MAN.food;
  const manDay = UPKEEP_PER_MAN.gold + foodPerManOf(state, faction) * FOOD_PRICE;
  let worth = gold + (fed < FOOD_MARGIN_MEN ? food * FOOD_PRICE : 0) + manpower * MANPOWER_PRICE;
  if (kind === 'drillmasters') worth += sharperMen(state, faction) * manDay;
  if (kind === 'siegeEngineers' || kind === 'clemency') {
    const target = nearestTarget(state, faction);
    if (target && kind === 'siegeEngineers') {
      const men = GARRISON_ODDS * fullDefences(target).garrison;
      const days = fullDefences(target).walls / ((men / 1000) * WALL_WEAR_PER_THOUSAND_MEN);
      const saved = days * (1 - 1 / ADVANCES.siegeEngineers.wallWearShare);
      worth += (CONQUESTS_A_YEAR / 365) * saved * men * manDay;
    }
    if (target && kind === 'clemency') {
      const output =
        target.population * (OUTPUT_PER_PERSON.gold + OUTPUT_PER_PERSON.manpower * MANPOWER_PRICE);
      const saved = ((1 - UNREST_OUTPUT) / 2) * UNREST_DAYS * (1 - ADVANCES.clemency.unrestShare);
      worth += (CONQUESTS_A_YEAR / 365) * saved * output;
    }
  }
  if (kind === 'longContracts') {
    const bands = sorted(state.cities)
      .filter((city) => city.owner === faction)
      .reduce((sum, city) => sum + city.guards.length, 0);
    worth += bands * (GUARD_GOLD / GUARD_DAYS) * (1 - 1 / ADVANCES.longContracts.guardShare);
  }
  return worth;
}

/** The men more that the realm's armies would strike as, with their generals raised by Drillmasters. */
export function sharperMen(state: State, faction: FactionId): number {
  const record = state.factions[faction];
  if (!record || hasStudied(record, 'drillmasters')) return 0;
  const learned = { advances: [...record.advances, 'drillmasters' as const] };
  let men = 0;
  for (const army of sorted(state.armies)) {
    if (army.owner !== faction) continue;
    const factor = (skill: number) => 1 + GENERAL_EFFECT * skill;
    const raised = factor(generalSkillOf(learned, army.generalSkill)) / factor(army.generalSkill);
    men += menOf(state, army) * (raised - 1);
  }
  return men;
}

/** The foreign city nearest any of the realm's cities, the one its conquests are priced by. */
export function nearestTarget(state: State, faction: FactionId): CityView | undefined {
  let best: { city: CityView; km: number } | undefined;
  for (const city of sorted(state.cities)) {
    if (city.owner !== faction) continue;
    const other = nearestForeign(state, city, best?.km ?? Infinity, true);
    if (!other) continue;
    const km = Math.hypot(other.position.x - city.position.x, other.position.y - city.position.y);
    if (!best || km < best.km) best = { city: other, km };
  }
  return best?.city;
}

/** The years an advance takes to pay back the price the realm pays today, or undefined if never. */
export function studyPayback(state: State, faction: FactionId, kind: AdvanceKind) {
  const worth = advanceWorth(state, faction, kind);
  return worth > 0 ? studyPrice(state, faction, kind) / worth / 365 : undefined;
}

/**
 * The advance the realm would do best to study today: of those it can start, the one that
 * pays back its gold soonest, if within `years` (STUDY_PAYBACK_YEARS unless given), the first
 * in the table on a tie. `spare` is the gold the realm may spend on it.
 */
export function bestStudy(
  state: State,
  faction: FactionId,
  spare: number,
  years = STUDY_PAYBACK_YEARS,
): { advance: AdvanceKind; payback: number } | undefined {
  let best: { advance: AdvanceKind; payback: number } | undefined;
  if (spare < CHEAPEST) return undefined;
  for (const advance of ADVANCE_KINDS) {
    if (studyPrice(state, faction, advance) > spare || studyRefusal(state, faction, advance))
      continue;
    const payback = studyPayback(state, faction, advance);
    if (payback === undefined || payback > Math.min(years, STUDY_PAYBACK_YEARS)) continue;
    if (!best || payback < best.payback) best = { advance, payback };
  }
  return best;
}

/**
 * Starts at most one advance, on a day the power raised no recruit and started no building:
 * the one that pays back soonest (`bestStudy`), with gold left over the reserve for its men
 * and the price of the recruit it would raise next, so study never stops it keeping or
 * growing an army. It studies only an advance that pays back no later than the building it
 * would start next with gold enough (`nextBuilding`), so an advance never puts off a building
 * that would pay sooner, as slow advances bought on days a building was out of reach did.
 */
export function studies(state: State, faction: FactionId, busy: boolean): Order[] {
  const record = state.factions[faction];
  if (!record || busy || record.study || record.kind !== 'greatPower') return [];
  const next = TROOPS[mostNeeded(state, faction)].recruit.gold;
  const spare = record.stores.gold - reserveOf(state, faction, 'gold') - next;
  const best = bestStudy(state, faction, spare);
  if (!best) return [];
  // The soonest advance is the one to beat, so the costlier reckoning of buildings waits for one.
  const building = nextBuilding(state, faction);
  if (building && building.payback < best.payback) return [];
  return [{ kind: 'study', faction, advance: best.advance }];
}
