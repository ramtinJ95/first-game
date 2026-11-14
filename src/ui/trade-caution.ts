import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { limitsOf } from '../sim/systems/economy.ts';

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
  const names = full.map((owner) =>
    owner === game.player ? 'Your treasury' : `${game.factions[owner]?.name}'s treasury`,
  );
  return `${names.join(' and ')} ${full.length > 1 ? 'are' : 'is'} full now. Opening spends gold and raises the limit, but later receipts above the limit are lost. Spend to keep earning.`;
}
