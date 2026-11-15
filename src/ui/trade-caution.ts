import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { limitsOf } from '../sim/systems/economy.ts';

/**
 * A full treasury loses its own owner's receipts above the limit, and only those, so the
 * caution says whose treasury is full and who loses by it.
 */
export function tradeCaution(
  game: DeepReadonly<GameState>,
  from: DeepReadonly<City>,
  to: DeepReadonly<City>,
): string | undefined {
  const limits = limitsOf(game);
  const full = [...new Set([from.owner, to.owner])].filter((owner) => {
    const treasury = game.factions[owner]?.stores.gold;
    const limit = limits.get(owner)?.gold;
    return treasury !== undefined && limit !== undefined && treasury >= limit;
  });
  if (!full.length) return undefined;
  return full
    .map((owner) => {
      if (owner === game.player)
        return 'Your treasury is full now. Opening spends gold and raises your limit, but your later receipts above the limit are lost, so spend gold to keep earning.';
      const name = game.factions[owner]?.name ?? owner;
      return `${name}'s treasury is full now, so ${name} loses its own receipts above its limit. That costs ${name}, not you: your share of each arrival is paid in full.`;
    })
    .join(' ');
}
