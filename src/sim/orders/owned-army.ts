import type { ArmyId, FactionId } from '../ids.ts';
import type { Army } from '../state/army.ts';
import type { GameState } from '../state/game-state.ts';

/** Finds an army the faction may command, or the reason it may not. */
export function ownedArmy(state: GameState, faction: FactionId, id: ArmyId): Army | string {
  const army = state.armies[id];
  if (!army) return `army ${id} does not exist`;
  if (army.owner !== faction) return `army ${id} belongs to ${army.owner}, not ${faction}`;
  return army;
}
