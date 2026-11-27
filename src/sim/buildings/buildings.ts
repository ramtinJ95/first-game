import type { DeepReadonly } from '../deep-readonly.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
import type { FactionId } from '../ids.ts';
import type { PowerId } from '../map.ts';
import type { MapPoint } from '../state/map-point.ts';
import { TROOPS, type Troop } from '../troops.ts';

/** The five buildings every city may build first. */
export const FIRST_LEVELS = ['forum', 'canals', 'barracks', 'towers', 'temple'] as const;
export type FirstLevel = (typeof FIRST_LEVELS)[number];

/** The second level of each first building, which a city builds only on its first. */
export const SECOND_LEVELS = {
  forum: 'lawCourts',
  canals: 'reservoirs',
  barracks: 'drillField',
  towers: 'outerWalls',
  temple: 'sanctuary',
} as const satisfies Record<FirstLevel, string>;
export type SecondLevel = (typeof SECOND_LEVELS)[FirstLevel];

/** The large projects, of which a city holds one at most. */
export const GREAT_WORKS = ['treasuryHall', 'merchantsQuarter', 'stronghold'] as const;
export type GreatWork = (typeof GREAT_WORKS)[number];

/** Each great power's own building, which only that power starts. */
export const SIGNATURE_BUILDINGS = {
  rome: 'colonia',
  carthage: 'cothon',
  macedon: 'royalStables',
  egypt: 'greatGranary',
  persia: 'royalRoad',
} as const satisfies Record<PowerId, string>;
export type SignatureBuilding = (typeof SIGNATURE_BUILDINGS)[PowerId];

export const BUILDING_KINDS = [
  ...FIRST_LEVELS,
  ...FIRST_LEVELS.map((kind) => SECOND_LEVELS[kind]),
  ...GREAT_WORKS,
  ...Object.values(SIGNATURE_BUILDINGS),
] as const;
export type BuildingKind = FirstLevel | SecondLevel | GreatWork | SignatureBuilding;

/**
 * What every building has: its price in gold, its days of work, the people its city
 * needs to start it, the building it must stand with first, if any, and the one great
 * power that may start it, if only one may.
 */
interface BuildingRow {
  readonly name: string;
  readonly gold: number;
  readonly days: number;
  readonly needs: { readonly people: number; readonly building?: FirstLevel };
  readonly power?: PowerId;
}

/**
 * Every building a city can build, with its cost, its days, what it needs, and what it
 * does. Each changes one part of the game, so each is a different choice:
 *
 * - The forum raises the city's gold by `goldShare`. It needs a large city, and it pays
 *   most in a great capital far from the front.
 * - Canals water the fields round the city for `food` more food a day whatever its size,
 *   so they pay best for a small city's share, and only to a realm whose men eat its harvest.
 * - Barracks make the city give `levyShare` times the manpower, in its daily yield and in
 *   what the realm can call up, and train its recruits in `trainingShare` of the days, so
 *   they suit the city a ruler musters at.
 * - Towers raise the city's full walls by `wallsShare` and its full garrison by
 *   `garrisonShare`, men who hold it without upkeep. They matter only on a border.
 * - A temple counts unrest down `unrestPace` days a day in every city of its owner
 *   within `reachKm`, itself among them, so a ruler who conquers across a border puts
 *   new cities to work sooner.
 *
 * Each second level adds more of its first level's kind of effect: Law courts more of the
 * city's base gold, Reservoirs more food, a Drill field `extraLevyShare` more of the base
 * manpower and levy, Outer walls more walls and garrison, and a Sanctuary a longer reach
 * for the temple. A great work is a large project a city holds one of: a Treasury hall
 * raises the city's base gold, a Merchants' quarter raises what its end of each route
 * earns by `tradeShare` and adds `slots` route slots, and a Stronghold raises the walls
 * and garrison as towers do, but more.
 *
 * Each great power has one building of its own, which a conqueror keeps but cannot start:
 * Rome's Colonia halves the unrest of every city Rome takes within `reachKm`, and its own
 * recruits train in `trainingShare` of the days. Carthage's Cothon has ships gather on a shore
 * within `reachKm` in `gatherShare` of the days, and convoys within that reach sail
 * `sailShare` times as fast. Macedon's Royal stables train cavalry in `cavalryShare` of the
 * days. Egypt's Great granary stores `storeDays` more days of the city's food, grows
 * `harvestShare` more of it, and sells grain for `goldShare` more of the city's gold. Persia's Royal road has its owner's armies march `marchShare`
 * times as fast in the city's province, the land nearer it than any other city.
 */
