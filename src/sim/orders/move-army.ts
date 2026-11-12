import type { ArmyId, FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { ownedArmy } from './owned-army.ts';

export interface MoveArmyOrder {
  kind: 'moveArmy';
  faction: FactionId;
  army: ArmyId;
  to: MapPoint;
}

/** Sets the army marching towards the point. The movement system walks it there. */
export function moveArmy(state: GameState, order: MoveArmyOrder): string | undefined {
  const army = ownedArmy(state, order.faction, order.army);
  if (typeof army === 'string') return army;
  const { activity } = army;
  switch (activity.kind) {
    case 'idle':
    case 'marching':
      army.activity = {
        kind: 'marching',
        position: activity.position,
        destination: { x: order.to.x, y: order.to.y },
      };
      return undefined;
    case 'inBattle':
      return `army ${army.id} is in battle ${activity.battle} and must retreat first`;
    case 'besieging':
      return `army ${army.id} is besieging and must lift siege ${activity.siege} first`;
    case 'embarked':
      return `army ${army.id} is at sea in convoy ${activity.convoy}`;
  }
}
