import { advanceAlong, CONVOY_KM_PER_DAY, MARCH_KM_PER_DAY, REFUGEE_KM_PER_DAY } from '../march.ts';
import { removeRecord } from '../records.ts';
import type { GameState } from '../state/game-state.ts';

/**
 * Moves every marching or retreating army, convoy, and refugee column one day along
 * the path it already holds. An army that arrives stands idle. A convoy that arrives lands its
 * armies idle at the harbour and is gone. A column stays where it arrives.
 */
export function movement(state: GameState): void {
  for (const army of Object.values(state.armies)) {
    const { activity } = army;
    if (activity.kind !== 'marching' && activity.kind !== 'retreating') continue;
    const position = advanceAlong(activity.position, activity.waypoints, MARCH_KM_PER_DAY);
    army.activity =
      activity.waypoints.length === 0
        ? { kind: 'idle', position }
        : { kind: activity.kind, position, waypoints: activity.waypoints };
  }
  for (const convoy of Object.values(state.convoys)) {
    convoy.position = advanceAlong(convoy.position, convoy.waypoints, CONVOY_KM_PER_DAY);
    if (convoy.waypoints.length > 0) continue;
    for (const id of convoy.armies) {
      const army = state.armies[id];
      if (army) army.activity = { kind: 'idle', position: { ...convoy.position } };
    }
    removeRecord(state.convoys, convoy.id);
  }
  for (const column of Object.values(state.refugeeColumns)) {
    if (column.waypoints.length === 0) continue;
    column.position = advanceAlong(column.position, column.waypoints, REFUGEE_KM_PER_DAY);
  }
}