export const BUILDINGS = {
  forum: { name: 'Forum', gold: 6500, days: 60, needs: { people: 20_000 }, goldShare: 0.5 },
  canals: { name: 'Canals', gold: 4000, days: 45, needs: { people: 0 }, food: 5 },
  barracks: {
    name: 'Barracks',
    gold: 7000,
    days: 40,
    needs: { people: 10_000 },
    levyShare: 1.5,
    trainingShare: 0.5,
  },
  towers: {
    name: 'Towers',
    gold: 6000,
    days: 60,
    needs: { people: 0 },
    wallsShare: 0.5,
    garrisonShare: 0.3,
  },
  temple: {
    name: 'Temple',
    gold: 1500,
    days: 30,
    needs: { people: 0 },
    unrestPace: 3,
    reachKm: 400,
  },
  lawCourts: {
    name: 'Law courts',
    gold: 7500,
    days: 75,
    needs: { people: 0, building: 'forum' },
    goldShare: 0.25,
  },
  reservoirs: {
    name: 'Reservoirs',
    gold: 6500,
    days: 60,
    needs: { people: 0, building: 'canals' },
    food: 5,
  },
  drillField: {
    name: 'Drill field',
    gold: 7500,
    days: 60,
    needs: { people: 0, building: 'barracks' },
    extraLevyShare: 0.25,
  },
  outerWalls: {
    name: 'Outer walls',
    gold: 7500,
    days: 75,
    needs: { people: 0, building: 'towers' },
    wallsShare: 0.25,
    garrisonShare: 0.2,
  },
  sanctuary: {
    name: 'Sanctuary',
    gold: 1750,
    days: 45,
    needs: { people: 0, building: 'temple' },
    reachKm: 700,
  },
  treasuryHall: {
    name: 'Treasury hall',
    gold: 12_000,
    days: 365,
    needs: { people: 0 },
    goldShare: 0.4,
  },
  merchantsQuarter: {
    name: "Merchants' quarter",
    gold: 11_000,
    days: 365,
    needs: { people: 0 },
    tradeShare: 0.4,
    slots: 1,
  },
  stronghold: {
    name: 'Stronghold',
    gold: 12_000,
    days: 365,
    needs: { people: 0, building: 'towers' },
    wallsShare: 1,
    garrisonShare: 0.35,
  },
  colonia: {
    name: 'Colonia',
    gold: 1200,
    days: 60,
    needs: { people: 0 },
    power: 'rome',
    unrestShare: 0.5,
    reachKm: 400,
    trainingShare: 0.75,
  },
  cothon: {
    name: 'Cothon',
    gold: 1350,
    days: 90,
    needs: { people: 0 },
    power: 'carthage',
    reachKm: 400,
    gatherShare: 0.5,
    sailShare: 1.5,
  },
  royalStables: {
    name: 'Royal stables',
    gold: 1200,
    days: 45,
    needs: { people: 0 },
    power: 'macedon',
    cavalryShare: 0.5,
  },
  greatGranary: {
    name: 'Great granary',
    gold: 4500,
    days: 90,
    needs: { people: 0 },
    power: 'egypt',
    storeDays: 90,
    harvestShare: 0.25,
    goldShare: 0.15,
  },
  royalRoad: {
    name: 'Royal road',
    gold: 330,
    days: 90,
    needs: { people: 0 },
    power: 'persia',
    marchShare: 1.25,
  },
} as const satisfies Record<BuildingKind, BuildingRow & { readonly [effect: string]: unknown }>;

