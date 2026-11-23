import type { DeepReadonly } from '../deep-readonly.ts';
import type { FactionId } from '../ids.ts';
import type { Stores } from '../state/faction.ts';
import type { GameState } from '../state/game-state.ts';
import { dailyBalances, limitsOf } from '../systems/economy.ts';
import type { AdvanceKind } from './advances.ts';

/** What one advance would change for a realm, by the rules as they stand today. */
export interface AdvanceGain {
  /** The realm's daily gold, food, and manpower. */
  readonly daily: Stores;
  /** The realm's most gold, food, and manpower. */
  readonly limits: Stores;
}

const NONE: Stores = { gold: 0, food: 0, manpower: 0 };

/**
 * Plays the realm with and without the advance through the rules' own sums, so a panel,
 * the AI, and a script read the same numbers the economy uses.
 */
export function advanceGain(
  state: DeepReadonly<GameState>,
  faction: FactionId,
  kind: AdvanceKind,
): AdvanceGain {
  const without = withAdvances(state, faction, (advances) => advances.filter((a) => a !== kind));
  const withIt = withAdvances(state, faction, (advances) => [
    ...advances.filter((a) => a !== kind),
    kind,
  ]);
  const minus = (a: Stores, b: Stores): Stores => ({
    gold: a.gold - b.gold,
    food: a.food - b.food,
    manpower: a.manpower - b.manpower,
  });
  return {
    daily: minus(
      dailyBalances(withIt).get(faction) ?? NONE,
      dailyBalances(without).get(faction) ?? NONE,
    ),
    limits: minus(limitsOf(withIt).get(faction) ?? NONE, limitsOf(without).get(faction) ?? NONE),
  };
}

function withAdvances(
  state: DeepReadonly<GameState>,
  faction: FactionId,
  change: (advances: readonly AdvanceKind[]) => AdvanceKind[],
): DeepReadonly<GameState> {
  const record = state.factions[faction];
  if (!record) return state;
  return {
    ...state,
    factions: { ...state.factions, [faction]: { ...record, advances: change(record.advances) } },
  };
}
