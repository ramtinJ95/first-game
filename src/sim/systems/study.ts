import { emit } from '../events.ts';
import type { GameState } from '../state/game-state.ts';

/** Studies one day of each faction's advance, and finishes those whose days are done. */
export function study(state: GameState): void {
  for (const faction of Object.values(state.factions)) {
    const work = faction.study;
    if (!work || faction.defeatedOn !== null) continue;
    if (work.daysLeft > 1) {
      work.daysLeft -= 1;
      continue;
    }
    faction.advances.push(work.advance);
    faction.study = null;
    emit(state, { kind: 'advanceFinished', faction: faction.id, advance: work.advance });
  }
}
