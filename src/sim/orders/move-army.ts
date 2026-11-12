import { removeBesieger } from '../armies.ts';
import type { ArmyId, FactionId } from '../ids.ts';
import { busyReason, startMarch } from '../march.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import type { World } from '../world/world.ts';
import { ownedArmy } from './owned-army.ts';

export interface MoveArmyOrder {
  kind: 'moveArmy';
  faction: FactionId;
  army: ArmyId;
  to: MapPoint;
}

/**
 * Sets the army marching along a land path to the point, in place of any march it was
 * on. A besieging army leaves its siege once its march has a path.
 */
export function moveArmy(state: GameState, order: MoveArmyOrder, world: World): string | undefined {
  const army = ownedArmy(state, order.faction, order.army);
  if (typeof army === 'string') return army;
  if (!Number.isFinite(order.to.x) || !Number.isFinite(order.to.y)) {
    return `destination ${order.to.x}, ${order.to.y} is not a point on the map`;
  }
  const { activity } = army;
  if (activity.kind !== 'idle' && activity.kind !== 'marching' && activity.kind !== 'besieging') {
    return busyReason(army);
  }
  const reason = startMarch(world, army, activity.position, order.to);
  if (reason === undefined && activity.kind === 'besieging') {
    removeBesieger(state, activity.siege, army.id);
  }
  return reason;
}
