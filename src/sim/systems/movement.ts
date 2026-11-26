import { advanceAlong, marchKmAt, REFUGEE_KM_PER_DAY, sailKmAt } from '../march.ts';
import { removeRecord } from '../records.ts';
import type { GameState } from '../state/game-state.ts';

/**
 * Moves every marching or retreating army, convoy, and refugee column one day along
 * the path it already holds. An army that arrives stands idle, except one whose march ends
 * in a crossing, which stands on the last point of its march for `embarkation`. A convoy waits on its shore
 * until the day it sails. One that arrives lands its armies at the harbour, each to march on
 * along the land path it embarked with or to stand idle, and is gone. A column stays where it arrives.
 */
export function movement(state: GameState): void {
  for (const army of Object.values(state.armies)) {
    const { activity } = army;
    if (activity.kind !== 'marching' && activity.kind !== 'retreating') continue;
    const km = marchKmAt(state, army.owner, activity.position);
    const position = advanceAlong(activity.position, activity.waypoints, km);
    activity.position = position;
    if (activity.waypoints.length > 0) continue;
    if (activity.kind === 'marching' && activity.sail) activity.waypoints = [{ ...position }];
    else army.activity = { kind: 'idle', position };
  }
  for (const convoy of Object.values(state.convoys)) {
    if (convoy.departsOn !== undefined && state.day < convoy.departsOn) continue;
    const km = sailKmAt(state, convoy.owner, convoy.position);
    convoy.position = advanceAlong(convoy.position, convoy.waypoints, km);
    if (convoy.waypoints.length > 0) continue;
    for (const id of convoy.armies) {
      const army = state.armies[id];
      if (army?.activity.kind !== 'embarked') continue;
      const position = { ...convoy.position };
      const { march } = army.activity;
      army.activity = march
        ? { kind: 'marching', position, waypoints: march }
        : { kind: 'idle', position };
    }
    removeRecord(state.convoys, convoy.id);
  }
  for (const column of Object.values(state.refugeeColumns)) {
    if (column.waypoints.length === 0) continue;
    column.position = advanceAlong(column.position, column.waypoints, REFUGEE_KM_PER_DAY);
  }
}
