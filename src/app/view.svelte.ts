import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { Speed } from './clock.ts';

export interface Snapshot {
  state: DeepReadonly<GameState>;
  speed: Speed;
  paused: boolean;
}

export interface View {
  readonly current: Snapshot;
  refresh(): void;
  destroy(): void;
}

/** The one way panels read the live state, republished about ten times a second. */
export function createView(read: () => Snapshot, intervalMs = 100): View {
  // Raw state is never proxied, so the big plain state tree reaches panels untouched.
  let current = $state.raw(read());
  const refresh = () => {
    current = read();
  };
  const timer = setInterval(refresh, intervalMs);
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
