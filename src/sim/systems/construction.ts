import type { DeepReadonly } from '../deep-readonly.ts';
import { emit } from '../events.ts';
import type { City } from '../state/city.ts';
import type { GameState } from '../state/game-state.ts';
import { beleaguered } from './sieges.ts';

/** Why the city does no work on its building today, or undefined while it works. */
export function workPause(
  state: DeepReadonly<GameState>,
  city: DeepReadonly<City>,
): 'unrest' | 'siege' | undefined {
  if (city.unrestDays > 0) return 'unrest';
  if (beleaguered(state, city)) return 'siege';
  return undefined;
}

/**
 * Works one day on each city's building, and finishes those whose days are done. A city
 * in unrest, or with an enemy at its walls, does no work that day.
 */
export function construction(state: GameState): void {
  for (const city of Object.values(state.cities)) {
    const work = city.construction;
    if (!work || workPause(state, city)) continue;
    if (work.daysLeft > 1) {
      work.daysLeft -= 1;
      continue;
    }
    city.buildings.push(work.building);
    city.construction = null;
    emit(state, {
      kind: 'buildingFinished',
      city: city.id,
      owner: city.owner,
      building: work.building,
      position: city.position,
    });
  }
}
