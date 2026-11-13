import { emit } from '../events.ts';
import type { FactionId } from '../ids.ts';
import { termsProblem } from '../peace/terms.ts';
import type { GameState } from '../state/game-state.ts';
import type { PeaceTerms } from '../state/peace.ts';
import { warKey } from '../state/war.ts';

export interface OfferPeaceOrder {
  kind: 'offerPeace';
  faction: FactionId;
  /** The faction the war is against, which answers the offer. */
  to: FactionId;
  terms: PeaceTerms;
}

/**
 * Offers peace on the terms to the faction the war is against. The offer waits for its
 * answer, and replaces any offer that waits in the same war, so a reply can be a counter-offer,
 * but not one the other side made today: that one is answered first.
 */
export function offerPeace(state: GameState, order: OfferPeaceOrder): string | undefined {
  const key = warKey(order.faction, order.to);
  const war = order.faction === order.to ? undefined : state.wars[key];
  if (!war) return `${order.faction} is not at war with ${order.to}`;
  const waiting = state.peaceOffers[key];
  if (waiting && waiting.from === order.to && waiting.madeOn === state.day) {
    return `${order.to} offered ${order.faction} peace today, and waits for the answer`;
  }
  const problem = termsProblem(state, [order.faction, order.to], order.terms);
  if (problem) return problem;
  state.peaceOffers[key] = { from: order.faction, terms: order.terms, madeOn: state.day };
  war.offeredOn = state.day;
  emit(state, { kind: 'peaceOffered', from: order.faction, to: order.to, terms: order.terms });
  return undefined;
}
