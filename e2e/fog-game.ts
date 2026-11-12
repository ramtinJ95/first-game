import type { FactionId } from '../src/sim/ids.ts';
import { landPath } from '../src/sim/march.ts';
import { sightOf } from '../src/sim/sight.ts';
import type { Army } from '../src/sim/state/army.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { armyOf, carthage, map, startGame } from './support.ts';

const world = buildWorld(map);

/** In the Ligurian hills, eight days' march north-west of Rome's sight. */
export const OUT_OF_SIGHT: MapPoint = { x: 2250, y: 1900 };
/** On the road south from there, inside the sight of Arretium. */
export const IN_SIGHT: MapPoint = { x: 2390, y: 2090 };

export const macedon = 'macedon' as FactionId;
export const egypt = 'egypt' as FactionId;

/**
 * Sets the army marching from one point to the other as a beaten army does, with every
 * formation at morale 0, so the faction AI gives it no new order on the way.
 */
export function march(state: GameState, army: Army, from: MapPoint, to: MapPoint) {
  const path = landPath(world, from, to);
  if (typeof path === 'string') throw new Error(path);
  army.activity = { kind: 'marching', position: from, waypoints: path };
  for (const id of army.formations) {
    const formation = state.formations[id];
    if (formation) formation.morale = 0;
  }
}

/** The new game as Rome, with the Punic army standing at `at`. */
export function romeWithPunicArmyAt(at: MapPoint): GameState {
  const state = startGame();
  armyOf(state, carthage).activity = { kind: 'idle', position: at };
  return state;
}

export function romeSees(state: GameState, point: MapPoint): boolean {
  return sightOf(state, world, state.player).sees(point);
}