/** The share of a building's gold that cancelling its work gives back. The rest is spent. */
export const CANCEL_REFUND = 0.5;

type Built = DeepReadonly<Pick<City, 'buildings'>>;

export function hasBuilt(city: Built, kind: BuildingKind): boolean {
  return city.buildings.includes(kind);
}

export function isGreatWork(kind: BuildingKind): kind is GreatWork {
  return (GREAT_WORKS as readonly BuildingKind[]).includes(kind);
}

/** The level a first building stands at in the city: 0 unbuilt, 1, or 2 with its second level. */
export function levelOf(city: Built, kind: FirstLevel): 0 | 1 | 2 {
  if (!hasBuilt(city, kind)) return 0;
  return hasBuilt(city, SECOND_LEVELS[kind]) ? 2 : 1;
}

/** The great power that alone may start this building, or undefined when any city may. */
export function ownPowerOf(kind: BuildingKind): PowerId | undefined {
  const row: BuildingRow = BUILDINGS[kind];
  return row.power;
}

/** The first building a second level stands on, or undefined for a first level or a great work. */
export function firstLevelOf(kind: BuildingKind): FirstLevel | undefined {
  return FIRST_LEVELS.find((first) => SECOND_LEVELS[first] === kind);
}

/** The first building the city must stand with before it may start this one, if any. */
export function neededFirst(kind: BuildingKind): FirstLevel | undefined {
  const row: BuildingRow = BUILDINGS[kind];
  return row.needs.building;
}

/** The great work the city stands with, or undefined. */
export function greatWorkOf(city: Built): GreatWork | undefined {
  return GREAT_WORKS.find((work) => hasBuilt(city, work));
}

/** What the city's gold yield is multiplied by. */
export function goldShareOf(city: Built): number {
  return (
    1 +
    (hasBuilt(city, 'forum') ? BUILDINGS.forum.goldShare : 0) +
    (hasBuilt(city, 'lawCourts') ? BUILDINGS.lawCourts.goldShare : 0) +
    (hasBuilt(city, 'treasuryHall') ? BUILDINGS.treasuryHall.goldShare : 0) +
    (hasBuilt(city, 'greatGranary') ? BUILDINGS.greatGranary.goldShare : 0)
  );
}

/** The food a day the city's buildings grow, in unrest or not. */
export function extraFoodOf(city: Built): number {
  return (
    (hasBuilt(city, 'canals') ? BUILDINGS.canals.food : 0) +
    (hasBuilt(city, 'reservoirs') ? BUILDINGS.reservoirs.food : 0)
  );
}

/** What the city's manpower yield and its share of the realm's levy are multiplied by. */
export function levyShareOf(city: Built): number {
  if (!hasBuilt(city, 'barracks')) return 1;
  return (
    BUILDINGS.barracks.levyShare +
    (hasBuilt(city, 'drillField') ? BUILDINGS.drillField.extraLevyShare : 0)
  );
}

/** What the gold of the city's end of each of its routes is multiplied by. */
export function tradeShareOf(city: Built): number {
  return hasBuilt(city, 'merchantsQuarter') ? 1 + BUILDINGS.merchantsQuarter.tradeShare : 1;
}

/** The route slots the city's buildings add. */
export function extraSlotsOf(city: Built): number {
  return hasBuilt(city, 'merchantsQuarter') ? BUILDINGS.merchantsQuarter.slots : 0;
}

/** The days the troop's recruits take to train in the city. */
export function trainingDaysAt(city: Built, troop: Troop): number {
  const { days } = TROOPS[troop].recruit;
  const share =
    (hasBuilt(city, 'barracks') ? BUILDINGS.barracks.trainingShare : 1) *
    (hasBuilt(city, 'colonia') ? BUILDINGS.colonia.trainingShare : 1) *
    (hasBuilt(city, 'royalStables') && TROOPS[troop].category === 'cavalry'
      ? BUILDINGS.royalStables.cavalryShare
      : 1);
  return share === 1 ? days : Math.ceil(days * share);
}

