import { warReadiness } from '../ai/war.ts';
import { NOTICE_SHARE } from '../ai/thresholds.ts';
import type { GameState } from '../state/game-state.ts';
import { truceBetween } from '../peace/truce.ts';
import { areAtWar } from '../wars.ts';
import type { World } from '../world/world.ts';

/**
 * Keeps for each great power the day it came to stand at NOTICE_SHARE of the strength it
 * needs to declare war on the player, by the rule the AI declares by, and forgets it on a
 * day it stands lower, is at war with the player, or keeps a truce with it.
 */
export function notice(state: GameState, world: World): void {
  const player = state.player;
  for (const power of Object.values(state.factions)) {
    if (power.kind !== 'greatPower' || power.id === player) continue;
    const near =
      power.defeatedOn === null &&
      !areAtWar(state, power.id, player) &&
      !truceBetween(state, power.id, player) &&
      (warReadiness(state, world, power.id, player)?.readiness ?? 0) >= NOTICE_SHARE;
    power.noticeSince = near ? (power.noticeSince ?? state.day) : null;
  }
}
