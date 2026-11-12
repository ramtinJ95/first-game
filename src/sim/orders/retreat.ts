import type { ArmyId, FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import { retreatFromBattle } from '../systems/battles.ts';
import type { World } from '../world/world.ts';
import { ownedArmy } from './owned-army.ts';

export interface RetreatOrder {
  kind: 'retreat';
  faction: FactionId;
  army: ArmyId;
}

/**
 * Pulls an army out of its battle, broken, to safety. The price is that every
 * formation loses RETREAT_LOSS of its men.
 */
export function retreat(state: GameState, order: RetreatOrder, world: World): string | undefined {
  const army = ownedArmy(state, order.faction, order.army);
  if (typeof army === 'string') return army;
  if (army.activity.kind !== 'inBattle') return `army ${army.id} is not in a battle`;
  retreatFromBattle(state, world, army, true);
  return undefined;
}