/** What the food the city's people grow is multiplied by. */
export function harvestShareAt(city: Built): number {
  return hasBuilt(city, 'greatGranary') ? 1 + BUILDINGS.greatGranary.harvestShare : 1;
}

/** The days of its people's food the city's granaries hold beyond the realm's own. */
export function extraStoreDaysOf(city: Built): number {
  return hasBuilt(city, 'greatGranary') ? BUILDINGS.greatGranary.storeDays : 0;
}

type Placed = DeepReadonly<Pick<City, 'buildings' | 'owner' | 'position'>>;

function km(a: DeepReadonly<MapPoint>, b: DeepReadonly<MapPoint>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Whether a city of the faction stands with the building within `reachKm` of the point. */
function withinReach(
  cities: Readonly<Record<string, Placed>>,
  faction: FactionId,
  kind: 'colonia' | 'cothon',
  at: DeepReadonly<MapPoint>,
): boolean {
  return Object.values(cities).some(
    (city) =>
      city.owner === faction &&
      hasBuilt(city, kind) &&
      km(city.position, at) <= BUILDINGS[kind].reachKm,
  );
}

/** What the days of unrest of a city the faction takes at the point are multiplied by: less near its Colonia. */
export function coloniaShareAt(
  state: DeepReadonly<Pick<GameState, 'cities'>>,
  faction: FactionId,
  at: DeepReadonly<MapPoint>,
): number {
  return withinReach(state.cities, faction, 'colonia', at) ? BUILDINGS.colonia.unrestShare : 1;
}

/** Whether a convoy or a shore of the faction at the point lies within reach of its Cothon. */
export function nearCothon(
  state: DeepReadonly<Pick<GameState, 'cities'>>,
  faction: FactionId,
  at: DeepReadonly<MapPoint>,
): boolean {
  return withinReach(state.cities, faction, 'cothon', at);
}

/** Whether the point lies in a province of the faction whose city has a Royal road: nearer that city than any other. */
export function onRoyalRoad(
  state: DeepReadonly<Pick<GameState, 'cities'>>,
  faction: FactionId,
  at: DeepReadonly<MapPoint>,
): boolean {
  let nearest: Placed | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const city of Object.values(state.cities)) {
    const d = km(city.position, at);
    if (d < best) {
      best = d;
      nearest = city;
    }
  }
  return nearest !== undefined && nearest.owner === faction && hasBuilt(nearest, 'royalRoad');
}

const DEFENCES = ['towers', 'outerWalls', 'stronghold'] as const;

/** What the city's full walls and full garrison are multiplied by. */
export function defenceSharesOf(city: Partial<Built>): { walls: number; garrison: number } {
  const shares = { walls: 1, garrison: 1 };
  for (const kind of DEFENCES) {
    if (!city.buildings?.includes(kind)) continue;
    shares.walls += BUILDINGS[kind].wallsShare;
    shares.garrison += BUILDINGS[kind].garrisonShare;
  }
  return shares;
}

/** How far the city's temple reaches, in km: farther with a Sanctuary, 0 without a temple. */
export function templeReachOf(city: Built): number {
  if (hasBuilt(city, 'sanctuary')) return BUILDINGS.sanctuary.reachKm;
  return hasBuilt(city, 'temple') ? BUILDINGS.temple.reachKm : 0;
}

/** The days of unrest the city counts down today: more within reach of its owner's temple. */
export function unrestPaceOf(state: DeepReadonly<GameState>, city: DeepReadonly<City>): number {
  for (const other of Object.values(state.cities)) {
    const reach = templeReachOf(other);
    if (other.owner !== city.owner || reach === 0) continue;
    const km = Math.hypot(other.position.x - city.position.x, other.position.y - city.position.y);
    if (km <= reach) return BUILDINGS.temple.unrestPace;
  }
  return 1;
}
