import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import { emit } from '../events.ts';
import { OFFER_DAYS } from '../peace/offer.ts';
import { removeRecord } from '../records.ts';
import { warSides } from '../state/war.ts';

export function advanceDay(state: GameState): void {
  for (const [key, offer] of Object.entries(state.peaceOffers)) {
    if (state.day + 1 - offer.madeOn < OFFER_DAYS) continue;
    const sides = warSides(key);
    const to = sides?.find((side) => side !== offer.from);
    if (to)
      emit(state, {
        kind: 'peaceOfferEnded',
        from: offer.from,
        to,
        reason: `The offer expired after ${OFFER_DAYS} days without an answer; the war goes on.`,
      });
    removeRecord(state.peaceOffers, key as keyof typeof state.peaceOffers);
  }
  state.day = (state.day + 1) as Day;
}
