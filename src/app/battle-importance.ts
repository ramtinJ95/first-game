import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { DayEvent } from '../sim/events.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { menOf } from '../sim/systems/economy.ts';

export const BATTLE_PAUSE_MEN = 500;
export const BATTLE_PAUSE_SHARE = 0.1;
/** A side with half the other's men can hurt it, as a sally that can break a siege. */
export const BATTLE_PAUSE_ODDS = 0.5;

/**
 * A battle of the player's matters by the men the enemy brings to it, not by the men of
 * the player's that stand in it: a sally of a hundred against a siege of two thousand can
 * cost a hundred men at most. It matters at BATTLE_PAUSE_MEN enemies, or below that when
 * the enemy has BATTLE_PAUSE_ODDS of the player's men in the fight and BATTLE_PAUSE_SHARE
 * of the player's men under arms, so a last small army still stops.
 */
export function importantBattle(
  game: DeepReadonly<GameState>,
  event: Extract<DayEvent, { kind: 'battleBegan' }>,
): boolean {
  const player = game.player;
  const side = event.attackers.includes(player) ? event.attackers : event.defenders;
  if (!side.includes(player)) return false;
  const men = (ours: boolean) =>
    event.forces
      .filter((force) => side.includes(force.faction) === ours)
      .reduce((sum, force) => sum + force.men, 0);
  const enemies = men(false);
  const fielded = Object.values(game.armies)
    .filter((army) => army.owner === player)
    .reduce((sum, army) => sum + menOf(game, army), 0);
  return (
    enemies >= BATTLE_PAUSE_MEN ||
    (enemies > 0 &&
      enemies >= men(true) * BATTLE_PAUSE_ODDS &&
      enemies >= fielded * BATTLE_PAUSE_SHARE)
  );
}
