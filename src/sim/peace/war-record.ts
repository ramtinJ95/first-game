import type { CityId, FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import { warKey } from '../state/war.ts';

/**
 * Notes in the wars that a city passed from one faction to another. A side that held the
 * city as taken in any war gives it up. In a war between the two, a city won back is no
 * longer the other side's gain, and any other city is the new owner's.
 */
export function recordCapture(
  state: GameState,
  city: CityId,
  from: FactionId,
  to: FactionId,
): void {
  const key = from === to ? undefined : warKey(from, to);
  let wonBack = false;
  for (const [id, war] of Object.entries(state.wars)) {
    for (const [faction, side] of Object.entries(war.sides)) {
      if (faction === to || !side.taken.includes(city)) continue;
      side.taken = side.taken.filter((taken) => taken !== city);
      if (id === key) wonBack = true;
    }
  }
  const war = key && state.wars[key];
  if (war && !wonBack) war.sides[to]?.taken.push(city);
}

/** Adds men the faction lost to its wars with each of the enemies. */
export function recordLoss(
  state: GameState,
  faction: FactionId,
  enemies: readonly FactionId[],
  men: number,
): void {
  if (men <= 0) return;
  for (const enemy of enemies) {
    const record =
      enemy === faction ? undefined : state.wars[warKey(faction, enemy)]?.sides[faction];
    if (record) record.lost += men;
  }
}

/** Adds the men each faction lost today in a battle to its wars with the factions it fought there. */
export function recordBattleLosses(
  state: GameState,
  sides: readonly { factions: readonly FactionId[]; lost: ReadonlyMap<FactionId, number> }[],
): void {
  const [first, second] = sides;
  if (!first || !second) return;
  for (const [side, other] of [
    [first, second],
    [second, first],
  ] as const) {
    for (const [faction, men] of side.lost) recordLoss(state, faction, other.factions, men);
  }
}
