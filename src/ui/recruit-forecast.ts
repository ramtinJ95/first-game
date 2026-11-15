import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { dailyBalances, limitsOf, GRANARY_DAYS, UPKEEP_PER_MAN } from '../sim/systems/economy.ts';
import { TROOPS, type Troop } from '../sim/troops.ts';
import { whole } from '../app/names.ts';
import { afterWaiting } from './buildings-text.ts';
import { signed } from './describe.ts';
import type { World } from '../sim/world/world.ts';
import { YEARLY_GROWTH } from '../sim/systems/population.ts';

export function recruitForecast(
  game: DeepReadonly<GameState>,
  pending: readonly Order[],
  world: World,
  troop?: Troop,
  daysToMuster = troop ? TROOPS[troop].recruit.days : 0,
) {
  const waiting = afterWaiting(game, pending, world);
  const balance = dailyBalances(waiting).get(game.player);
  const stores = waiting.factions[game.player]?.stores;
  if (!balance || !stores) throw new Error('Recruit forecast needs the player faction');
  const cost = troop ? TROOPS[troop].recruit : { men: 0, gold: 0 };
  const schedule = Object.values(waiting.cities)
    .filter((city) => city.owner === game.player)
    .flatMap((city) =>
      city.recruits.map((r) => ({
        inDays: Math.max(0, r.readyOn - game.day),
        men: TROOPS[r.troop].recruit.men,
      })),
    );
  if (troop) schedule.push({ inDays: daysToMuster, men: cost.men });
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
  const grown = grownRealm(waiting);
  const grownBalance = dailyBalances(grown).get(game.player);
  const grownLimits = limitsOf(grown).get(game.player);
  if (!grownBalance || !grownLimits) throw new Error('Recruit forecast needs the grown realm');
  const yearly = {
    food: { change: grownBalance.food - balance.food, limit: grownLimits.food - limits.food },
    gold: { change: grownBalance.gold - balance.gold, limit: grownLimits.gold - limits.gold },
  };
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
  const short = {
    food: daysUntilShort(
      stores.food,
      balance.food,
      limits.food,
      UPKEEP_PER_MAN.food,
      GRANARY_DAYS * UPKEEP_PER_MAN.food,
      schedule,
      yearly.food,
    ),
    gold: daysUntilShort(
      stores.gold - cost.gold,
      balance.gold,
      limits.gold,
      UPKEEP_PER_MAN.gold,
      0,
      schedule,
      yearly.gold,
    ),
  };
  const warnings = (['food', 'gold'] as const).flatMap((key) => {
    const days = short[key];
    if (days === undefined) return [];
    return [
      `${key === 'food' ? 'Food' : 'Gold'} shortfall: stores run short in about ${whole(days)} days with this order.`,
    ];
  });
  return {
    upkeep,
    after,
    lasts,
    short,
    runway: (['food', 'gold'] as const).map((key) => {
      const days = short[key];
      const flat = lasts[key];
      return {
        key,
        name: key === 'food' ? 'Food' : 'Gold',
        urgent: days !== undefined,
        text:
          days !== undefined
            ? `about ${whole(days)} days left as the people grow`
            : flat !== undefined
              ? `short in about ${whole(flat)} days at today's yields, but the people's growth closes the gap first`
              : 'not running short',
      };
    }),
    warning: warnings.length
      ? `${warnings.join(' ')} Formations desert when stores run out. Raise fewer troops or improve income first.`
      : undefined,
    upkeepText: `Upkeep ${signed(-upkeep.food)} food, ${signed(-upkeep.gold)} gold/day`,
    balanceText: `${signed(after.food)} food, ${signed(after.gold)} gold/day`,
  };
}

/** The realm a year on: each of the player's cities grows by YEARLY_GROWTH, as the population system grows it while food lasts. */
function grownRealm(state: DeepReadonly<GameState>): DeepReadonly<GameState> {
  const cities = Object.fromEntries(
    Object.entries(state.cities).map(([id, city]) => [
      id,
      city.owner === state.player
        ? { ...city, population: city.population * (1 + YEARLY_GROWTH) }
        : city,
    ]),
  );
  return { ...state, cities } as DeepReadonly<GameState>;
}

/** The people's daily growth factor, as the population system applies it. */
const DAILY = (1 + YEARLY_GROWTH) ** (1 / 365);
/** A balance this close to zero is the rounding of income that equals upkeep, not a deficit. */
const ROUNDING = 1e-9;

/**
 * The day a store first runs short, as the economy plays it: upkeep starts on each muster
 * day and gains stop at the limit. Without `yearly`, yields stay as they are today; with it,
 * the balance and the limit grow with the people, by `yearly` for each YEARLY_GROWTH of them,
 * from the second day on as the population system grows them.
 */
function daysUntilShort(
  amount: number,
  change: number,
  limit: number,
  upkeep: number,
  capPerMan: number,
  schedule: readonly { inDays: number; men: number }[],
  yearly = { change: 0, limit: 0 },
): number | undefined {
  if (amount < 0) return 0;
  const grown = (day: number) => (DAILY ** (day - 1) - 1) / YEARLY_GROWTH;
  let next = 0;
  for (let day = 1; ; day++) {
    while (next < schedule.length && (schedule[next]?.inDays ?? Infinity) < day) {
      const men = schedule[next]?.men ?? 0;
      change -= men * upkeep;
      limit += men * capPerMan;
      next++;
    }
    const today = change + yearly.change * grown(day);
    if (next === schedule.length) {
      if (today >= -ROUNDING) return undefined;
      return fallingStores(day - 1, amount, change, yearly.change);
    }
    const cap = limit + yearly.limit * grown(day);
    amount = today > 0 ? Math.max(amount, Math.min(cap, amount + today)) : amount + today;
    if (amount < 0) return day;
  }
}

/**
 * Once every recruit has mustered and the balance is falling, no limit applies and the stores
 * follow a closed form: they fall until the growing people close the gap, so they run short
 * only if they run out before that day.
 */
function fallingStores(
  from: number,
  amount: number,
  change: number,
  gain: number,
): number | undefined {
  const at = (day: number) => {
    const days = day - from;
    if (gain === 0) return amount + days * change;
    const compound = (DAILY ** from * (DAILY ** days - 1)) / (DAILY - 1);
    return amount + days * (change - gain / YEARLY_GROWTH) + (gain / YEARLY_GROWTH) * compound;
  };
  let high =
    gain > 0
      ? Math.ceil(1 + Math.log(1 + (YEARLY_GROWTH * -change) / gain) / Math.log(DAILY)) - 1
      : from + Math.ceil(amount / -change) + 1;
  if (at(high) >= 0) return undefined;
  let low = from;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (middle === low || middle === high) break;
    if (at(middle) < 0) high = middle;
    else low = middle;
  }
  return high;
}
