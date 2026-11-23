import type { DeepReadonly } from '../deep-readonly.ts';
import type { Faction } from '../state/faction.ts';

export const ADVANCE_BRANCHES = ['military', 'economy', 'statecraft'] as const;
export type AdvanceBranch = (typeof ADVANCE_BRANCHES)[number];

export const ADVANCE_KINDS = [
  'officerSchools',
  'siegecraft',
  'guardContracts',
  'coinage',
  'cropRotation',
  'weightsAndMeasures',
  'census',
  'governors',
  'clemency',
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
  officerSchools: { name: 'Officer schools', branch: 'military', gold: 3000, days: 90 },
  siegecraft: { name: 'Siegecraft', branch: 'military', gold: 3000, days: 90 },
  guardContracts: { name: 'Guard contracts', branch: 'military', gold: 2500, days: 60 },
  coinage: { name: 'Coinage', branch: 'economy', gold: 5000, days: 120 },
  cropRotation: { name: 'Crop rotation', branch: 'economy', gold: 4000, days: 120 },
  weightsAndMeasures: { name: 'Weights and measures', branch: 'economy', gold: 3500, days: 90 },
  census: { name: 'Census', branch: 'statecraft', gold: 5000, days: 120 },
  governors: { name: 'Provincial governors', branch: 'statecraft', gold: 6000, days: 150 },
  clemency: { name: 'Clemency', branch: 'statecraft', gold: 3000, days: 90 },
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
