import type { ArmyId, SiegeId } from './ids.ts';
import { removeRecord } from './records.ts';
import type { Army } from './state/army.ts';
import type { GameState } from './state/game-state.ts';

/**
 * Takes a besieging army off its siege's list and leaves it idle where it stands. A
 * siege left without a besieger ends when the sieges system next runs.
 */
export function leaveSiege(state: GameState, army: Army): void {
  const { activity } = army;
  if (activity.kind !== 'besieging') return;
  removeBesieger(state, activity.siege, army.id);
  army.activity = { kind: 'idle', position: activity.position };
}

/** Takes the army off the siege's list and leaves the army's activity to the caller. */
export function removeBesieger(state: GameState, siegeId: SiegeId, armyId: ArmyId): void {
  const siege = state.sieges[siegeId];
  if (siege) siege.besiegers = siege.besiegers.filter((id) => id !== armyId);
}

/** Removes an army and its formations, and takes it off its battle, siege, or convoy. */
export function removeArmy(state: GameState, army: Army): void {
  const { activity } = army;
  if (activity.kind === 'inBattle') {
    const battle = state.battles[activity.battle];
    if (battle) {
      battle.attackers = battle.attackers.filter((id) => id !== army.id);
      battle.defenders = battle.defenders.filter((id) => id !== army.id);
    }
  } else if (activity.kind === 'besieging') {
    leaveSiege(state, army);
  } else if (activity.kind === 'embarked') {
    const convoy = state.convoys[activity.convoy];
    if (convoy) convoy.armies = convoy.armies.filter((id) => id !== army.id);
  }
  for (const id of army.formations) removeRecord(state.formations, id);
  removeRecord(state.armies, army.id);
}
