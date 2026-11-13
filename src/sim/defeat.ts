import { removeArmy } from './armies.ts';
import type { FactionId } from './ids.ts';
import { removeRecord } from './records.ts';
import type { GameState } from './state/game-state.ts';
import { warSides } from './state/war.ts';

/**
 * Takes a faction out of the game: its armies, convoys, and refugee columns are
 * removed, its stores are emptied, and its wars, offers of peace, and truces end. The faction record stays, marked
 * with the day, so the player's faction can still be named after a loss. A battle
 * left with an empty side ends when the battles system next runs. Calling it again
 * changes nothing.
 */
export function defeatFaction(state: GameState, faction: FactionId): void {
  const record = Object.hasOwn(state.factions, faction) ? state.factions[faction] : undefined;
  if (!record) throw new Error(`faction ${faction} does not exist`);
  if (record.defeatedOn !== null) return;
  for (const convoy of Object.values(state.convoys)) {
    if (convoy.owner !== faction) continue;
    for (const id of convoy.armies) {
      const army = state.armies[id];
      if (army) removeArmy(state, army, 'defeat');
    }
    removeRecord(state.convoys, convoy.id);
  }
  for (const army of Object.values(state.armies)) {
    if (army.owner === faction) removeArmy(state, army, 'defeat');
  }
  for (const siege of Object.values(state.sieges)) {
    if (siege.besiegers.length === 0) removeRecord(state.sieges, siege.id);
  }
  for (const column of Object.values(state.refugeeColumns)) {
    if (column.owner === faction) removeRecord(state.refugeeColumns, column.id);
  }
  for (const key of Object.keys(state.wars) as (keyof GameState['wars'])[]) {
    if (warSides(key)?.includes(faction)) removeRecord(state.wars, key);
  }
  for (const key of Object.keys(state.peaceOffers) as (keyof GameState['peaceOffers'])[]) {
    if (warSides(key)?.includes(faction)) removeRecord(state.peaceOffers, key);
  }
  for (const key of Object.keys(state.truces) as (keyof GameState['truces'])[]) {
    if (warSides(key)?.includes(faction)) removeRecord(state.truces, key);
  }
  record.stores = { gold: 0, food: 0, manpower: 0 };
  record.defeatedOn = state.day;
}
