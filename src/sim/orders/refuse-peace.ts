import { emit } from '../events.ts';
import { peaceAnswer } from '../ai/peace.ts';
import { forecastChanges, peaceForecast } from '../peace/forecast.ts';
import { makePeace } from '../peace/make-peace.ts';
import type { FactionId } from '../ids.ts';
import { standingOffer } from '../peace/offer.ts';
import { copyTerms } from '../peace/terms.ts';
import { removeRecord } from '../records.ts';
import type { GameState } from '../state/game-state.ts';
import { warKey } from '../state/war.ts';

export interface RefusePeaceOrder {
  kind: 'refusePeace';
  faction: FactionId;
  /** The faction whose offer is refused. */
  from: FactionId;
  /** AI answers are rechecked after the earlier orders of the day. */
  reckon?: true;
}

/** Refuses the offer that waits from the other side. The war goes on. */
export function refusePeace(state: GameState, order: RefusePeaceOrder): string | undefined {
  const offer = standingOffer(state, order.faction, order.from);
  if (!offer || offer.from !== order.from) return `${order.from} offers ${order.faction} no peace`;
  const terms = copyTerms(offer.terms);
  const answer = peaceAnswer(state, order.faction, order.from, terms);
  if (!answer) throw new Error('A standing peace offer must belong to a living war');
  // AI orders were planned before the player's orders. Recheck at execution, too.
  if (order.reckon && answer.accepts) {
    makePeace(state, order.faction, order.from, terms);
    return undefined;
  }
  let reason = answer.verdict;
  const current = peaceForecast(state, order.faction, order.from, terms);
  if (offer.forecast && current && offer.forecast.accepts !== current.accepts) {
    reason += ` The forecast changed: ${forecastChanges(offer.forecast, current, state)}.`;
  }
  removeRecord(state.peaceOffers, warKey(order.faction, order.from));
  emit(state, { kind: 'peaceRefused', by: order.faction, from: order.from, terms, reason });
  return undefined;
}
