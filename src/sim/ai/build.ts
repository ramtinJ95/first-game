import { buildRefusal } from '../buildings/build.ts';
import {
  BUILDING_KINDS,
  BUILDINGS,
  FIRST_LEVELS,
  templeReachOf,
  type BuildingKind,
} from '../buildings/buildings.ts';
import { buildingGain } from '../buildings/gains.ts';
import { UNREST_DAYS } from '../cities.ts';
import type { FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import { OUTPUT_PER_PERSON, UNREST_OUTPUT, UPKEEP_PER_MAN } from '../systems/economy.ts';
import { TROOPS } from '../troops.ts';
import { areAtWar } from '../wars.ts';
import { mostNeeded } from './budget.ts';
import type { Saving } from './saving.ts';
import { balanceOf, reserveOf, sorted, type CityView, type State } from './situation.ts';

/** Gold a day that one food and one manpower are worth: what the same people yield of each. */
export const FOOD_PRICE = OUTPUT_PER_PERSON.gold / OUTPUT_PER_PERSON.food;
export const MANPOWER_PRICE = OUTPUT_PER_PERSON.gold / OUTPUT_PER_PERSON.manpower;
/** A city with a city of a great power or of an enemy this close, in km, is on a border. */
export const BORDER_KM = 400;
/** The AI builds only a first level that pays its gold back within this many years. */
export const BUILD_PAYBACK_YEARS = 6;
/** The AI builds a second level or a great work that pays its gold back within this many years. */
export const PROJECT_PAYBACK_YEARS = 6;

/** The years within which the AI builds this kind. */
export function paybackLimit(kind: BuildingKind): number {
  return isFirstLevel(kind) ? BUILD_PAYBACK_YEARS : PROJECT_PAYBACK_YEARS;
}

function isFirstLevel(kind: BuildingKind): boolean {
  return (FIRST_LEVELS as readonly BuildingKind[]).includes(kind);
}
/** The cities a power takes in a year near a border temple, by which the AI prices one. */
export const CONQUESTS_A_YEAR = 1;

/**
 * Food counts in a building's worth only while the realm's harvest, after its upkeep,
 * feeds fewer than this many more men. Beyond that more food only spoils.
 */
export const FOOD_MARGIN_MEN = 2000;

const CHEAPEST = Math.min(...BUILDING_KINDS.map((kind) => BUILDINGS[kind].gold));

/**
 * What a building in the city is worth to its owner in gold a day. Gold counts as it
 * is, manpower at MANPOWER_PRICE, and food at FOOD_PRICE while the realm's harvest feeds
 * fewer than FOOD_MARGIN_MEN more men. On a border, towers are worth the
 * upkeep of the field army their garrison spares. A temple is worth the gold and manpower it saves
 * in CONQUESTS_A_YEAR cities like the nearest city of another faction in its reach, and
 * towers behind the border and a temple with no city to take are worth nothing. Outer walls
 * and a Stronghold count as towers do, and a Sanctuary as a temple for the nearest city of
 * another faction in its longer reach that no temple of the owner reaches yet.
 */
export function buildingWorth(state: State, city: CityView, kind: BuildingKind): number {
  const gain = buildingGain(state, city, kind);
  const { gold, food, manpower } = gain.daily;
  const fed = (balanceOf(state, city.owner)?.food ?? 0) / UPKEEP_PER_MAN.food;
  let worth = gold + (fed < FOOD_MARGIN_MEN ? food * FOOD_PRICE : 0) + manpower * MANPOWER_PRICE;
  if (
    (kind === 'towers' || kind === 'outerWalls' || kind === 'stronghold') &&
    onBorder(state, city)
  ) {
    worth += gain.garrison * (UPKEEP_PER_MAN.gold + UPKEEP_PER_MAN.food * FOOD_PRICE);
  }
  const target =
    kind === 'temple'
      ? templeTarget(state, city)
      : kind === 'sanctuary'
        ? sanctuaryTarget(state, city)
        : undefined;
  if (target) {
    const output =
      target.population * (OUTPUT_PER_PERSON.gold + OUTPUT_PER_PERSON.manpower * MANPOWER_PRICE);
    const savedDays =
      ((1 - UNREST_OUTPUT) / 2) * UNREST_DAYS * (1 - 1 / BUILDINGS.temple.unrestPace);
    worth += (CONQUESTS_A_YEAR / 365) * savedDays * output;
  }
  return worth;
}

/**
 * Orders at most one building a day, on a day the power raised no recruit: the one that
 * pays back its gold soonest among those its cities can start, if that is within
 * BUILD_PAYBACK_YEARS for a first level and PROJECT_PAYBACK_YEARS for a second level or a
 * great work. A first level it can start comes before any second level or great work. It builds only while its gold and food balances are not falling
 * and only with gold left over the reserve for its men and the price of the recruit it
 * would raise next, so a building never stops it keeping or growing an army. A ruler
 * that never recruits, `keepsRecruits` false, keeps only the reserve for its men. While it
 * saves for a great work (`savingFor`), it orders the work once its gold over the reserve
 * pays for it, and starts nothing else with the gold kept for it.
 */
export function construction(
  state: State,
  faction: FactionId,
  recruiting: boolean,
  keepsRecruits = true,
  saving?: Saving,
): Order[] {
  const record = state.factions[faction];
  if (!record || recruiting) return [];
  if (record.stores.food < reserveOf(state, faction, 'food')) return [];
  const balance = balanceOf(state, faction);
  if (!balance || balance.gold < 0 || balance.food < 0) return [];
  const over = record.stores.gold - reserveOf(state, faction, 'gold');
  if (saving && over >= saving.gold) {
    return [{ kind: 'build', faction, city: saving.city, building: saving.work }];
  }
  const next = keepsRecruits ? TROOPS[mostNeeded(state, faction)].recruit.gold : 0;
  const spare = over - next - (saving?.gold ?? 0);
  if (spare < CHEAPEST) return [];
  let best: { city: CityView; kind: BuildingKind; payback: number; first: boolean } | undefined;
  for (const city of sorted(state.cities)) {
    if (city.owner !== faction || city.construction) continue;
    for (const kind of BUILDING_KINDS) {
      const { gold } = BUILDINGS[kind];
      if (gold > spare || buildRefusal(state, city, kind)) continue;
      const worth = buildingWorth(state, city, kind);
      if (worth <= 0) continue;
      const payback = gold / worth / 365;
      const first = isFirstLevel(kind);
      if (payback > paybackLimit(kind)) continue;
      if (!best || (first && !best.first) || (first === best.first && payback < best.payback)) {
        best = { city, kind, payback, first };
      }
    }
  }
  return best ? [{ kind: 'build', faction, city: best.city.id, building: best.kind }] : [];
}

/** The city a new temple would calm when it is taken: the nearest foreign one in reach, unless another temple reaches it. */
function templeTarget(state: State, city: CityView): CityView | undefined {
  const target = nearestForeign(state, city, BUILDINGS.temple.reachKm, true);
  return target && !calmedAlready(state, city.owner, target, city) ? target : undefined;
}

/** The nearest foreign city in a Sanctuary's reach that no temple of the owner, the city's own among them, reaches. */
function sanctuaryTarget(state: State, city: CityView): CityView | undefined {
  const km = (a: CityView, b: CityView) =>
    Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  return sorted(state.cities)
    .filter(
      (other) =>
        other.owner !== city.owner &&
        km(city, other) <= BUILDINGS.sanctuary.reachKm &&
        !calmedAlready(state, city.owner, other),
    )
    .sort((a, b) => km(city, a) - km(city, b))[0];
}

/** Whether a temple of the owner, other than `except`, already reaches the target. */
function calmedAlready(
  state: State,
  owner: FactionId,
  target: CityView,
  except?: CityView,
): boolean {
  return sorted(state.cities).some(
    (other) =>
      other.id !== except?.id &&
      other.owner === owner &&
      Math.hypot(other.position.x - target.position.x, other.position.y - target.position.y) <=
        templeReachOf(other),
  );
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
