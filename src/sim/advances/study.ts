import type { DeepReadonly } from '../deep-readonly.ts';
import type { FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import { ADVANCES, STUDY_REFUND, hasStudied, type AdvanceKind } from './advances.ts';

export interface StudyOrder {
  kind: 'study';
  faction: FactionId;
  advance: AdvanceKind;
}

export interface CancelStudyOrder {
  kind: 'cancelStudy';
  faction: FactionId;
}

/**
 * Why the faction cannot start studying this advance now, or undefined when it can. A realm
 * studies one advance at a time, each once, and only with the gold it costs.
 */
export function studyRefusal(
  state: DeepReadonly<GameState>,
  faction: FactionId,
  advance: AdvanceKind,
): string | undefined {
  if (!Object.hasOwn(ADVANCES, advance)) return `advance ${advance} does not exist`;
  const record = state.factions[faction];
  if (!record) return `faction ${faction} does not exist`;
  if (record.defeatedOn !== null) return `faction ${faction} has fallen`;
  if (hasStudied(record, advance)) return `${faction} has studied ${advance} already`;
  if (record.study) return `${faction} is studying ${record.study.advance}`;
  const { gold } = ADVANCES[advance];
  if (record.stores.gold < gold) {
    return `${advance} costs ${gold} gold, but ${faction} has ${Math.floor(record.stores.gold)}`;
  }
  return undefined;
}

/** Pays the advance's gold now and starts its days of study, which the study system counts down. */
export function study(state: GameState, order: StudyOrder): string | undefined {
  const refusal = studyRefusal(state, order.faction, order.advance);
  if (refusal) return refusal;
  const record = state.factions[order.faction];
  if (!record) return `faction ${order.faction} does not exist`;
  const { gold, days } = ADVANCES[order.advance];
  record.stores.gold -= gold;
  record.study = { advance: order.advance, daysLeft: days };
  return undefined;
}

/** The gold that giving up the study of this advance gives back. */
export function studyRefund(advance: AdvanceKind): number {
  return Math.round(ADVANCES[advance].gold * STUDY_REFUND);
}

/** Stops the faction's study and gives back STUDY_REFUND of its gold, however far it got. */
export function cancelStudy(state: GameState, order: CancelStudyOrder): string | undefined {
  const record = state.factions[order.faction];
  if (!record) return `faction ${order.faction} does not exist`;
  if (!record.study) return `${order.faction} is studying nothing`;
  record.stores.gold += studyRefund(record.study.advance);
  record.study = null;
  return undefined;
}
