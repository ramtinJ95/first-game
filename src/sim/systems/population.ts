import { unrestPaceOf } from '../buildings/buildings.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { removeRecord } from '../records.ts';

/** A city grows by this share in a year while its owner's food store is not below zero. */
export const YEARLY_GROWTH = 0.02;
/** A city shrinks by this share in a year while its owner's food store is below zero. */
export const YEARLY_DECLINE = 0.1;
/** A refugee column this close to its destination city, in kilometres, has arrived. */
export const ARRIVAL_DISTANCE = 1;

const DAILY_GROWTH = (1 + YEARLY_GROWTH) ** (1 / 365);
const DAILY_DECLINE = (1 - YEARLY_DECLINE) ** (1 / 365);

/** Grows or starves each city, lets unrest fade by a day or, near a temple, by more, and settles arrived refugees. */
export function population(state: GameState): void {
  for (const city of Object.values(state.cities)) {
    const food = state.factions[city.owner]?.stores.food ?? 0;
    city.population *= food < 0 ? DAILY_DECLINE : DAILY_GROWTH;
    if (city.unrestDays > 0) {
      city.unrestDays = Math.max(0, city.unrestDays - unrestPaceOf(state, city));
    }
  }
  for (const column of Object.values(state.refugeeColumns)) {
    const city = state.cities[column.to];
    if (!city || distance(column.position, city.position) > ARRIVAL_DISTANCE) continue;
    city.population += column.people;
    removeRecord(state.refugeeColumns, column.id);
  }
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
