import { emit } from '../events.ts';
import { offerPriceRise, peaceForecast } from '../peace/forecast.ts';
import type { FactionId } from '../ids.ts';
import { copyTerms, termsProblem } from '../peace/terms.ts';
import type { GameState } from '../state/game-state.ts';
import type { PeaceForecast, PeaceOffer, PeaceTerms } from '../state/peace.ts';
import { warKey } from '../state/war.ts';

export interface OfferPeaceOrder {
  kind: 'offerPeace';
  faction: FactionId;
  /** The faction the war is against, which answers the offer. */
  to: FactionId;
  terms: PeaceTerms;
  forecast?: PeaceForecast;
}

/**
 * Offers peace on the terms to the faction the war is against. The offer waits for its
 * answer, and replaces any offer that waits in the same war, so a reply can be a counter-offer,
 * but never replaces an offer made today by either side: that one is answered first.
 */
export function offerPeace(state: GameState, order: OfferPeaceOrder): string | undefined {
  const key = warKey(order.faction, order.to);
  const war = order.faction === order.to ? undefined : state.wars[key];
  if (!war) return `${order.faction} is not at war with ${order.to}`;
  const waiting = state.peaceOffers[key];
  if (waiting && waiting.madeOn === state.day) {
    return `An offer of peace was already made today in this war; it waits for an answer`;
  }
  const problem = termsProblem(state, [order.faction, order.to], order.terms);
  if (problem) return problem;
  const side = war.sides[order.faction];
  if (!side) throw new Error('A war must record both sides');
  const offer: PeaceOffer = {
    from: order.faction,
    terms: copyTerms(order.terms),
    madeOn: state.day,
    forecast: order.forecast ?? peaceForecast(state, order.to, order.faction, order.terms),
    ownForecast: peaceForecast(state, order.faction, order.to, order.terms),
    receiverGold: Math.floor(state.factions[order.to]?.stores.gold ?? 0),
  };
  offer.change = offerPriceRise(state, side.lastOffer, offer, order.to);
  state.peaceOffers[key] = offer;
  side.lastOffer = offer;
  war.offeredOn = state.day;
  emit(state, {
    kind: 'peaceOffered',
    from: order.faction,
    to: order.to,
    terms: offer.terms,
    ...(offer.change ? { change: offer.change } : {}),
  });
  return undefined;
}
