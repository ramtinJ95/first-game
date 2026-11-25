import type { DeepReadonly } from '../sim/deep-readonly.ts';
import { GUARD_BAND, GUARD_DAYS, GUARD_DETER_DAYS, hiredOn } from '../sim/guards.ts';
import type { GuardBand } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { Alert } from './alerts.ts';
import { dateText, whole } from './names.ts';

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
    const focus = {
      at: city.position,
      select: { kind: 'province', province: city.province },
    } as const;
    const due = (bands: typeof city.guards) => bands.filter((b) => b.until <= before.day).length;
    const left = (due(was.guards) - due(city.guards)) * GUARD_BAND;
    if (left > 0) {
      const longest = Math.max(
        GUARD_DAYS,
        ...was.guards
          .filter((b) => b.until <= before.day && b.hiredOn !== undefined)
          .map((b) => b.until - hiredOn(b)),
      );
      const term = longest === GUARD_DAYS ? 'year' : `${Math.round((longest / 365) * 12)} months`;
      news.push({
        kind: 'guardsLeft',
        day: before.day,
        tone: 'neutral',
        text: `The ${whole(left)} guards hired at ${city.name} have served their ${term} and left. A great power counts fresh guards against a war for ${GUARD_DETER_DAYS} days: hire them when the news warns of one.`,
        focus,
      });
    }
    for (const band of replacedBands(was.guards, city.guards, before.day))
      news.push({
        kind: 'guardsLeft',
        day: before.day,
        tone: 'neutral',
        text: `The ${whole(GUARD_BAND)} guards hired at ${city.name} on ${dateText(hiredOn(band))}, whom no great power still counted, left today to make room for the band you hired in their place, counted against a war until ${dateText(before.day + GUARD_DETER_DAYS)}.`,
        focus,
      });
  }
  return news;
}

/** Each band that left before its day, sent home by a hire that took its place (`replaced`). */
function replacedBands(
  was: readonly DeepReadonly<GuardBand>[],
  now: readonly DeepReadonly<GuardBand>[],
  day: number,
): DeepReadonly<GuardBand>[] {
  const kept = new Map<number, number>();
  for (const band of now) kept.set(band.until, (kept.get(band.until) ?? 0) + 1);
  const gone: DeepReadonly<GuardBand>[] = [];
  for (const band of was) {
    if (band.until <= day) continue;
    const left = kept.get(band.until) ?? 0;
    if (left > 0) kept.set(band.until, left - 1);
    else gone.push(band);
  }
  return gone;
}
