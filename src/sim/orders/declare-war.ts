import { emit } from '../events.ts';
import { removeRecord } from '../records.ts';
import type { FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import { warKey, newWar } from '../state/war.ts';
import { truceBetween } from '../peace/truce.ts';
import { areAtWar } from '../wars.ts';

export interface DeclareWarOrder {
  kind: 'declareWar';
  faction: FactionId;
  against: FactionId;
}

export function declareWar(state: GameState, order: DeclareWarOrder): string | undefined {
  const against = Object.hasOwn(state.factions, order.against)
    ? state.factions[order.against]
    : undefined;
  if (!against) return `faction ${order.against} does not exist`;
  if (against.defeatedOn !== null) return `faction ${order.against} is out of the game`;
  if (order.against === order.faction)
    return `faction ${order.faction} cannot declare war on itself`;
  if (areAtWar(state, order.faction, order.against)) {
    return `${order.faction} is already at war with ${order.against}`;
  }
  const truce = truceBetween(state, order.faction, order.against);
  if (truce) {
    return `${order.faction} keeps a truce with ${order.against} until day ${truce.endsOn}`;
  }
  removeRecord(state.truces, warKey(order.faction, order.against));
  state.wars[warKey(order.faction, order.against)] = newWar(
    order.faction,
    order.against,
    state.day,
  );
  emit(state, { kind: 'warDeclared', by: order.faction, against: order.against });
  return undefined;
}
