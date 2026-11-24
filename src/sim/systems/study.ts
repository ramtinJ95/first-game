import { generalSkillOf } from '../advances/advances.ts';
import { emit } from '../events.ts';
import type { GameState } from '../state/game-state.ts';

/**
 * Studies one day of each faction's advance, and finishes those whose days are done. A
 * finished advance that raises generals raises those of the faction's armies at once.
 */
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
    for (const army of Object.values(state.armies))
      if (army.owner === faction.id) army.generalSkill = generalSkillOf(faction, army.generalSkill);
    emit(state, { kind: 'advanceFinished', faction: faction.id, advance: work.advance });
  }
}
