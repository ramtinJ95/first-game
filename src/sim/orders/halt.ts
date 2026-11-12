import type { ArmyId, FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import { ownedArmy } from './owned-army.ts';

export interface HaltOrder {
  kind: 'halt';
  faction: FactionId;
  army: ArmyId;
}

/** Stops a marching army where it stands. */
export function halt(state: GameState, order: HaltOrder): string | undefined {
  const army = ownedArmy(state, order.faction, order.army);
  if (typeof army === 'string') return army;
  if (army.activity.kind !== 'marching') return `army ${army.id} is not marching`;
  army.activity = { kind: 'idle', position: army.activity.position };
  return undefined;
}
