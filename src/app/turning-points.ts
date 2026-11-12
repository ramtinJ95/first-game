import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import { outcomeOf } from '../sim/outcome.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { World } from '../sim/world/world.ts';

/** A day that stops the game for the player: the end of it, or a fate to choose. */
export type TurningPoint =
  | {
      readonly kind: 'lost';
      readonly on: Day;
      /** The last city and who took it. The player saw it fall, so naming them shows nothing hidden. */
      readonly city: CityId | undefined;
      readonly by: FactionId | undefined;
    }
  | { readonly kind: 'won'; readonly on: Day }
  | { readonly kind: 'fate'; readonly city: CityId };

type State = DeepReadonly<GameState>;

/** What changed for the player between two days that the page must stop for. */
export function turningPoints(before: State, after: State, world: World): TurningPoint[] {
  const player = after.player;
  const points: TurningPoint[] = [];
  const was = outcomeOf(before, world, player);
  const is = outcomeOf(after, world, player);
  if (is.kind === 'lost' && was.kind !== 'lost') {
    // The day does not record which of several cities fell last, so only a lone one is named.
    const lost = Object.values(after.cities).filter(
      (city) => before.cities[city.id]?.owner === player && city.owner !== player,
    );
    const last = lost.length === 1 ? lost[0] : undefined;
    points.push({ kind: 'lost', on: is.on, city: last?.id, by: last?.owner });
    return points;
  }
  if (is.kind === 'won' && was.kind !== 'won') points.push({ kind: 'won', on: after.day });
  for (const city of Object.values(after.cities)) {
    if (city.owner !== player || city.fellOn === null) continue;
    const then = before.cities[city.id];
    if (then?.owner === player && then.fellOn === city.fellOn) continue;
    points.push({ kind: 'fate', city: city.id });
  }
  return points;
}
