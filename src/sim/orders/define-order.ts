import type { ArmyId, FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import type { World } from '../world/world.ts';

export type OrderSlot = 'movement' | 'stance';

/** The handler supplies the kind and army shape, so registration cannot drift from it. */
export function defineOrder<O extends { kind: string; faction: FactionId }>(
  kind: NoInfer<O['kind']>,
  handler: (state: GameState, order: O, world: World) => string | undefined,
  slot: O extends { army: ArmyId } ? OrderSlot : undefined,
) {
  return { kind, handler, slot };
}
