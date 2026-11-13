import type { FactionId } from '../ids.ts';
import { landOwnerAt, sailHome, sendHome } from '../peace/home.ts';
import type { GameState } from '../state/game-state.ts';
import { warSides } from '../state/war.ts';
import type { World } from '../world/world.ts';

/**
 * Sends the two sides of a peace home. On its day, after the day's orders, every army of
 * either side on the other's land, or marching or sailing there, turns home. On every day
 * of the truce, an idle army of either side on the other's land goes on home, so an army
 * that reached a shore takes ship. It runs first in the day, so the march home starts at once.
 */
export function homecoming(state: GameState, world: World): void {
  for (const [key, truce] of Object.entries(state.truces)) {
    const sides = truce.endsOn > state.day ? warSides(key) : undefined;
    if (sides) goHome(state, world, sides, truce.since === state.day);
  }
}

function goHome(
  state: GameState,
  world: World,
  [a, b]: readonly [FactionId, FactionId],
  today: boolean,
) {
  const other = (owner: FactionId) => (owner === a ? b : owner === b ? a : undefined);
  if (!today) {
    for (const id of Object.keys(state.armies).sort()) {
      const army = state.armies[id as keyof typeof state.armies];
      const enemy = army && other(army.owner);
      if (
        army?.activity.kind === 'idle' &&
        enemy &&
        landOwnerAt(state, army.activity.position) === enemy
      ) {
        sendHome(state, world, army);
      }
    }
    return;
  }

  for (const id of Object.keys(state.armies).sort()) {
    const army = state.armies[id as keyof typeof state.armies];
    const enemy = army && other(army.owner);
    if (!army || !enemy) continue;
    const { activity } = army;
    if (activity.kind !== 'idle' && activity.kind !== 'marching') continue;
    const end = activity.kind === 'marching' ? activity.waypoints.at(-1) : undefined;
    const onTheirLand = landOwnerAt(state, activity.position) === enemy;
    const bound = end !== undefined && landOwnerAt(state, end) === enemy;
    if (onTheirLand || bound) sendHome(state, world, army);
  }

  for (const id of Object.keys(state.convoys).sort()) {
    const convoy = state.convoys[id as keyof typeof state.convoys];
    const enemy = convoy && other(convoy.owner);
    const end = convoy?.waypoints.at(-1);
    if (convoy && enemy && end && landOwnerAt(state, end) === enemy) sailHome(state, world, convoy);
  }
}
