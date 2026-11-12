import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';

export function advanceDay(state: GameState): void {
  state.day = (state.day + 1) as Day;
}
