import type { DeepReadonly } from './deep-readonly.ts';
import type { FactionId } from './ids.ts';
import type { GameState } from './state/game-state.ts';
import { warKey } from './state/war.ts';

export function areAtWar(state: DeepReadonly<GameState>, a: FactionId, b: FactionId): boolean {
  return a !== b && Object.hasOwn(state.wars, warKey(a, b));
}
