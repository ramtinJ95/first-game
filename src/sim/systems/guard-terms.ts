import type { GameState } from '../state/game-state.ts';
import { fullDefences } from './sieges.ts';

/**
 * Lets each band of guards go on its day. A city that loses a band keeps no more
 * garrison than its new full garrison.
 */
export function guardTerms(state: GameState): void {
  for (const city of Object.values(state.cities)) {
    const serving = city.guards.filter((band) => band.until > state.day);
    if (serving.length === city.guards.length) continue;
    city.guards = serving;
    city.garrison = Math.min(city.garrison, fullDefences(city).garrison);
  }
}
