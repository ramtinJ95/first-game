import type { Pick } from '../render/pick.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { ArmyId, BattleId, ConvoyId, ProvinceId, RefugeeColumnId } from '../sim/ids.ts';
import type { Sight } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { Alert } from './alerts.ts';

/**
 * The pick to keep once a day has passed: an army that joined another army is picked as
 * the army that holds its formations now, and any other pick stays as it was.
 */
export function followJoin(
  before: DeepReadonly<GameState> | undefined,
  after: DeepReadonly<GameState>,
  pick: Pick | undefined,
): Pick | undefined {
  if (!before || pick?.kind !== 'army' || Object.hasOwn(after.armies, pick.army)) return pick;
  const was = Object.hasOwn(before.armies, pick.army) ? before.armies[pick.army] : undefined;
  const into = was?.formations
    .map((id) => (Object.hasOwn(after.formations, id) ? after.formations[id]?.army : undefined))
    .find((army): army is ArmyId => army !== undefined && Object.hasOwn(after.armies, army));
  const owner = into && after.armies[into]?.owner;
  return into && owner === was?.owner ? { kind: 'army', army: into } : pick;
}

/** Whether the player sees what a pick points at. Provinces and their cities are always known. */
export function seesPick(sight: Sight, pick: Pick | undefined): boolean {
  if (pick?.kind === 'army') return sight.armies.has(pick.army);
  if (pick?.kind === 'battle') return sight.battles.has(pick.battle);
  return true;
}

/**
 * The alerts about things the player saw on one of the two days. An alert that points
 * at an army or a battle needs that thing in sight, and one that points only at a
 * place needs the place in sight. An alert about a battle or an army that is gone is
 * also kept when the player saw it the day before.
 */
export function alertsInSight(alerts: readonly Alert[], before: Sight, after: Sight): Alert[] {
  return alerts.filter(({ focus, seenAs }) => {
    if (seenAs && seesPick(before, seenAs)) return true;
    if (!focus) return true;
    if (focus.select) return seesPick(after, focus.select) || seesPick(before, focus.select);
    return after.sees(focus.at) || before.sees(focus.at);
  });
}

/**
 * What a defeated player sees while they watch on: the whole map, every army, convoy,
 * column, and battle, as the game shows it with the fog off.
 */
export function sightOfAll(state: DeepReadonly<GameState>): Sight {
  return {
    faction: state.player,
    provinces: new Set(Object.keys(state.provinces) as ProvinceId[]),
    circles: [],
    armies: new Set(Object.keys(state.armies) as ArmyId[]),
    convoys: new Set(Object.keys(state.convoys) as ConvoyId[]),
    refugeeColumns: new Set(Object.keys(state.refugeeColumns) as RefugeeColumnId[]),
    battles: new Set(Object.keys(state.battles) as BattleId[]),
    sees: () => true,
  };
}
