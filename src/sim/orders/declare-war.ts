import { emit } from '../events.ts';
import type { FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import { warKey } from '../state/war.ts';
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
  state.wars[warKey(order.faction, order.against)] = { since: state.day };
  emit(state, { kind: 'warDeclared', by: order.faction, against: order.against });
  return undefined;
}
