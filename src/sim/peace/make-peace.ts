import { emit } from '../events.ts';
import type { FactionId } from '../ids.ts';
import { removeRecord } from '../records.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import type { PeaceTerms } from '../state/peace.ts';
import { warKey } from '../state/war.ts';
import { payTerms } from './terms.ts';
import { TRUCE_DAYS } from './truce.ts';

/**
 * Ends the war between the two on the terms, which the caller checked, and starts a truce.
 * The armies go home when the homecoming system next runs, the same day, after every
 * order of the day, so no order given before the peace sends them back.
 */
export function makePeace(state: GameState, a: FactionId, b: FactionId, terms: PeaceTerms): void {
  const key = warKey(a, b);
  if (terms.kind === 'payment') payTerms(state, terms, terms.payer === a ? b : a);
  removeRecord(state.wars, key);
  removeRecord(state.peaceOffers, key);
  state.truces[key] = { since: state.day, endsOn: (state.day + TRUCE_DAYS) as Day };
  emit(state, { kind: 'peaceMade', between: [a, b], terms });
}
