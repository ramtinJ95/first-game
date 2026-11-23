import {
  ADVANCE_BRANCHES,
  ADVANCES,
  advancesOf,
  hasStudied,
  type AdvanceBranch,
  type AdvanceKind,
} from '../sim/advances/advances.ts';
import { advanceGain } from '../sim/advances/gains.ts';
import { studyRefund, type StudyOrder } from '../sim/advances/study.ts';
import { bestStudy, studyPayback } from '../sim/ai/study.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId } from '../sim/ids.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { whole } from '../app/names.ts';

type State = DeepReadonly<GameState>;

export const BRANCH_NAMES: Readonly<Record<AdvanceBranch, string>> = {
  military: 'Military',
  economy: 'Economy',
  statecraft: 'Statecraft',
};

/** The rule in a sentence, as the panel opens with it. */
export const ADVANCE_RULE =
  'Your realm studies one advance at a time, in any order. Its gold is paid when study starts, and its effect lasts for good once the days are done.';

/** One advance as the panel shows it to the realm today. */
export interface AdvanceRowView {
  readonly kind: AdvanceKind;
  readonly name: string;
  readonly gold: number;
  readonly days: number;
  /** What it would do for this realm today, in the realm's own numbers. */
  readonly does: string;
  readonly payback: string;
  readonly status: 'studied' | 'studying' | 'ordered' | 'open';
  /** Why the realm cannot start it now, in words, while it is open. */
  readonly refusal?: string;
  /** The advance that pays back soonest of those the realm can start now. */
  readonly suggested: boolean;
}

export interface BranchView {
  readonly branch: AdvanceBranch;
  readonly name: string;
  readonly rows: readonly AdvanceRowView[];
}

/** The three branches with each advance, as the realm stands today and with the orders waiting. */
export function advancesView(
  state: State,
  faction: FactionId,
  pending: readonly Order[],
): BranchView[] {
  const record = state.factions[faction];
  const ordered = pending.find(
    (order): order is StudyOrder => order.kind === 'study' && order.faction === faction,
  )?.advance;
  const suggested = record ? bestStudy(state, faction, record.stores.gold)?.advance : undefined;
  return ADVANCE_BRANCHES.map((branch) => ({
    branch,
    name: BRANCH_NAMES[branch],
    rows: advancesOf(branch).map((kind) => {
      const { name, gold, days } = ADVANCES[kind];
      const status = hasStudied(record, kind)
        ? 'studied'
        : record?.study?.advance === kind
          ? 'studying'
          : ordered === kind
            ? 'ordered'
            : 'open';
      const refusal =
        status !== 'open'
          ? undefined
          : ordered
            ? `${ADVANCES[ordered].name} is ordered for the next day`
            : refusalText(state, faction, kind);
      return {
        kind,
        name,
        gold,
        days,
        does: doesText(state, faction, kind),
        payback: paybackText(state, faction, kind),
        status,
        ...(refusal ? { refusal } : {}),
        suggested: kind === suggested,
      };
    }),
  }));
}

/** What the advance would add to this realm today, from the rules' own sums. */
export function doesText(state: State, faction: FactionId, kind: AdvanceKind): string {
  const { daily, limits } = advanceGain(state, faction, kind);
  const parts: string[] = [];
  const add = (amount: number, what: string) => {
    if (Math.abs(amount) >= 0.05)
      parts.push(`${amount > 0 ? '+' : ''}${amount.toFixed(1)} ${what}`);
  };
  add(daily.gold, 'gold a day');
  add(daily.food, 'food a day');
  add(daily.manpower, 'manpower a day');
  if (Math.abs(limits.manpower) >= 1)
    parts.push(`${limits.manpower > 0 ? '+' : ''}${whole(limits.manpower)} men to call up`);
  return parts.length > 0 ? parts.join(', ') : 'Nothing for your realm today';
}

function paybackText(state: State, faction: FactionId, kind: AdvanceKind): string {
  const years = studyPayback(state, faction, kind);
  if (years === undefined) return 'Pays nothing back today';
  return years > 20 ? 'Pays back in over 20 years' : `Pays back in ${years.toFixed(1)} years`;
}

function refusalText(state: State, faction: FactionId, kind: AdvanceKind): string | undefined {
  const record = state.factions[faction];
  if (!record) return 'Your realm has fallen';
  if (record.defeatedOn !== null) return 'Your realm has fallen';
  if (record.study) return `Studying ${ADVANCES[record.study.advance].name}; one at a time`;
  const { gold } = ADVANCES[kind];
  if (record.stores.gold < gold) return `Needs ${whole(gold - record.stores.gold)} more gold`;
  return undefined;
}

/** What the realm studies and the days left, or that it studies nothing. */
export function studyLine(state: State, faction: FactionId): { short: string; full: string } {
  const study = state.factions[faction]?.study;
  if (!study) return { short: 'None studied', full: 'Nothing is being studied.' };
  const { name } = ADVANCES[study.advance];
  const days = `${study.daysLeft} ${study.daysLeft === 1 ? 'day' : 'days'}`;
  return { short: `${name} · ${days}`, full: `Studying ${name}: ${days} left.` };
}

/** The words of the cancel button: the gold that giving up the study gives back. */
export function cancelText(advance: AdvanceKind): string {
  return `Give up (${whole(studyRefund(advance))} gold back)`;
}
