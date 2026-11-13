import type { DeepReadonly } from '../deep-readonly.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';

export const BUILDING_KINDS = ['forum', 'canals', 'barracks', 'towers', 'temple'] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

/** What every building has: its price in gold, its days of work, and the people its city needs to start it. */
interface BuildingRow {
  readonly name: string;
  readonly gold: number;
  readonly days: number;
  readonly needs: { readonly people: number };
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
} as const satisfies Record<BuildingKind, BuildingRow & { readonly [effect: string]: unknown }>;

/** The share of a building's gold that cancelling its work gives back. The rest is spent. */
export const CANCEL_REFUND = 0.5;

type Built = DeepReadonly<Pick<City, 'buildings'>>;

export function hasBuilt(city: Built, kind: BuildingKind): boolean {
  return city.buildings.includes(kind);
}

/** What the city's gold yield is multiplied by. */
export function goldShareOf(city: Built): number {
  return hasBuilt(city, 'forum') ? 1 + BUILDINGS.forum.goldShare : 1;
}

/** The food a day the city's buildings grow at full, before unrest cuts it. */
export function extraFoodOf(city: Built): number {
  return hasBuilt(city, 'canals') ? BUILDINGS.canals.food : 0;
}

/** What the city's manpower yield and its share of the realm's levy are multiplied by. */
export function levyShareOf(city: Built): number {
  return hasBuilt(city, 'barracks') ? BUILDINGS.barracks.levyShare : 1;
}

/** The days a recruit of this many days of training takes in the city. */
export function trainingDaysAt(city: Built, days: number): number {
  return hasBuilt(city, 'barracks') ? Math.ceil(days * BUILDINGS.barracks.trainingShare) : days;
}

/** What the city's full walls and full garrison are multiplied by. */
export function defenceSharesOf(city: Partial<Built>): { walls: number; garrison: number } {
  if (!city.buildings?.includes('towers')) return { walls: 1, garrison: 1 };
  return { walls: 1 + BUILDINGS.towers.wallsShare, garrison: 1 + BUILDINGS.towers.garrisonShare };
}

/** The days of unrest the city counts down today: more within reach of its owner's temple. */
export function unrestPaceOf(state: DeepReadonly<GameState>, city: DeepReadonly<City>): number {
  const { reachKm, unrestPace } = BUILDINGS.temple;
  for (const other of Object.values(state.cities)) {
    if (other.owner !== city.owner || !hasBuilt(other, 'temple')) continue;
    const km = Math.hypot(other.position.x - city.position.x, other.position.y - city.position.y);
    if (km <= reachKm) return unrestPace;
  }
  return 1;
}
