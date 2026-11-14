import type { GameState } from './state/game-state.ts';
import { advanceDay } from './systems/advance-day.ts';
import { battles } from './systems/battles.ts';
import { construction } from './systems/construction.ts';
import { economy } from './systems/economy.ts';
import { homecoming } from './systems/homecoming.ts';
import { population } from './systems/population.ts';
import { movement } from './systems/movement.ts';
import type { World } from './world/world.ts';
import { sieges } from './systems/sieges.ts';
import { trade } from './systems/trade.ts';

/** A system changes the tick's own copy of the state in place. It may read the world. */
export type System = (state: GameState, world: World) => void;

/**
 * The systems of one day, in the order they run, after the orders: the homecoming of a
 * peace made today, movement, battles, sieges, economy, construction, population. The day counter stays last, so every
 * system before it sees the day that is being played.
 */
export const SYSTEMS: readonly System[] = [
  homecoming,
  movement,
  battles,
  sieges,
  economy,
  trade,
  construction,
  population,
  advanceDay,
];
