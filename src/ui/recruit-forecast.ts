import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { dailyBalances, limitsOf, GRANARY_DAYS, UPKEEP_PER_MAN } from '../sim/systems/economy.ts';
import { TROOPS, type Troop } from '../sim/troops.ts';
import { dateText, whole } from '../app/names.ts';
import { afterWaiting } from './buildings-text.ts';
import { signed } from './describe.ts';
import type { World } from '../sim/world/world.ts';
import { YEARLY_GROWTH } from '../sim/systems/population.ts';
import { BUILDINGS } from '../sim/buildings/buildings.ts';
import { buildRefusal } from '../sim/buildings/build.ts';
import type { CityId } from '../sim/ids.ts';

export function recruitForecast(
  game: DeepReadonly<GameState>,
  pending: readonly Order[],
  world: World,
  troop?: Troop,
  daysToMuster = troop ? TROOPS[troop].recruit.days : 0,
  at?: CityId,
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
  const queued = [...schedule];
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
  type Plan = readonly Muster[];
  const byDay = (plan: Plan) => [...plan].sort((a, b) => a.inDays - b.inDays);
  const shortWith = (plan: Plan, paysOn?: number) => ({
    food: daysUntilShort(
      stores.food,
      balance.food,
      limits.food,
      UPKEEP_PER_MAN.food,
      GRANARY_DAYS * UPKEEP_PER_MAN.food,
      plan,
      yearly.food,
    ),
    gold: daysUntilShort(
      stores.gold - (paysOn === undefined ? cost.gold : 0),
      balance.gold,
      limits.gold,
      UPKEEP_PER_MAN.gold,
      0,
      paysOn === undefined ? plan : byDay([...plan, { inDays: paysOn, men: 0, pay: cost.gold }]),
      yearly.gold,
    ),
  });
  const short = shortWith(schedule);
  const holdsAfter =
    troop && (short.food !== undefined || short.gold !== undefined)
      ? firstWait(Math.max(0, ...queued.map((r) => r.inDays)), (wait) => {
          // The delayed order pays its gold on the day it is given, while the treasury may have refilled to its limit.
          const later = shortWith(
            byDay([...queued, { inDays: daysToMuster + wait, men: cost.men }]),
            wait,
          );
          return later.food === undefined && later.gold === undefined;
        })
      : undefined;
  const withCanal = (plan: Plan, paysOn?: number) =>
    daysUntilShort(
      stores.food,
      balance.food,
      limits.food,
      UPKEEP_PER_MAN.food,
      GRANARY_DAYS * UPKEEP_PER_MAN.food,
      byDay([...plan, { inDays: BUILDINGS.canals.days, men: 0, gain: BUILDINGS.canals.food }]),
      yearly.food,
    ) === undefined &&
    daysUntilShort(
      stores.gold - BUILDINGS.canals.gold - (paysOn === undefined ? cost.gold : 0),
      balance.gold,
      limits.gold,
      UPKEEP_PER_MAN.gold,
      0,
      paysOn === undefined ? plan : byDay([...plan, { inDays: paysOn, men: 0, pay: cost.gold }]),
      yearly.gold,
    ) === undefined;
  const site = troop && short.food !== undefined ? canalSite(waiting, at) : undefined;
  const canalWait = !site
    ? undefined
    : withCanal(byDay([...queued, { inDays: daysToMuster, men: cost.men }]))
      ? 0
      : firstWait(Math.max(BUILDINGS.canals.days, ...queued.map((r) => r.inDays)), (wait) =>
          withCanal(byDay([...queued, { inDays: daysToMuster + wait, men: cost.men }]), wait),
        );
  const canal =
    site && canalWait !== undefined && canalWait < (holdsAfter ?? Infinity)
      ? `Or build Canals at ${site.name} for ${whole(BUILDINGS.canals.gold)} gold, which grow ${BUILDINGS.canals.food} more food a day once built in ${BUILDINGS.canals.days} days: with them these men are fed if raised ${canalWait === 0 ? 'now' : `in about ${whole(canalWait)} days, on ${dateText(game.day + canalWait)}`}.`
      : undefined;
  const warnings = (['food', 'gold'] as const).flatMap((key) => {
    const days = short[key];
    if (days === undefined) return [];
    return [
      `${key === 'food' ? 'Food' : 'Gold'} shortfall: stores last about ${whole(daysLeft(days))} days with this order.`,
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
            ? `about ${whole(daysLeft(days))} days left as the people grow`
            : flat !== undefined
              ? `stores last about ${whole(daysLeft(flat))} days at today's yields, but the people's growth closes the gap first`
              : 'not running short',
      };
    }),
    holdsAfter,
    canal,
    named:
      holdsAfter === undefined ? undefined : realmFor(waiting, game.day, game.day + holdsAfter),
    warning: warnings.length
      ? `${warnings.join(' ')} Formations desert when stores run out. ${
          holdsAfter === undefined
            ? 'Raise fewer troops or improve income first.'
            : `Stores grow while you wait: raised in about ${whole(holdsAfter)} days, on ${dateText(game.day + holdsAfter)}, these men are fed as the people grow, ${
                short.gold === undefined
                  ? 'if you raise no other troops and lose no city before then'
                  : 'if you raise no other troops, spend no gold, and your income holds until then, though trade gold comes as each caravan arrives and can move the day by some weeks'
              }. Raise now only if you need them sooner.`
        }`
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

/** Full days of stores before the day they run short, as the top bar counts them. */
const daysLeft = (shortOn: number) => Math.max(0, shortOn - 1);

/** A recruit's start of upkeep, for a raise not yet ordered the gold it pays that day, and for a building the food a day it adds from then. */
interface Muster {
  inDays: number;
  men: number;
  pay?: number;
  gain?: number;
}

/** The player's city where Canals could be started today: the one named, else the first other by id. */
function canalSite(state: DeepReadonly<GameState>, at: CityId | undefined) {
  const own = Object.values(state.cities)
    .filter((city) => city.owner === state.player)
    .sort((a, b) => (a.id === at ? -1 : b.id === at ? 1 : a.id < b.id ? -1 : 1));
  return own.find((city) => buildRefusal(state, city, 'canals') === undefined);
}

/** The longest wait the warning names; a raise that needs longer waits for better income instead. */
const MAX_WAIT = 3650;

/**
 * The fewest days to wait before the raise holds, or undefined if it does not within MAX_WAIT.
 * Until the last queued recruit musters, a later muster can lose granary room the stores needed,
 * so those days are each tried; after it, waiting only adds stores and people, and halving finds the day.
 */
function firstWait(queuedUntil: number, holds: (wait: number) => boolean): number | undefined {
  const tried = Math.min(queuedUntil, MAX_WAIT);
  for (let wait = 1; wait <= tried; wait++) if (holds(wait)) return wait;
  if (!holds(MAX_WAIT)) return undefined;
  let low = tried;
  let high = MAX_WAIT;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (holds(middle)) high = middle;
    else low = middle;
  }
  return high;
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
  schedule: readonly Muster[],
  yearly = { change: 0, limit: 0 },
): number | undefined {
  if (amount < 0) return 0;
  const grown = (day: number) => (DAILY ** (day - 1) - 1) / YEARLY_GROWTH;
  let next = 0;
  for (let day = 1; ; day++) {
    while (next < schedule.length && (schedule[next]?.inDays ?? Infinity) < day) {
      const men = schedule[next]?.men ?? 0;
      amount -= schedule[next]?.pay ?? 0;
      change += (schedule[next]?.gain ?? 0) - men * upkeep;
      limit += men * capPerMan;
      next++;
    }
    // An order is paid before the day's income comes in, so it must be affordable then.
    if (amount < 0) return day;
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

/** What a warned card named, and the realm it counted on then, so a later reading can say what moved the day. */
export interface NamedWait {
  /** The day the card said it. */
  readonly on: number;
  /** The day it named for the raise. */
  readonly named: number;
  /** Men under arms and in training, by troop. */
  readonly men: Readonly<Partial<Record<Troop, number>>>;
  readonly cities: readonly string[];
}

function realmFor(state: DeepReadonly<GameState>, on: number, named: number): NamedWait {
  const men: Partial<Record<Troop, number>> = {};
  const add = (troop: Troop, count: number) => (men[troop] = (men[troop] ?? 0) + count);
  for (const army of Object.values(state.armies))
    if (army.owner === state.player)
      for (const id of army.formations) {
        const formation = state.formations[id];
        if (formation) add(formation.troop, formation.men);
      }
  const cities = Object.values(state.cities).filter((city) => city.owner === state.player);
  for (const city of cities)
    for (const recruit of city.recruits) add(recruit.troop, TROOPS[recruit.troop].recruit.men);
  return { on, named, men, cities: cities.map((city) => city.name).sort() };
}

/** A named day this much later than the one a card named before is told as moved. */
export const MOVED_DAYS = 30;

/**
 * Why the day a warned card names now is later than the one it named before: the troops
 * raised since, which are fed first, and the cities lost since, by the realm each reading
 * counted on. Undefined while the day holds within MOVED_DAYS.
 */
export function movedText(
  before: NamedWait,
  now: NamedWait,
  names: Readonly<Record<Troop, string>>,
): string | undefined {
  if (now.named - before.named <= MOVED_DAYS) return undefined;
  const raised = (Object.keys(TROOPS) as Troop[]).flatMap((troop) => {
    const more = (now.men[troop] ?? 0) - (before.men[troop] ?? 0);
    return more > 0 ? [`${whole(more)} ${names[troop]}`] : [];
  });
  const lost = before.cities.filter((city) => !now.cities.includes(city));
  const why = [
    ...(raised.length ? [`you raised ${listed(raised)}, who are fed first`] : []),
    ...(lost.length ? [`you lost ${listed(lost)}`] : []),
  ];
  return `Now ${dateText(now.named)}, not ${dateText(before.named)} as this card said on ${dateText(before.on)}: ${
    why.length
      ? `since then ${why.join(', and ')}`
      : 'the stores or income it counted on changed since then'
  }.`;
}

const listed = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
