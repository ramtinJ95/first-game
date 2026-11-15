import type { DeepReadonly } from '../deep-readonly.ts';
import type { FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import type { Truce } from '../state/peace.ts';
import { warKey } from '../state/war.ts';

/**
 * The days a truce lasts after a peace. A year lets a beaten side rebuild and keeps a
 * pair from flipping between war and peace, and it is short enough that a ten-year game
 * still sees the same rivals fight again.
 */
export const TRUCE_DAYS = 365;

/**
 * A paid peace binds longer, by this many days for each point the payer gave, so the
 * side that took the price cannot come back for more the day a year runs out.
 */
export const TRUCE_DAYS_PER_POINT = 30;
/** The most a payment adds to a truce, so no price buys a frozen border for good. */
export const MAX_PAID_TRUCE_DAYS = 730;

/** The days a truce lasts after a peace whose terms gave the receiver `paid` points. */
export function truceLength(paid: number): number {
  return (
    TRUCE_DAYS + Math.min(MAX_PAID_TRUCE_DAYS, Math.round(Math.max(0, paid) * TRUCE_DAYS_PER_POINT))
  );
}

/** The truce that still binds the two factions today, if any. */
export function truceBetween(
  state: DeepReadonly<GameState>,
  a: FactionId,
  b: FactionId,
): DeepReadonly<Truce> | undefined {
  if (a === b) return undefined;
  const key = warKey(a, b);
  const truce = Object.hasOwn(state.truces, key) ? state.truces[key] : undefined;
  return truce && truce.endsOn > state.day ? truce : undefined;
}

/** The days left before the two factions may declare war on each other, 0 for none. */
export function truceDaysLeft(state: DeepReadonly<GameState>, a: FactionId, b: FactionId): number {
  const truce = truceBetween(state, a, b);
  return truce ? truce.endsOn - state.day : 0;
}
