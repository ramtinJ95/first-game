import { sailOnArrival } from '../orders/embark.ts';
import type { GameState } from '../state/game-state.ts';
import { distance } from '../world/find-path.ts';
import type { World } from '../world/world.ts';

/**
 * Sets out every army that stands at the end of a march that ends in a crossing: it
 * embarks there, or stands idle with news of why it cannot. It runs straight after
 * `movement`, so no other system sees a march that has arrived.
 */
export function embarkation(state: GameState, world: World): void {
  for (const army of Object.values(state.armies)) {
    const { activity } = army;
    if (activity.kind !== 'marching' || !activity.sail) continue;
    const [end, ...rest] = activity.waypoints;
    if (!end || rest.length > 0 || distance(activity.position, end) > 0) continue;
    sailOnArrival(state, world, army, activity.position, activity.sail);
  }
}
