import type { DeepReadonly } from '../sim/deep-readonly.ts';
import { guardMen } from '../sim/guards.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { Alert } from './alerts.ts';
import { whole } from './names.ts';

type State = DeepReadonly<GameState>;

/**
 * One alert for each of the player's cities, held through the day, that holds fewer
 * guards than the day before because their bands served their year. A city that changed
 * owner loses its guards with the city, which other news tells.
 */
export function guardNewsOfDay(before: State, after: State): Alert[] {
  const news: Alert[] = [];
  for (const city of Object.values(after.cities)) {
    const was = before.cities[city.id];
    if (city.owner !== after.player || was?.owner !== city.owner) continue;
    const left = guardMen(was) - guardMen(city);
    if (left <= 0) continue;
    news.push({
      kind: 'guardsLeft',
      day: before.day,
      tone: 'neutral',
      text: `The ${whole(left)} guards hired at ${city.name} have served their year and left. Hire more in its city panel.`,
      focus: { at: city.position, select: { kind: 'province', province: city.province } },
    });
  }
  return news;
}
