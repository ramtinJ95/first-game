import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { DayEvent } from '../sim/events.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { menOf } from '../sim/systems/economy.ts';

export const BATTLE_PAUSE_MEN = 500;
export const BATTLE_PAUSE_SHARE = 0.1;

export function importantBattle(
  game: DeepReadonly<GameState>,
  event: Extract<DayEvent, { kind: 'battleBegan' }>,
): boolean {
  const ours = event.forces
    .filter((force) => force.faction === game.player)
    .reduce((sum, force) => sum + force.men, 0);
  const total = Object.values(game.armies)
    .filter((army) => army.owner === game.player)
    .reduce((sum, army) => sum + menOf(game, army), 0);
  return ours >= BATTLE_PAUSE_MEN || (ours > 0 && ours >= total * BATTLE_PAUSE_SHARE);
}
