import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { DayEvent } from '../sim/events.ts';
import type { ArmyId } from '../sim/ids.ts';
import type { Order, OrderKind, RejectedOrder } from '../sim/orders/orders.ts';
import { findBrokenReferences } from '../sim/references.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { System } from '../sim/systems.ts';
import { tick } from '../sim/tick.ts';
import type { World } from '../sim/world/world.ts';

export const DAYS_PER_SECOND = { 1: 1, 2: 2, 3: 5 } as const;
export type Speed = keyof typeof DAYS_PER_SECOND;

type Slot = 'movement' | 'stance';

/**
 * The slot of its army that each kind of order fills. An army keeps one waiting order
 * per slot, so the latest order replaces the one before it. Orders that name no army
 * have no slot and wait side by side.
 */
const SLOTS: {
  [K in OrderKind]: Extract<Order, { kind: K }> extends { army: ArmyId } ? Slot : undefined;
} = {
  moveArmy: 'movement',
  halt: 'movement',
  embark: 'movement',
  retreat: 'movement',
  setStance: 'stance',
  recruit: undefined,
  declareWar: undefined,
  evacuate: undefined,
  storm: undefined,
  sack: undefined,
  enslave: undefined,
  build: undefined,
  cancelBuilding: undefined,
  offerPeace: undefined,
  acceptPeace: undefined,
  refusePeace: undefined,
};

/** The army whose movement the order changes, or nothing for an order of another slot. */
export function movedArmy(order: Order): ArmyId | undefined {
  return SLOTS[order.kind] === 'movement' && 'army' in order ? order.army : undefined;
}

function slotOf(order: Order): string | undefined {
  const slot = SLOTS[order.kind];
  return slot && 'army' in order ? `${slot} ${order.army}` : undefined;
}

export interface ClockOptions {
  state: GameState;
  world: World;
  now: () => number;
  maxTicksPerFrame?: number;
  onRejected?: (rejected: RejectedOrder[]) => void;
  /** Called after every tick with the day before, the day after it, and what happened between. */
  onDay?: (
    before: DeepReadonly<GameState>,
    after: DeepReadonly<GameState>,
    events: readonly DayEvent[],
  ) => void;
  /** Tests replace the day's systems. The game runs the default list. */
  systems?: readonly System[];
  /** The orders the factions the player does not run give on a day, added to that day's tick after the player's. */
  decide?: (state: DeepReadonly<GameState>) => Order[];
}

export interface Clock {
  readonly state: DeepReadonly<GameState>;
  readonly previous: DeepReadonly<GameState>;
  readonly speed: Speed;
  readonly paused: boolean;
  readonly progress: number;
  /** Orders issued since the last tick, in the order they will apply. */
  readonly pending: readonly Order[];
  /** Queues the order for the next tick, in place of a waiting order for the same slot of its army. */
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
  onDay,
  systems,
  decide,
}: ClockOptions): Clock {
  let state = initial;
  let previous = initial;
  let speed: Speed = 1;
  let paused = false;
  let progress = 0;
  let lastFrameAt = now();
  let pending: Order[] = [];

  function runTick() {
    const orders = decide ? [...pending, ...decide(state)] : pending;
    const result = tick(state, orders, world, systems);
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
    onDay?.(previous, state, result.events);
  }

  // Runs the days that the time since the last call has earned, at the rate it passed
  // at, so a later change of speed neither rewrites that time nor leaves a whole day
  // owed. A day whose news pauses the clock is the last one run, so the game stops on
  // the day that asked. Afterwards progress is below 1.
  function catchUp() {
    const at = now();
    if (!paused) progress += ((at - lastFrameAt) * DAYS_PER_SECOND[speed]) / 1000;
    lastFrameAt = at;
    const owed = Math.floor(progress);
    const ticks = Math.min(owed, maxTicksPerFrame);
    let ran = 0;
    while (ran < ticks && !paused) {
      runTick();
      ran += 1;
    }
    progress = owed > ran ? progress % 1 : progress - ran;
  }

  // The player pauses on the day the last frame showed, so the time since that frame
  // runs no day. A frame held back by a slow page would otherwise run its days now.
  function setPaused(next: boolean) {
    if (next === paused) return;
    lastFrameAt = now();
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
    get pending() {
      return pending;
    },
    issue(order) {
      const slot = slotOf(order);
      const kept = slot === undefined ? pending : pending.filter((o) => slotOf(o) !== slot);
      pending = [...kept, order];
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
