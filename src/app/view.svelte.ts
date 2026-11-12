import { flushSync } from 'svelte';
import type { Pick } from '../render/pick.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { Sight } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import type { Alert } from './alerts.ts';
import type { Speed } from './clock.ts';
import type { OrderMenu } from './command.ts';

/** A choice of orders offered at a right click, at its place on the screen. */
export interface CommandMenu extends OrderMenu {
  readonly screen: MapPoint;
}

/** A short message for the player, such as why the rules refused an order. */
export interface Notice {
  readonly id: number;
  readonly text: string;
}

export interface Snapshot {
  state: DeepReadonly<GameState>;
  speed: Speed;
  paused: boolean;
  /** What the player last clicked on the map. It is page state, not game state. */
  selection: Pick | undefined;
  /** Orders waiting for the next tick, which a pause holds back. */
  pending: readonly Order[];
  /** The latest alerts, newest first. They are page state, worked out from the days. */
  alerts: readonly Alert[];
  notice: Notice | undefined;
  menu: CommandMenu | undefined;
  /** What the player sees. A panel or an alert shows nothing outside it. */
  sight: Sight;
}

export interface View {
  readonly current: Snapshot;
  refresh(): void;
  destroy(): void;
}

/** Measures kept under one name before the oldest are dropped. */
const MEASURES_KEPT = 200;

/**
 * The one way panels read the live state, republished about ten times a second. With
 * `timing`, each republish also updates the panels at once and records how long that
 * took as a user-timing measure of that name, which a test or a profiler can read.
 */
export function createView(read: () => Snapshot, intervalMs = 100, timing?: string): View {
  // Raw state is never proxied, so the big plain state tree reaches panels untouched.
  let current = $state.raw(read());
  const refresh = () => {
    current = read();
  };
  const publish = () => {
    if (!timing) return refresh();
    const start = performance.now();
    refresh();
    flushSync();
    performance.measure(timing, { start, end: performance.now() });
    if (performance.getEntriesByName(timing).length > MEASURES_KEPT) {
      performance.clearMeasures(timing);
    }
  };
  const timer = setInterval(publish, intervalMs);
  return {
    get current() {
      return current;
    },
    refresh,
    destroy() {
      clearInterval(timer);
    },
  };
}
