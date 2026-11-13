import type { FactionId } from '../ids.ts';
import { makePeace } from '../peace/make-peace.ts';
import { standingOffer } from '../peace/offer.ts';
import { copyTerms, termsProblem } from '../peace/terms.ts';
import type { GameState } from '../state/game-state.ts';
import type { PeaceTerms } from '../state/peace.ts';

export interface AcceptPeaceOrder {
  kind: 'acceptPeace';
  faction: FactionId;
  /** The faction whose offer is accepted. */
  from: FactionId;
  /** The terms accepted, so an offer replaced after the answer was given is not accepted. */
  terms: PeaceTerms;
}

/** Accepts the offer that waits from the other side, and makes peace on its terms. */
export function acceptPeace(state: GameState, order: AcceptPeaceOrder): string | undefined {
  const offer = standingOffer(state, order.faction, order.from);
  if (!offer || offer.from !== order.from) return `${order.from} offers ${order.faction} no peace`;
  if (JSON.stringify(offer.terms) !== JSON.stringify(order.terms)) {
    return `${order.from} offers ${order.faction} other terms now`;
  }
  const problem = termsProblem(state, [order.faction, order.from], offer.terms);
  if (problem) return problem;
  makePeace(state, order.faction, order.from, copyTerms(offer.terms));
  return undefined;
}
