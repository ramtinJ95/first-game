import { ADVANCES } from '../sim/advances/advances.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { DayEvent } from '../sim/events.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import type { Alert } from './alerts.ts';

type State = DeepReadonly<GameState>;

/** The share of the treasury's limit at which the hint first tells of advances. */
export const HINT_SHARE = 0.9;
/** The key in the page's `told` of the hint, which comes once a game. */
export const HINT_TOLD = 'advance-hint';
/** The days the hint waits when the buildings' hint is told the same day. */
export const HINT_WAIT_DAYS = 30;
const WAIT_PREFIX = 'advance-hint-after:';

/**
 * The player's news of advances on a day: each advance the realm finished, and once a game
 * the hint that the Advances panel exists, on the first day the treasury nears its limit
 * while the realm has studied nothing and studies nothing. Neither stops the game. The hint's key goes into `told`.
 * On a day the buildings' hint is told (`buildingHint`), this one waits HINT_WAIT_DAYS and
 * comes on the first day after that the treasury still stands near its limit.
 */
export function advanceNewsOfDay(
  before: State,
  after: State,
  events: readonly DayEvent[],
  told: Set<string>,
  buildingHint = false,
): Alert[] {
  const news: Alert[] = [];
  for (const event of events) {
    if (event.kind !== 'advanceFinished' || event.faction !== after.player) continue;
    news.push({
      kind: 'advanceFinished',
      day: before.day,
      tone: 'good',
      text: `${ADVANCES[event.advance].name} is studied, for good. The Advances panel offers the next.`,
      opens: 'advances',
    });
  }
  const faction = after.factions[after.player];
  const learning = faction && (faction.study || faction.advances.length > 0);
  if (!told.has(HINT_TOLD) && faction && faction.defeatedOn === null && !learning) {
    const limit = limitsOf(after).get(after.player)?.gold ?? Infinity;
    const wait = [...told].find((key) => key.startsWith(WAIT_PREFIX));
    const waitsUntil = wait ? Number(wait.slice(WAIT_PREFIX.length)) : 0;
    if (faction.stores.gold >= HINT_SHARE * limit && before.day >= waitsUntil && buildingHint) {
      if (wait) told.delete(wait);
      told.add(`${WAIT_PREFIX}${before.day + HINT_WAIT_DAYS}`);
    } else if (faction.stores.gold >= HINT_SHARE * limit && before.day >= waitsUntil) {
      if (wait) told.delete(wait);
      told.add(HINT_TOLD);
      news.push({
        kind: 'advanceHint',
        day: before.day,
        tone: 'neutral',
        text: 'Your treasury is nearly full and nothing is being studied. Gold spent on an advance lasts for good: open Advances in the top bar to choose one.',
        opens: 'advances',
      });
    }
  }
  return news;
}
