import type { DeepReadonly } from '../sim/deep-readonly.ts';
import { GUARD_BAND, GUARD_DETER_DAYS } from '../sim/guards.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { Alert } from './alerts.ts';
import { whole } from './names.ts';

type State = DeepReadonly<GameState>;

/**
 * One alert for each of the player's cities, held through the day, whose bands of guards
 * served their year today, counted from the bands, so a band hired the same day hides none. A city that changed
 * owner loses its guards with the city, which other news tells.
 */
export function guardNewsOfDay(before: State, after: State): Alert[] {
  const news: Alert[] = [];
  for (const city of Object.values(after.cities)) {
    const was = before.cities[city.id];
    if (city.owner !== after.player || was?.owner !== city.owner) continue;
    const due = (bands: typeof city.guards) => bands.filter((b) => b.until <= before.day).length;
    const left = (due(was.guards) - due(city.guards)) * GUARD_BAND;
    if (left <= 0) continue;
    news.push({
      kind: 'guardsLeft',
      day: before.day,
      tone: 'neutral',
      text: `The ${whole(left)} guards hired at ${city.name} have served their year and left. A great power counts fresh guards against a war for ${GUARD_DETER_DAYS} days: hire them when the news warns of one.`,
      focus: { at: city.position, select: { kind: 'province', province: city.province } },
    });
  }
  return news;
}
