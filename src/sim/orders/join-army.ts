import type { DeepReadonly } from '../deep-readonly.ts';
import type { ArmyId, FactionId } from '../ids.ts';
import { removeRecord } from '../records.ts';
import type { GameState } from '../state/game-state.ts';
import { reforming } from '../systems/battles.ts';
import { RALLY_DISTANCE } from '../systems/economy.ts';
import { distance } from '../world/find-path.ts';

export interface JoinArmyOrder {
  kind: 'joinArmy';
  faction: FactionId;
  army: ArmyId;
  into: ArmyId;
}

/**
 * Why the army may not join the other army now, or undefined when it may: both are the
 * faction's, idle, not re-forming, and within RALLY_DISTANCE of each other. The order,
 * the AI, and the army panel share it.
 */
export function joinRefusal(
  state: DeepReadonly<GameState>,
  order: Omit<JoinArmyOrder, 'kind'>,
): string | undefined {
  const find = (id: ArmyId) => (Object.hasOwn(state.armies, id) ? state.armies[id] : undefined);
  const army = find(order.army);
  const into = find(order.into);
  for (const [id, each] of [
    [order.army, army],
    [order.into, into],
  ] as const) {
    if (!each) return `army ${id} does not exist`;
    if (each.owner !== order.faction) {
      return `army ${id} belongs to ${each.owner}, not ${order.faction}`;
    }
    if (each.activity.kind !== 'idle') return `army ${id} is not standing still`;
    if (reforming(state, each)) return `army ${id} is re-forming`;
  }
  if (order.army === order.into) return `army ${order.army} cannot join itself`;
  if (army?.activity.kind !== 'idle' || into?.activity.kind !== 'idle') return undefined;
  if (distance(army.activity.position, into.activity.position) > RALLY_DISTANCE) {
    return `army ${order.army} is too far from army ${order.into} to join it`;
  }
  return undefined;
}

/**
 * Puts every formation of an idle army into another idle army of its owner beside it,
 * under the better of their generals, and the joining army is gone. Neither may be
 * re-forming, so a join never cuts a re-forming short, and when their stances differ the
 * army re-forms from today, because the men who join take up its stance.
 */
export function joinArmy(state: GameState, order: JoinArmyOrder): string | undefined {
  const refusal = joinRefusal(state, order);
  if (refusal) return refusal;
  const army = state.armies[order.army];
  const into = state.armies[order.into];
  if (!army || !into) return `army ${order.army} does not exist`;
  for (const id of army.formations) {
    const formation = state.formations[id];
    if (formation) formation.army = into.id;
  }
  into.formations.push(...army.formations);
  into.generalSkill = Math.max(into.generalSkill, army.generalSkill);
  if (army.stance !== into.stance) into.stanceChangedOn = state.day;
  removeRecord(state.armies, army.id);
  return undefined;
}
