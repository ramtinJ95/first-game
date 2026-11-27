import { buildBarrier } from '../buildings/build.ts';
import {
  BUILDING_KINDS,
  BUILDINGS,
  coloniaShareAt,
  FIRST_LEVELS,
  ownPowerOf,
  templeReachOf,
  trainingDaysAt,
  type BuildingKind,
} from '../buildings/buildings.ts';
import { buildingGain } from '../buildings/gains.ts';
import { UNREST_DAYS } from '../cities.ts';
import type { FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import { CONVOY_KM_PER_DAY, MARCH_KM_PER_DAY } from '../march.ts';
import {
  goldPerManOf,
  menOf,
  OUTPUT_PER_PERSON,
  UNREST_OUTPUT,
  UPKEEP_PER_MAN,
} from '../systems/economy.ts';
import { TROOPS } from '../troops.ts';
import { areAtWar } from '../wars.ts';
import { mostNeeded } from './budget.ts';
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

/** A first level, or a power's own building, which the AI weighs as one. */
function isFirstLevel(kind: BuildingKind): boolean {
  return (FIRST_LEVELS as readonly BuildingKind[]).includes(kind) || ownPowerOf(kind) !== undefined;
}
/** The cities a power takes in a year near a border temple or Colonia, by which the AI prices one. */
export const CONQUESTS_A_YEAR = 1;
/** The times a year the realm's armies cross a Royal road's province or sail within a Cothon's reach, by which the AI prices them. */
export const CROSSINGS_A_YEAR = 2;
/** The km of a Royal road's province an army crosses. */
export const ROAD_KM = 200;
/** The formations of cavalry a city with Royal stables trains a year, by which the AI prices them. */
export const CAVALRY_A_YEAR = 3;
/** The gold a day one man under arms of the faction costs, food at FOOD_PRICE: what a day of his service saved is worth. */
function manDayOf(state: State, faction: FactionId): number {
  return goldPerManOf(state, faction) + UPKEEP_PER_MAN.food * FOOD_PRICE;
}

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
 * another faction in its longer reach that no temple of the owner reaches yet. A Colonia is
 * priced as a temple is, by the unrest it would spare. A Cothon and a Royal road are worth the
 * upkeep of the realm's armies for the days they save on CROSSINGS_A_YEAR crossings, and Royal
 * stables the upkeep of CAVALRY_A_YEAR formations of heavy cavalry for the days of training saved.
 */
export function buildingWorth(state: State, city: CityView, kind: BuildingKind): number {
  const gain = buildingGain(state, city, kind);
  const { gold, food, manpower } = gain.daily;
  const fed = (balanceOf(state, city.owner)?.food ?? 0) / UPKEEP_PER_MAN.food;
  let worth = gold + (fed < FOOD_MARGIN_MEN ? food * FOOD_PRICE : 0) + manpower * MANPOWER_PRICE;
  const manDay = manDayOf(state, city.owner);
  if (
    (kind === 'towers' || kind === 'outerWalls' || kind === 'stronghold') &&
    onBorder(state, city)
  ) {
    worth += gain.garrison * manDay;
  }
  worth += (savedManDays(state, city, kind) / 365) * manDay;
  const target =
    kind === 'temple'
      ? templeTarget(state, city)
      : kind === 'sanctuary'
        ? sanctuaryTarget(state, city)
        : undefined;
  if (target) {
    worth += conquestWorth(target, 1 - 1 / BUILDINGS.temple.unrestPace);
  }
  const colonist =
    kind === 'colonia' && !coloniaShareAtTarget(state, city)
      ? nearestForeign(state, city, BUILDINGS.colonia.reachKm, true)
      : undefined;
  if (colonist) worth += conquestWorth(colonist, 1 - BUILDINGS.colonia.unrestShare);
  return worth;
}

/** The gold a day that sparing `share` of a conquest's unrest a year in a city like the target is worth. */
function conquestWorth(target: CityView, share: number): number {
  const output =
    target.population * (OUTPUT_PER_PERSON.gold + OUTPUT_PER_PERSON.manpower * MANPOWER_PRICE);
  const savedDays = ((1 - UNREST_OUTPUT) / 2) * UNREST_DAYS * share;
  return (CONQUESTS_A_YEAR / 365) * savedDays * output;
}

/** Whether a Colonia of the owner already halves the unrest of the city a new one would. */
function coloniaShareAtTarget(state: State, city: CityView): boolean {
  const target = nearestForeign(state, city, BUILDINGS.colonia.reachKm, true);
  return target !== undefined && coloniaShareAt(state, city.owner, target.position) < 1;
}

/** The days of service a year times the men that a building which saves time saves its owner. */
function savedManDays(state: State, city: CityView, kind: BuildingKind): number {
  if (kind === 'royalStables') {
    const before = trainingDaysAt(city, 'heavyCavalry');
    const after = trainingDaysAt({ buildings: [...city.buildings, kind] }, 'heavyCavalry');
    return CAVALRY_A_YEAR * (before - after) * TROOPS.heavyCavalry.recruit.men;
  }
  if (kind !== 'cothon' && kind !== 'royalRoad') return 0;
  const men = sorted(state.armies)
    .filter((army) => army.owner === city.owner)
    .reduce((sum, army) => sum + menOf(state, army), 0);
  const saved =
    kind === 'cothon'
      ? (BUILDINGS.cothon.reachKm / CONVOY_KM_PER_DAY) * (1 - 1 / BUILDINGS.cothon.sailShare)
      : (ROAD_KM / MARCH_KM_PER_DAY) * (1 - 1 / BUILDINGS.royalRoad.marchShare);
  return CROSSINGS_A_YEAR * saved * men;
}

/**
 * Orders at most one building a day, on a day the power raised no recruit: the one that
 * pays back its gold soonest among those its cities can start, if that is within
 * BUILD_PAYBACK_YEARS for a first level and PROJECT_PAYBACK_YEARS for a second level or a
 * great work. A first level it can start comes before any second level or great work. It builds only while its gold and food balances are not falling
 * and only with gold left over the reserve for its men and the price of the recruit it
 * would raise next, so a building never stops it keeping or growing an army. A ruler
 * that never recruits, `keepsRecruits` false, keeps only the reserve for its men. A power
 * `forFood`, whose next recruit only food stops, builds only what grows food, keeps no
 * gold back for that recruit, since the recruit waits on the food, and builds it however
 * short of food it is.
 */
export function construction(
  state: State,
  faction: FactionId,
  recruiting: boolean,
  keepsRecruits = true,
  forFood = false,
): Order[] {
  const record = state.factions[faction];
  if (!record || recruiting) return [];
  const next = keepsRecruits && !forFood ? TROOPS[mostNeeded(state, faction)].recruit.gold : 0;
  const spare = record.stores.gold - reserveOf(state, faction, 'gold') - next;
  if (spare < CHEAPEST) return [];
  const balance = balanceOf(state, faction);
  if (!balance || balance.gold < 0) return [];
  if (!forFood && (balance.food < 0 || record.stores.food < reserveOf(state, faction, 'food'))) {
    return [];
  }
  const best = nextBuilding(state, faction, spare, forFood);
  return best ? [{ kind: 'build', faction, city: best.city.id, building: best.kind }] : [];
}

/**
 * The building the power starts next with `spare` gold: the one that pays back its gold
 * soonest among those its cities can start, if within its payback limit, a first level before
 * any second level or great work. With no `spare`, the one it would start with gold enough,
 * however little it holds today. With `forFood`, only a building that grows food.
 */
export function nextBuilding(
  state: State,
  faction: FactionId,
  spare = Infinity,
  forFood = false,
): { city: CityView; kind: BuildingKind; payback: number } | undefined {
  let best: { city: CityView; kind: BuildingKind; payback: number; first: boolean } | undefined;
  for (const city of sorted(state.cities)) {
    if (city.owner !== faction || city.construction) continue;
    for (const kind of BUILDING_KINDS) {
      const { gold } = BUILDINGS[kind];
      if (gold > spare || buildBarrier(state, city, kind)) continue;
      if (forFood && buildingGain(state, city, kind).daily.food <= 0) continue;
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
  return best;
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
export function nearestForeign(
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
