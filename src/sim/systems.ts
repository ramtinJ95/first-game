import type { GameState } from './state/game-state.ts';
import { advanceDay } from './systems/advance-day.ts';
import { battles } from './systems/battles.ts';
import { economy } from './systems/economy.ts';
import { population } from './systems/population.ts';
import { movement } from './systems/movement.ts';
import type { World } from './world/world.ts';
import { sieges } from './systems/sieges.ts';

/** A system changes the tick's own copy of the state in place. It may read the world. */
export type System = (state: GameState, world: World) => void;

/**
 * The systems of one day, in the order they run, after the orders: movement,
 * battles, sieges, economy, population. The day counter stays last, so every
 * system before it sees the day that is being played.
 */
export const SYSTEMS: readonly System[] = [
  movement,
  battles,
  sieges,
  economy,
  population,
  advanceDay,
];
