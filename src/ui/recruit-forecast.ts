import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { dailyBalances, limitsOf, GRANARY_DAYS, UPKEEP_PER_MAN } from '../sim/systems/economy.ts';
import { TROOPS, type Troop } from '../sim/troops.ts';
import { whole } from '../app/names.ts';
import { afterWaiting } from './buildings-text.ts';
import { signed } from './describe.ts';

export function recruitForecast(
  game: DeepReadonly<GameState>,
  pending: readonly Order[],
  troop: Troop,
  daysToMuster = TROOPS[troop].recruit.days,
) {
  const waiting = afterWaiting(game, pending);
  const balance = dailyBalances(waiting).get(game.player);
  const stores = waiting.factions[game.player]?.stores;
  if (!balance || !stores) throw new Error('Recruit forecast needs the player faction');
  const cost = TROOPS[troop].recruit;
  const schedule = Object.values(waiting.cities)
    .filter((city) => city.owner === game.player)
    .flatMap((city) =>
      city.recruits.map((r) => ({
        inDays: Math.max(0, r.readyOn - game.day),
        men: TROOPS[r.troop].recruit.men,
      })),
    );
  schedule.push({ inDays: daysToMuster, men: cost.men });
  schedule.sort((a, b) => a.inDays - b.inDays);
  const training = schedule.reduce((sum, recruit) => sum + recruit.men, 0);
  const upkeep = {
    food: cost.men * UPKEEP_PER_MAN.food,
    gold: cost.men * UPKEEP_PER_MAN.gold,
  };
  const after = {
    food: balance.food - training * UPKEEP_PER_MAN.food,
    gold: balance.gold - training * UPKEEP_PER_MAN.gold,
  };
  const limits = limitsOf(waiting).get(game.player);
  if (!limits) throw new Error('Recruit forecast needs the player stores limits');
  const lasts = {
    food: daysUntilShort(
      stores.food,
      balance.food,
      limits.food,
      UPKEEP_PER_MAN.food,
      GRANARY_DAYS * UPKEEP_PER_MAN.food,
      schedule,
    ),
    gold: daysUntilShort(
      stores.gold - cost.gold,
      balance.gold,
      limits.gold,
      UPKEEP_PER_MAN.gold,
      0,
      schedule,
    ),
  };
  const warnings = (['food', 'gold'] as const).flatMap((key) => {
    if (after[key] >= 0) return [];
    return [
      `${key === 'food' ? 'Food' : 'Gold'} shortfall: stores run short in about ${whole(lasts[key] ?? 0)} days with this order.`,
    ];
  });
  return {
    upkeep,
    after,
    lasts,
    warning: warnings.length
      ? `${warnings.join(' ')} Formations desert when stores run out. Raise fewer troops or improve income first.`
      : undefined,
    text: `Upkeep ${signed(-upkeep.food)} food, ${signed(-upkeep.gold)} gold/day. Realm after all recruits muster: ${signed(after.food)} food, ${signed(after.gold)} gold/day.`,
  };
}

/** Fixed-yield runway, with upkeep starting on each muster day and gains capped as in the economy. */
function daysUntilShort(
  amount: number,
  change: number,
  limit: number,
  upkeep: number,
  capPerMan: number,
  schedule: readonly { inDays: number; men: number }[],
): number | undefined {
  let elapsed = 0;
  for (const recruit of schedule) {
    const days = recruit.inDays - elapsed;
    if (amount < 0) return elapsed;
    if (change < 0 && amount + days * change < 0) return elapsed + Math.floor(amount / -change) + 1;
    amount =
      change > 0
        ? Math.max(amount, Math.min(limit, amount + days * change))
        : amount + days * change;
    elapsed = recruit.inDays;
    change -= recruit.men * upkeep;
    limit += recruit.men * capPerMan;
  }
  if (amount < 0) return elapsed;
  return change < 0 ? elapsed + Math.floor(amount / -change) + 1 : undefined;
}
