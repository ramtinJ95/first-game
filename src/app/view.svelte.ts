import { flushSync } from 'svelte';
import type { Pick } from '../render/pick.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { PowerId } from '../sim/map.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { Sight } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import type { Standing } from '../sim/outcome.ts';
import type { Alert, Occupied } from './alerts.ts';
import type { Speed } from './clock.ts';
import type { OrderMenu } from './command.ts';
import type { FateChoice } from './fates.ts';
import type { Modal } from './modals.ts';
import type { Panel } from './page.ts';
import type { PauseSettings } from './pauses.ts';
import type { Saved, Slot } from './saves.ts';

/** A choice of orders offered at a right click, at its place on the screen. */
export interface CommandMenu extends OrderMenu {
  readonly screen: MapPoint;
}

/** A short message for the player, such as why the rules refused an order. */
export interface Notice {
  readonly id: number;
  readonly text: string;
  /** A warning or a refusal is `bad`. What an accepted order does is `info`. */
  readonly tone: 'bad' | 'info';
}

/** The modal in front, with a fate's choices worked out for the day. */
export type ShownModal =
  | Exclude<Modal, { kind: 'fate' }>
  | (Extract<Modal, { kind: 'fate' }> & { readonly choices: readonly FateChoice[] });

/** A great power as the start screen offers it, from the map. */
export interface PowerCard {
  readonly power: PowerId;
  readonly name: string;
  readonly capital: string;
  /** Its starting cities, the capital first. */
  readonly cities: readonly string[];
}

/** The page round the game: its screens, its saves, and how far the player is from winning. */
export interface Frame {
  readonly powers: readonly PowerCard[];
  readonly modal: ShownModal | undefined;
  readonly saves: Readonly<Partial<Record<Slot, Saved>>>;
  readonly pauseOnFate: boolean;
  /** Which news stops the game, as the Game menu sets it. */
  readonly pauses: PauseSettings;
  readonly standing: Standing;
}

export interface Snapshot {
  state: DeepReadonly<GameState>;
  speed: Speed;
  paused: boolean;
  /** What the player last clicked on the map. It is page state, not game state. */
  selection: Pick | undefined;
  /** Orders waiting for the next tick, which a pause holds back. */
  pending: readonly Order[];
  /** Every alert of the game, newest first: the chronicle. It is page state, worked out from the days. */
  alerts: readonly Alert[];
  /** The panel open over the map's left side. */
  panel: Panel | undefined;
  notice: Notice | undefined;
  menu: CommandMenu | undefined;
  /** What the player sees. A panel or an alert shows nothing outside it. */
  sight: Sight;
  /** The captured cities whose fate the player settled by occupying them. */
  occupied: Occupied;
  /** The keys of the news told already, which the At peace list reads for a warning that did not stop the game. */
  told: ReadonlySet<string>;
  frame: Frame;
}

export interface View {
  readonly current: Snapshot;
  refresh(): void;
  destroy(): void;
}

function sameFields<T extends object>(a: T, b: T): boolean {
  return (Object.keys(b) as (keyof T)[]).every((key) => a[key] === b[key]);
}

/**
 * Whether a snapshot holds what the published one holds, field by field and in its frame.
 * Every panel reading the view runs again on a new snapshot, and the city panel's forecasts
 * took a fifth of the page's main thread when republished ten times a second unchanged.
 */
function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return (Object.keys(b) as (keyof Snapshot)[]).every((key) =>
    key === 'frame' ? sameFields(a.frame, b.frame) : a[key] === b[key],
  );
}

/** Measures kept under one name before the oldest are dropped. */
const MEASURES_KEPT = 200;

/**
 * The one way panels read the live state, read about ten times a second and republished
 * when it changed. With `timing`, each republish also updates the panels at once and
 * records how long that took as a user-timing measure of that name, which a test or a
 * profiler can read.
 */
export function createView(read: () => Snapshot, intervalMs = 100, timing?: string): View {
  // Raw state is never proxied, so the big plain state tree reaches panels untouched.
  let current = $state.raw(read());
  const publish = () => {
    const start = performance.now();
    const next = read();
    if (sameSnapshot(current, next)) return;
    current = next;
    if (!timing) return;
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
    refresh: publish,
    destroy() {
      clearInterval(timer);
    },
  };
}
