import * as v from 'valibot';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { DayEvent } from '../sim/events.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { menOf } from '../sim/systems/economy.ts';
import { whole } from './names.ts';
import type { Alert } from './alerts.ts';

export const DesertionSchema = v.object({
  initial: v.number(),
  lost: v.number(),
  tenth: v.boolean(),
  food: v.boolean(),
  gold: v.boolean(),
});
export type Desertion = v.InferOutput<typeof DesertionSchema>;
type State = DeepReadonly<GameState>;

export function desertionNews(
  before: State,
  after: State,
  events: readonly DeepReadonly<DayEvent>[],
  watched?: Desertion,
): { alerts: Alert[]; watched: Desertion | undefined } {
  const lost = events.reduce(
    (sum, event) =>
      sum + (event.kind === 'armyDeserted' && event.owner === after.player ? event.men : 0),
    0,
  );
  const alerts: Alert[] = [];
  const add = (kind: Alert['kind'], text: string, tone: Alert['tone'] = 'bad') =>
    alerts.push({ kind, text, tone, day: before.day });
  if (lost === 0) {
    if (watched)
      add(
        'desertionEnded',
        `Desertion has ended: ${whole(watched.lost)} men lost in this shortage. ${shortageCause(watched)}.`,
        'neutral',
      );
    return { alerts, watched: undefined };
  }
  const stores = after.factions[after.player]?.stores;
  if (!stores) throw new Error('Desertion news needs the player faction');
  const next = {
    initial:
      watched?.initial ??
      Math.max(
        Object.values(before.armies)
          .filter((a) => a.owner === after.player)
          .reduce((sum, a) => sum + menOf(before, a), 0),
        Object.values(after.armies)
          .filter((a) => a.owner === after.player)
          .reduce((sum, a) => sum + menOf(after, a), lost),
      ),
    lost: (watched?.lost ?? 0) + lost,
    tenth: watched?.tenth ?? false,
    food: (watched?.food ?? false) || stores.food < 0,
    gold: (watched?.gold ?? false) || stores.gold < 0,
  };
  if (!watched)
    add(
      'desertionBegan',
      `Desertion has begun: ${whole(lost)} men lost. ${shortageCause(next)}. Men desert each day until stores recover; raise fewer troops or improve income.`,
    );
  if (!next.tenth && next.lost >= next.initial / 10) {
    next.tenth = true;
    add(
      'desertionTenth',
      `Desertion has cost a tenth of your army at the start of this shortage: ${whole(next.lost)} of ${whole(next.initial)} men. ${shortageCause(next)}.`,
    );
  }
  return { alerts, watched: next };
}

function shortageCause(watched: Desertion): string {
  return `Short of ${[...(watched.food ? ['food'] : []), ...(watched.gold ? ['gold'] : [])].join(' and ')}`;
}

export function desertionLine(game: State): string | undefined {
  const stores = game.factions[game.player]?.stores;
  if (
    !stores ||
    !Object.values(game.armies).some(
      (a) =>
        a.owner === game.player && a.formations.some((id) => (game.formations[id]?.men ?? 0) > 1),
    )
  )
    return undefined;
  const short = [
    ...(stores.food < 0 ? ['hunger'] : []),
    ...(stores.gold < 0 ? ['unpaid wages'] : []),
  ];
  return short.length
    ? `Men desert each day: ${short.join(' and ')}. Improve income or reduce upkeep.`
    : undefined;
}
