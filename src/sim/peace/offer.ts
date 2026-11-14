import type { DeepReadonly } from '../deep-readonly.ts';
import type { FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import type { PeaceOffer } from '../state/peace.ts';
import { warKey } from '../state/war.ts';

/** An offer of peace stands this many days. After that it lapses as if refused. */
export const OFFER_DAYS = 30;

/** The offer that waits for an answer in the war between the two today, from either side. */
export function standingOffer(
  state: DeepReadonly<GameState>,
  a: FactionId,
  b: FactionId,
): DeepReadonly<PeaceOffer> | undefined {
  if (a === b) return undefined;
  const key = warKey(a, b);
  const offer = Object.hasOwn(state.peaceOffers, key) ? state.peaceOffers[key] : undefined;
  return offer && state.day - offer.madeOn < OFFER_DAYS ? offer : undefined;
}
