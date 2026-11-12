import type { Pick } from '../render/pick.ts';
import type { Sight } from '../sim/sight.ts';
import type { Alert } from './alerts.ts';

/** Whether the player sees what a pick points at. Provinces and their cities are always known. */
export function seesPick(sight: Sight, pick: Pick | undefined): boolean {
  if (pick?.kind === 'army') return sight.armies.has(pick.army);
  if (pick?.kind === 'battle') return sight.battles.has(pick.battle);
  return true;
}

/**
 * The alerts about things the player saw on one of the two days. An alert that points
 * at an army or a battle needs that thing in sight, and one that points only at a
 * place needs the place in sight.
 */
export function alertsInSight(alerts: readonly Alert[], before: Sight, after: Sight): Alert[] {
  return alerts.filter(({ focus }) => {
    if (!focus) return true;
    if (focus.select) return seesPick(after, focus.select) || seesPick(before, focus.select);
    return after.sees(focus.at) || before.sees(focus.at);
  });
}
