import { STARTING_POPULATION } from '../src/sim/new-game.ts';
import { removeRecord } from '../src/sim/records.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { landPath } from '../src/sim/march.ts';
import { sightOf } from '../src/sim/sight.ts';
import type { Army } from '../src/sim/state/army.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import { tick } from '../src/sim/tick.ts';
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
/**
 * The new game of seed 1 with its minor cities as plain as before they differed: no
 * standing army and the plain population. Names are placed by population and keep clear
 * of banners, and these tests click beside a name or away from every name.
 */
export function plainGame(): GameState {
  const state = startGame();
  for (const army of Object.values(state.armies)) {
    if (state.factions[army.owner]?.kind !== 'minor') continue;
    for (const id of army.formations) removeRecord(state.formations, id);
    removeRecord(state.armies, army.id);
  }
  for (const city of Object.values(state.cities)) {
    if (city.rank === 'minorCity') city.population = STARTING_POPULATION.minorCity;
  }
  return state;
}

export function romeWithPunicArmyAt(at: MapPoint): GameState {
  const state = plainGame();
  armyOf(state, carthage).activity = { kind: 'idle', position: at };
  return state;
}

export function romeSees(state: GameState, point: MapPoint): boolean {
  return sightOf(state, world, state.player).sees(point);
}

/**
 * The first day on which `holds` is true of the game played on from `state` as the page
 * plays it with no orders from the player: with the faction AI's orders each day.
 */
export function firstDayWhen(state: GameState, holds: (state: GameState) => boolean): number {
  let current = structuredClone(state);
  for (let days = 0; days < 100; days++) {
    if (holds(current)) return current.day;
    current = tick(current, decideAll(current, world), world).state;
  }
  throw new Error('the game never reached the state within 100 days');
}

export function romeSeesArmy(state: GameState, army: Army): boolean {
  return sightOf(state, world, state.player).armies.has(army.id);
}
