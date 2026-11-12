import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { Order, RejectedOrder } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { tick } from '../sim/tick.ts';

export const DAYS_PER_SECOND = { 1: 1, 2: 2, 3: 5 } as const;
export type Speed = keyof typeof DAYS_PER_SECOND;

export interface ClockOptions {
  state: GameState;
  now: () => number;
  maxTicksPerFrame?: number;
  onRejected?: (rejected: RejectedOrder[]) => void;
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
}

export function createClock({
  state: initial,
  now,
  maxTicksPerFrame = 4,
  onRejected,
}: ClockOptions): Clock {
  let state = initial;
  let previous = initial;
  let speed: Speed = 1;
  let paused = false;
  let progress = 0;
  let lastFrameAt = now();
  let pending: Order[] = [];

  function runTick() {
    const result = tick(state, pending);
    pending = [];
    previous = state;
    state = result.state;
    if (result.rejected.length > 0) onRejected?.(result.rejected);
  }

  function resume() {
    if (!paused) return;
    paused = false;
    lastFrameAt = now();
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
      paused = true;
    },
    resume,
    togglePause() {
      if (paused) resume();
      else paused = true;
    },
    setSpeed(next) {
      speed = next;
    },
    frame() {
      const at = now();
      const elapsedMs = at - lastFrameAt;
      lastFrameAt = at;
      if (paused) return;
      progress += (elapsedMs * DAYS_PER_SECOND[speed]) / 1000;
      const owed = Math.floor(progress);
      const ticks = Math.min(owed, maxTicksPerFrame);
      for (let i = 0; i < ticks; i++) runTick();
      progress = owed > maxTicksPerFrame ? progress % 1 : progress - ticks;
    },
  };
}
