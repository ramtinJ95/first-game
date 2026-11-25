import type { DeepReadonly } from '../deep-readonly.ts';
import type { FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import {
  ADVANCES,
  GROWING_ADVANCES,
  PRICED_CITIES,
  STUDY_REFUND,
  hasStudied,
  type AdvanceKind,
} from './advances.ts';

export interface StudyOrder {
  kind: 'study';
  faction: FactionId;
  advance: AdvanceKind;
}

export interface CancelStudyOrder {
  kind: 'cancelStudy';
  faction: FactionId;
}

/** The cities of the faction's realm. */
export function citiesOf(state: DeepReadonly<GameState>, faction: FactionId): number {
  let cities = 0;
  for (const city of Object.values(state.cities)) if (city.owner === faction) cities++;
  return cities;
}

/**
 * The gold the faction pays to start this advance today: its listed gold, or for an
 * advance that grows with the realm, past PRICED_CITIES cities, the listed gold times the
 * realm's cities over PRICED_CITIES.
 */
export function studyPrice(
  state: DeepReadonly<GameState>,
  faction: FactionId,
  advance: AdvanceKind,
): number {
  const { gold } = ADVANCES[advance];
  if (!GROWING_ADVANCES.includes(advance)) return gold;
  return Math.round((gold * Math.max(PRICED_CITIES, citiesOf(state, faction))) / PRICED_CITIES);
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
  const gold = studyPrice(state, faction, advance);
  if (record.stores.gold < gold) {
    return `${advance} costs ${gold} gold, but ${faction} has ${Math.floor(record.stores.gold)}`;
  }
  return undefined;
}

/**
 * Pays the advance's price today and starts its days of study, which the study system
 * counts down. The study keeps what was paid, so a realm that grows later pays no more.
 */
export function study(state: GameState, order: StudyOrder): string | undefined {
  const refusal = studyRefusal(state, order.faction, order.advance);
  if (refusal) return refusal;
  const record = state.factions[order.faction];
  if (!record) return `faction ${order.faction} does not exist`;
  const paid = studyPrice(state, order.faction, order.advance);
  record.stores.gold -= paid;
  record.study = { advance: order.advance, daysLeft: ADVANCES[order.advance].days, paid };
  return undefined;
}

/** The gold that giving up a study gives back: STUDY_REFUND of what was paid for it. */
export function studyRefund(paid: number): number {
  return Math.round(paid * STUDY_REFUND);
}

/** Stops the faction's study and gives back STUDY_REFUND of what it paid, however far it got. */
export function cancelStudy(state: GameState, order: CancelStudyOrder): string | undefined {
  const record = state.factions[order.faction];
  if (!record) return `faction ${order.faction} does not exist`;
  if (!record.study) return `${order.faction} is studying nothing`;
  record.stores.gold += studyRefund(record.study.paid);
  record.study = null;
  return undefined;
}
