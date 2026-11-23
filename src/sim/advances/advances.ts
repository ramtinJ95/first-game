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
 * already exists.
 */
export const ADVANCES = {
  drillmasters: { name: 'Drillmasters', branch: 'military', gold: 6000, days: 240 },
  marchingRations: { name: 'Marching rations', branch: 'military', gold: 6000, days: 240 },
  siegeEngineers: { name: 'Siege engineers', branch: 'military', gold: 2000, days: 120 },
  standardCoin: { name: 'Standard coin', branch: 'economy', gold: 12000, days: 300 },
  fallowFields: { name: 'Fallow fields', branch: 'economy', gold: 9000, days: 300 },
  marketWeights: { name: 'Market weights', branch: 'economy', gold: 10000, days: 300 },
  citizenRolls: { name: 'Citizen rolls', branch: 'statecraft', gold: 10000, days: 300 },
  clemency: { name: 'Clemency', branch: 'statecraft', gold: 1500, days: 90 },
  longContracts: { name: 'Long contracts', branch: 'statecraft', gold: 5000, days: 180 },
} as const satisfies Record<AdvanceKind, AdvanceRow>;

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
