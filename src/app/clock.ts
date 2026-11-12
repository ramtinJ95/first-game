import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { Order, RejectedOrder } from '../sim/orders/orders.ts';
import { findBrokenReferences } from '../sim/references.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { System } from '../sim/systems.ts';
import { tick } from '../sim/tick.ts';
import type { World } from '../sim/world/world.ts';

export const DAYS_PER_SECOND = { 1: 1, 2: 2, 3: 5 } as const;
export type Speed = keyof typeof DAYS_PER_SECOND;

export interface ClockOptions {
  state: GameState;
  world: World;
  now: () => number;
  maxTicksPerFrame?: number;
  onRejected?: (rejected: RejectedOrder[]) => void;
  /** Tests replace the day's systems. The game runs the default list. */
  systems?: readonly System[];
}

export interface Clock {
  readonly state: DeepReadonly<GameState>;
  readonly previous: DeepReadonly<GameState>;
  readonly speed: Speed;
  readonly paused: boolean;
  readonly progress: number;
  issue(order: Order): void;
  pause(): void;
  resume(): void;
  togglePause(): void;
  setSpeed(speed: Speed): void;
  frame(): void;
  /** Replaces the game with a loaded one. Orders queued for the old game are dropped. */
  load(state: GameState): void;
}

export function createClock({
  state: initial,
  world,
  now,
  maxTicksPerFrame = 4,
  onRejected,
  systems,
}: ClockOptions): Clock {
  let state = initial;
  let previous = initial;
  let speed: Speed = 1;
  let paused = false;
  let progress = 0;
  let lastFrameAt = now();
  let pending: Order[] = [];

  function runTick() {
    const result = tick(state, pending, world, systems);
    pending = [];
    previous = state;
    state = result.state;
    if (import.meta.env.DEV) {
      const broken = findBrokenReferences(state);
      if (broken.length > 0) {
        throw new Error(`Day ${previous.day} left broken links: ${broken.join('; ')}`);
      }
    }
    if (result.rejected.length > 0) onRejected?.(result.rejected);
  }

  // Runs the days that the time since the last call has earned, at the rate it passed
  // at, so a later change of speed or pause neither rewrites that time nor leaves a
  // whole day owed. Afterwards progress is below 1.
  function catchUp() {
    const at = now();
    if (!paused) progress += ((at - lastFrameAt) * DAYS_PER_SECOND[speed]) / 1000;
    lastFrameAt = at;
    const owed = Math.floor(progress);
    const ticks = Math.min(owed, maxTicksPerFrame);
    for (let i = 0; i < ticks; i++) runTick();
    progress = owed > maxTicksPerFrame ? progress % 1 : progress - ticks;
  }

  function setPaused(next: boolean) {
    catchUp();
    paused = next;
  }

  return {
    get state() {
      return state;
    },
    get previous() {
      return previous;
    },
    get speed() {
      return speed;
    },
    get paused() {
      return paused;
    },
    get progress() {
      return progress;
    },
    issue(order) {
      pending.push(order);
    },
    pause() {
      setPaused(true);
    },
    resume() {
      setPaused(false);
    },
    togglePause() {
      setPaused(!paused);
    },
    setSpeed(next) {
      catchUp();
      speed = next;
    },
    frame() {
      catchUp();
    },
    load(next) {
      state = next;
      previous = next;
      pending = [];
      progress = 0;
      lastFrameAt = now();
    },
  };
}
