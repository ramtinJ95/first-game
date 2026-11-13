import { emit } from '../events.ts';
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
}

/** Refuses the offer that waits from the other side. The war goes on. */
export function refusePeace(state: GameState, order: RefusePeaceOrder): string | undefined {
  const offer = standingOffer(state, order.faction, order.from);
  if (!offer || offer.from !== order.from) return `${order.from} offers ${order.faction} no peace`;
  const terms = copyTerms(offer.terms);
  removeRecord(state.peaceOffers, warKey(order.faction, order.from));
  emit(state, { kind: 'peaceRefused', by: order.faction, from: order.from, terms });
  return undefined;
}
