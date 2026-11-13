import type { ArmyId, FactionId } from '../ids.ts';
import type { Stance } from '../state/army.ts';
import type { GameState } from '../state/game-state.ts';
import { ownedArmy } from './owned-army.ts';

export interface SetStanceOrder {
  kind: 'setStance';
  faction: FactionId;
  army: ArmyId;
  stance: Stance;
}

export function setStance(state: GameState, order: SetStanceOrder): string | undefined {
  const army = ownedArmy(state, order.faction, order.army);
  if (typeof army === 'string') return army;
  if (army.stance !== order.stance) {
    army.stance = order.stance;
    army.stanceChangedOn = state.day;
  }
  return undefined;
}
