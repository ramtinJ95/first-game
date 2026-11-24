import type { DeepReadonly } from '../deep-readonly.ts';
import type { Faction } from '../state/faction.ts';

export const ADVANCE_BRANCHES = ['military', 'economy', 'statecraft'] as const;
export type AdvanceBranch = (typeof ADVANCE_BRANCHES)[number];

export const ADVANCE_KINDS = [
  'drillmasters',
  'marchingRations',
  'siegeEngineers',
  'standardCoin',
  'fallowFields',
  'marketWeights',
  'citizenRolls',
  'clemency',
  'longContracts',
] as const;
export type AdvanceKind = (typeof ADVANCE_KINDS)[number];

/** What every advance has: its name, its branch, its price in gold, and its days of study. */
interface AdvanceRow {
  readonly name: string;
  readonly branch: AdvanceBranch;
  readonly gold: number;
  readonly days: number;
}

/**
 * Every advance a realm can study, one at a time and in any order, each once. The gold is
 * paid at the order. Each changes a different part of the realm through a rule that
 * already exists:
 *
 * - Drillmasters raise every army's general to `generalSkill`, and new armies start there.
 * - Marching rations make each man under arms eat `foodShare` of his food.
 * - Siege engineers make the realm's besiegers wear walls down `wallWearShare` times as fast.
 * - Standard coin makes every city yield `goldShare` times its gold.
 * - Fallow fields make every city's people grow `foodShare` times their food.
 * - Market weights make each route pay the realm's ends `tradeShare` times as much.
 * - Citizen rolls make every city give `levyShare` times its manpower, a day and to call up.
 * - Clemency gives a city the realm takes, sacks or enslaves `unrestShare` of the days of unrest.
 * - Long contracts make a band of guards the realm hires serve `guardShare` times as long.
 */
export const ADVANCES = {
  drillmasters: {
    name: 'Drillmasters',
    branch: 'military',
    gold: 3000,
    days: 180,
    generalSkill: 5,
  },
  marchingRations: {
    name: 'Marching rations',
    branch: 'military',
    gold: 3000,
    days: 180,
    foodShare: 0.9,
  },
  siegeEngineers: {
    name: 'Siege engineers',
    branch: 'military',
    gold: 1500,
    days: 120,
    wallWearShare: 1.5,
  },
  standardCoin: { name: 'Standard coin', branch: 'economy', gold: 6000, days: 300, goldShare: 1.2 },
  fallowFields: { name: 'Fallow fields', branch: 'economy', gold: 6000, days: 240, foodShare: 1.2 },
  marketWeights: {
    name: 'Market weights',
    branch: 'economy',
    gold: 5500,
    days: 240,
    tradeShare: 1.2,
  },
  citizenRolls: {
    name: 'Citizen rolls',
    branch: 'statecraft',
    gold: 6000,
    days: 300,
    levyShare: 1.2,
  },
  clemency: { name: 'Clemency', branch: 'statecraft', gold: 1500, days: 120, unrestShare: 0.5 },
  longContracts: {
    name: 'Long contracts',
    branch: 'statecraft',
    gold: 3000,
    days: 150,
    guardShare: 1.5,
  },
} as const satisfies Record<AdvanceKind, AdvanceRow & { readonly [effect: string]: unknown }>;

/** The share of an advance's gold that giving up its study gives back. The rest is spent. */
export const STUDY_REFUND = 0.5;

type Learned = DeepReadonly<Pick<Faction, 'advances'>>;

export function hasStudied(faction: Learned | undefined, kind: AdvanceKind): boolean {
  return faction?.advances.includes(kind) ?? false;
}

/** The advances of each branch, in the table's order. */
export function advancesOf(branch: AdvanceBranch): AdvanceKind[] {
  return ADVANCE_KINDS.filter((kind) => ADVANCES[kind].branch === branch);
}

type Realm = Learned | undefined;
const share = (realm: Realm, kind: AdvanceKind, value: number) =>
  hasStudied(realm, kind) ? value : 1;

/** The skill a general of the realm has at least: an army's own, or more with Drillmasters. */
export function generalSkillOf(realm: Realm, skill: number): number {
  return hasStudied(realm, 'drillmasters')
    ? Math.max(skill, ADVANCES.drillmasters.generalSkill)
    : skill;
}

/** What the food each of the realm's men eats is multiplied by. */
export const rationShareOf = (realm: Realm) =>
  share(realm, 'marchingRations', ADVANCES.marchingRations.foodShare);
/** What the walls the realm's besiegers wear down a day are multiplied by. */
export const wallWearShareOf = (realm: Realm) =>
  share(realm, 'siegeEngineers', ADVANCES.siegeEngineers.wallWearShare);
/** What the gold of each of the realm's cities is multiplied by. */
export const coinShareOf = (realm: Realm) =>
  share(realm, 'standardCoin', ADVANCES.standardCoin.goldShare);
/** What the food each person of the realm grows is multiplied by. */
export const harvestShareOf = (realm: Realm) =>
  share(realm, 'fallowFields', ADVANCES.fallowFields.foodShare);
/** What each of the realm's route ends is paid is multiplied by. */
export const marketShareOf = (realm: Realm) =>
  share(realm, 'marketWeights', ADVANCES.marketWeights.tradeShare);
/** What the manpower of each of the realm's cities, a day and to call up, is multiplied by. */
export const rollsShareOf = (realm: Realm) =>
  share(realm, 'citizenRolls', ADVANCES.citizenRolls.levyShare);
/** What the days of unrest of a city the realm takes, sacks or enslaves are multiplied by. */
export const unrestShareOf = (realm: Realm) =>
  share(realm, 'clemency', ADVANCES.clemency.unrestShare);
/** What the days a band of guards the realm hires serves are multiplied by. */
export const guardShareOf = (realm: Realm) =>
  share(realm, 'longContracts', ADVANCES.longContracts.guardShare);
