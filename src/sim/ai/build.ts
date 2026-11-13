import { buildRefusal } from '../buildings/build.ts';
import { BUILDING_KINDS, BUILDINGS, type BuildingKind } from '../buildings/buildings.ts';
import { buildingGain } from '../buildings/gains.ts';
import { UNREST_DAYS } from '../cities.ts';
import type { FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import { OUTPUT_PER_PERSON, UNREST_OUTPUT, UPKEEP_PER_MAN } from '../systems/economy.ts';
import { TROOPS } from '../troops.ts';
import { areAtWar } from '../wars.ts';
import { balanceOf, reserveOf, sorted, type CityView, type State } from './situation.ts';
import { TROOP_MIX } from './thresholds.ts';

/** Gold a day that one food and one manpower are worth: what the same people yield of each. */
export const FOOD_PRICE = OUTPUT_PER_PERSON.gold / OUTPUT_PER_PERSON.food;
export const MANPOWER_PRICE = OUTPUT_PER_PERSON.gold / OUTPUT_PER_PERSON.manpower;
/** A city with a city of a great power or of an enemy this close, in km, is on a border. */
export const BORDER_KM = 400;
/** The AI builds only what pays its gold back within this many years. */
export const BUILD_PAYBACK_YEARS = 6;
/** The cities a power takes in a year near a border temple, by which the AI prices one. */
export const CONQUESTS_A_YEAR = 1;

/**
 * Food counts in a building's worth only while the realm's harvest, after its upkeep,
 * feeds fewer than this many more men. Beyond that more food only spoils.
 */
export const FOOD_MARGIN_MEN = 2000;

/** The cheapest troop the AI raises, whose price a building never takes from it. */
const RECRUIT_RESERVE = Math.min(
  ...(Object.keys(TROOP_MIX) as (keyof typeof TROOPS)[]).map((troop) => TROOPS[troop].recruit.gold),
);
const CHEAPEST = Math.min(...BUILDING_KINDS.map((kind) => BUILDINGS[kind].gold));

/**
 * What a building in the city is worth to its owner in gold a day. Gold counts as it
 * is, manpower at MANPOWER_PRICE, and food at FOOD_PRICE while the realm's harvest feeds
 * fewer than FOOD_MARGIN_MEN more men. On a border, towers are worth the
 * upkeep of the field army their garrison spares. A temple is worth the output it saves
 * in CONQUESTS_A_YEAR cities like the nearest city of another faction in its reach, and
 * towers behind the border and a temple with no city to take are worth nothing.
 */
export function buildingWorth(state: State, city: CityView, kind: BuildingKind): number {
  const gain = buildingGain(state, city, kind);
  const { gold, food, manpower } = gain.daily;
  const fed = (balanceOf(state, city.owner)?.food ?? 0) / UPKEEP_PER_MAN.food;
  let worth = gold + (fed < FOOD_MARGIN_MEN ? food * FOOD_PRICE : 0) + manpower * MANPOWER_PRICE;
  if (kind === 'towers' && onBorder(state, city)) {
    worth += gain.garrison * (UPKEEP_PER_MAN.gold + UPKEEP_PER_MAN.food * FOOD_PRICE);
  }
  if (kind === 'temple') {
    const target = nearestForeign(state, city, BUILDINGS.temple.reachKm, true);
    if (target) {
      const output =
        target.population *
        (OUTPUT_PER_PERSON.gold +
          OUTPUT_PER_PERSON.food * FOOD_PRICE +
          OUTPUT_PER_PERSON.manpower * MANPOWER_PRICE);
      const savedDays =
        ((1 - UNREST_OUTPUT) / 2) * UNREST_DAYS * (1 - 1 / BUILDINGS.temple.unrestPace);
      worth += (CONQUESTS_A_YEAR / 365) * savedDays * output;
    }
  }
  return worth;
}

/**
 * Orders at most one building a day, on a day the power raised no recruit: the one that
 * pays back its gold soonest among those its cities can start, if that is within
 * BUILD_PAYBACK_YEARS. It builds only while its gold and food balances are not falling
 * and only with gold left over the reserve for its men and the price of its cheapest
 * recruit, so a building never stops it keeping an army or raising one in haste.
 */
export function construction(state: State, faction: FactionId, recruiting: boolean): Order[] {
  const record = state.factions[faction];
  if (!record || recruiting) return [];
  const spare = record.stores.gold - reserveOf(state, faction, 'gold') - RECRUIT_RESERVE;
  if (spare < CHEAPEST || record.stores.food < reserveOf(state, faction, 'food')) return [];
  const balance = balanceOf(state, faction);
  if (!balance || balance.gold < 0 || balance.food < 0) return [];
  let best: { city: CityView; kind: BuildingKind; payback: number } | undefined;
  for (const city of sorted(state.cities)) {
    if (city.owner !== faction || city.construction) continue;
    for (const kind of BUILDING_KINDS) {
      const { gold } = BUILDINGS[kind];
      if (gold > spare || buildRefusal(state, city, kind)) continue;
      const worth = buildingWorth(state, city, kind);
      if (worth <= 0) continue;
      const payback = gold / worth / 365;
      if (payback <= BUILD_PAYBACK_YEARS && (!best || payback < best.payback)) {
        best = { city, kind, payback };
      }
    }
  }
  return best ? [{ kind: 'build', faction, city: best.city.id, building: best.kind }] : [];
}

function onBorder(state: State, city: CityView): boolean {
  return nearestForeign(state, city, BORDER_KM) !== undefined;
}

/** The nearest city within `km` of another faction: of a great power or an enemy only, unless `any`. */
function nearestForeign(
  state: State,
  city: CityView,
  km: number,
  any = false,
): CityView | undefined {
  let best: CityView | undefined;
  let bestKm = km;
  for (const other of sorted(state.cities)) {
    if (other.owner === city.owner) continue;
    const kind = state.factions[other.owner]?.kind;
    if (!any && kind !== 'greatPower' && !areAtWar(state, city.owner, other.owner)) continue;
    const d = Math.hypot(other.position.x - city.position.x, other.position.y - city.position.y);
    if (d <= bestKm) {
      best = other;
      bestKm = d;
    }
  }
  return best;
}
