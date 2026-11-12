import type { ArmyId, FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import { removeEmptyFormations, RETREAT_LOSS, retreatFromBattle } from '../systems/battles.ts';
import type { World } from '../world/world.ts';
import { ownedArmy } from './owned-army.ts';

export interface RetreatOrder {
  kind: 'retreat';
  faction: FactionId;
  army: ArmyId;
}

/**
 * Pulls an army out of its battle as if it were beaten. The price is that every
 * formation loses RETREAT_LOSS of its men to the pursuit and leaves broken.
 */
export function retreat(state: GameState, order: RetreatOrder, world: World): string | undefined {
  const army = ownedArmy(state, order.faction, order.army);
  if (typeof army === 'string') return army;
  if (army.activity.kind !== 'inBattle') return `army ${army.id} is not in a battle`;
  for (const id of army.formations) {
    const formation = state.formations[id];
    if (!formation) continue;
    formation.men -= Math.round(formation.men * RETREAT_LOSS);
    formation.morale = 0;
  }
  removeEmptyFormations(state, army);
  retreatFromBattle(state, world, army);
  return undefined;
}
