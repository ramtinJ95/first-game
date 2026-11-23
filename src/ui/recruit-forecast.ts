import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { dailyBalances, limitsOf, GRANARY_DAYS, UPKEEP_PER_MAN } from '../sim/systems/economy.ts';
import { TROOPS, type Troop } from '../sim/troops.ts';
import { dateText, whole } from '../app/names.ts';
import { afterWaiting } from './buildings-text.ts';
import type { World } from '../sim/world/world.ts';
import { YEARLY_GROWTH } from '../sim/systems/population.ts';
import { BUILDINGS, type BuildingKind } from '../sim/buildings/buildings.ts';
import { buildingGain } from '../sim/buildings/gains.ts';
import type { City } from '../sim/state/city.ts';
import { beleaguered } from '../sim/systems/sieges.ts';
import { buildRefusal } from '../sim/buildings/build.ts';
import type { CityId } from '../sim/ids.ts';
import type { Stores } from '../sim/state/faction.ts';
import { signed, unrestDaysLeft } from './describe.ts';

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
  type Plan = readonly Muster[];
  const byDay = (plan: Plan) => [...plan].sort((a, b) => a.inDays - b.inDays);
  const sums = { balance, limits, grownBalance, grownLimits };
  const atWork = buildingsAtWork(waiting, sums);
  const atToday = (plan: Plan) => plan.map((muster) => ({ ...muster, growth: 0 }));
  const lasts = {
    food: daysUntilShort(
      stores.food,
      balance.food,
      limits.food,
      UPKEEP_PER_MAN.food,
      GRANARY_DAYS * UPKEEP_PER_MAN.food,
      byDay([...schedule, ...atToday(atWork.food)]),
    ),
    gold: daysUntilShort(
      stores.gold - cost.gold,
      balance.gold,
      limits.gold,
      UPKEEP_PER_MAN.gold,
      0,
      byDay([...schedule, ...atToday(atWork.gold)]),
    ),
  };
  const shortWith = (plan: Plan, paysOn?: number) => ({
    food: daysUntilShort(
      stores.food,
      balance.food,
      limits.food,
      UPKEEP_PER_MAN.food,
      GRANARY_DAYS * UPKEEP_PER_MAN.food,
      byDay([...plan, ...atWork.food]),
      yearly.food,
    ),
    gold: daysUntilShort(
      stores.gold - (paysOn === undefined ? cost.gold : 0),
      balance.gold,
      limits.gold,
      UPKEEP_PER_MAN.gold,
      0,
      byDay([
        ...plan,
        ...atWork.gold,
        ...(paysOn === undefined ? [] : [{ inDays: paysOn, men: 0, pay: cost.gold }]),
      ]),
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
  const site = troop && short.food !== undefined ? canalSite(waiting, at) : undefined;
  const canalKind = site?.kind ?? 'canals';
  const withCanal = (plan: Plan, paysOn?: number) =>
    daysUntilShort(
      stores.food,
      balance.food,
      limits.food,
      UPKEEP_PER_MAN.food,
      GRANARY_DAYS * UPKEEP_PER_MAN.food,
      byDay([
        ...plan,
        ...atWork.food,
        { inDays: BUILDINGS[canalKind].days, men: 0, gain: BUILDINGS[canalKind].food },
      ]),
      yearly.food,
    ) === undefined &&
    daysUntilShort(
      stores.gold - BUILDINGS[canalKind].gold - (paysOn === undefined ? cost.gold : 0),
      balance.gold,
      limits.gold,
      UPKEEP_PER_MAN.gold,
      0,
      byDay([
        ...plan,
        ...atWork.gold,
        ...(paysOn === undefined ? [] : [{ inDays: paysOn, men: 0, pay: cost.gold }]),
      ]),
      yearly.gold,
    ) === undefined;
  const canalWait = !site
    ? undefined
    : withCanal(byDay([...queued, { inDays: daysToMuster, men: cost.men }]))
      ? 0
      : firstWait(Math.max(BUILDINGS[canalKind].days, ...queued.map((r) => r.inDays)), (wait) =>
          withCanal(byDay([...queued, { inDays: daysToMuster + wait, men: cost.men }]), wait),
        );
  const canal =
    site && canalWait !== undefined && canalWait < (holdsAfter ?? Infinity)
      ? `Or build ${BUILDINGS[canalKind].name} at ${site.city.name} for ${whole(BUILDINGS[canalKind].gold)} gold, which grow ${BUILDINGS[canalKind].food} more food a day once built in ${BUILDINGS[canalKind].days} days: with them these men are fed if raised ${canalWait === 0 ? 'now' : `in about ${whole(canalWait)} days, on ${dateText(game.day + canalWait)}`}.`
      : undefined;
  const barracksLine = (): string | undefined => {
    const found = barracksSite(waiting, at);
    if (!found) return undefined;
    const { city: yard, kind } = found;
    const { days: built, gold: price } = BUILDINGS[kind];
    const yearlyMen = {
      change: grownBalance.manpower - balance.manpower,
      limit: grownLimits.manpower - limits.manpower,
    };
    const men = (levies: readonly Levy[]) =>
      manpowerByDay(
        stores.manpower,
        balance.manpower,
        limits.manpower,
        yearlyMen,
        levies,
        MAX_WAIT,
      );
    const food = storeByDay(
      stores.food,
      balance.food,
      limits.food,
      UPKEEP_PER_MAN.food,
      GRANARY_DAYS * UPKEEP_PER_MAN.food,
      byDay([...queued, ...atWork.food]),
      yearly.food,
      MAX_WAIT,
    );
    const gold = (extra: number) =>
      storeByDay(
        stores.gold - extra,
        balance.gold,
        limits.gold,
        UPKEEP_PER_MAN.gold,
        0,
        byDay([...queued, ...atWork.gold]),
        yearly.gold,
        MAX_WAIT,
      );
    /**
     * The first day the rules take the order, its men and gold in the stores. A store that runs
     * out before it starves or unpays men who then desert, which the days played do not foresee,
     * so no day is named past it. Whether the men are fed once raised is the warning's to say.
     */
    const firstDay = (men: readonly number[], gold: readonly number[]) => {
      for (let wait = 1; wait <= MAX_WAIT; wait++) {
        if ((gold[wait] ?? -1) < 0 || (food[wait] ?? -1) < 0) return undefined;
        if ((men[wait] ?? 0) >= cost.men && (gold[wait] ?? 0) >= cost.gold) return wait;
      }
      return undefined;
    };
    if ((gold(price)[0] ?? -1) < 0) return undefined;
    const without = firstDay(men(atWork.levies), gold(0));
    const gains = gainsOf(waiting, sums, yard, kind, built);
    const wait = firstDay(men([...atWork.levies, gains.levy]), gold(price));
    if (wait === undefined || wait >= (without ?? Infinity)) return undefined;
    const shown = buildingGain(waiting, yard, kind);
    const what = kind === 'barracks' ? 'Barracks' : `a ${BUILDINGS[kind].name}`;
    return `Or build ${what} at ${yard.name} for ${whole(price)} gold, which ${kind === 'barracks' ? 'give' : 'gives'} ${whole(shown.levy)} more men to call up and ${shown.daily.manpower.toFixed(1)} more a day once built in ${built} days: with them these men can be raised in about ${whole(wait)} days, on ${dateText(game.day + wait)}.`;
  };
  const barracks = troop && stores.manpower < cost.men ? barracksLine() : undefined;
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
    barracks,
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

/**
 * A recruit's start of upkeep, for a raise not yet ordered the gold it pays that day, and for a
 * building the store a day it adds from then, with `growth` more for each YEARLY_GROWTH of people.
 */
interface Muster {
  inDays: number;
  men: number;
  pay?: number;
  gain?: number;
  growth?: number;
}

/** The realm's sums today and a year of growth on, which a building's gains are measured against. */
interface Sums {
  readonly balance: DeepReadonly<Stores>;
  readonly limits: DeepReadonly<Stores>;
  readonly grownBalance: DeepReadonly<Stores>;
  readonly grownLimits: DeepReadonly<Stores>;
}

/** A building's manpower a day and call-up limit, from the day after its last day of work, each with its growth for each YEARLY_GROWTH of people. */
interface Levy {
  readonly inDays: number;
  readonly gain: number;
  readonly growth: number;
  readonly limit: number;
  readonly limitGrowth: number;
}

/**
 * What the building adds in the city once finished `inDays` from now: the economy's balance and
 * limits with it and without it, today and in the grown realm.
 */
function gainsOf(
  state: DeepReadonly<GameState>,
  sums: Sums,
  city: DeepReadonly<City>,
  building: BuildingKind,
  inDays: number,
): { food: Muster[]; gold: Muster[]; levy: Levy } {
  const built = {
    ...state,
    cities: {
      ...state.cities,
      [city.id]: { ...city, buildings: [...city.buildings, building], construction: null },
    },
  } as DeepReadonly<GameState>;
  const grownBuilt = grownRealm(built);
  const zero = { gold: 0, food: 0, manpower: 0 };
  const now = dailyBalances(built).get(state.player) ?? zero;
  const grown = dailyBalances(grownBuilt).get(state.player) ?? zero;
  const limit = limitsOf(built).get(state.player) ?? zero;
  const grownLimit = limitsOf(grownBuilt).get(state.player) ?? zero;
  const store = (key: 'food' | 'gold'): Muster[] => {
    const gain = now[key] - sums.balance[key];
    const growth = grown[key] - sums.grownBalance[key] - gain;
    return gain !== 0 || growth !== 0 ? [{ inDays, men: 0, gain, growth }] : [];
  };
  const gain = now.manpower - sums.balance.manpower;
  const more = limit.manpower - sums.limits.manpower;
  return {
    food: store('food'),
    gold: store('gold'),
    levy: {
      inDays,
      gain,
      growth: grown.manpower - sums.grownBalance.manpower - gain,
      limit: more,
      limitGrowth: grownLimit.manpower - sums.grownLimits.manpower - more,
    },
  };
}

/**
 * What each building at work in the player's cities adds to its food, gold, and manpower once
 * finished, from the day after its last day of work. Its days are counted on from the day the
 * city's unrest ends, as the construction system works no day of unrest. A city with an enemy at
 * its walls works none, and when the enemy leaves is not foreseen, so its building is not counted.
 */
function buildingsAtWork(state: DeepReadonly<GameState>, sums: Sums) {
  const found = { food: [] as Muster[], gold: [] as Muster[], levies: [] as Levy[] };
  for (const city of Object.values(state.cities)) {
    const work = city.construction;
    if (city.owner !== state.player || !work || beleaguered(state, city)) continue;
    const gains = gainsOf(
      state,
      sums,
      city,
      work.building,
      work.daysLeft + unrestDaysLeft(state, city),
    );
    found.food.push(...gains.food);
    found.gold.push(...gains.gold);
    found.levies.push(gains.levy);
  }
  return found;
}

/**
 * The manpower after each day from now, as the economy fills it: each day's gain stops at the
 * call-up limit, and both grow with the people from the second day on and with each building
 * from the day after its work.
 */
function manpowerByDay(
  amount: number,
  change: number,
  limit: number,
  yearly: { change: number; limit: number },
  levies: readonly Levy[],
  days: number,
): number[] {
  const grown = (day: number) => (DAILY ** (day - 1) - 1) / YEARLY_GROWTH;
  const amounts = [amount];
  for (let day = 1; day <= days; day++) {
    let today = change + yearly.change * grown(day);
    let cap = limit + yearly.limit * grown(day);
    for (const levy of levies)
      if (levy.inDays < day) {
        today += levy.gain + levy.growth * grown(day);
        cap += levy.limit + levy.limitGrowth * grown(day);
      }
    amount = today > 0 ? Math.max(amount, Math.min(cap, amount + today)) : amount + today;
    amounts.push(amount);
  }
  return amounts;
}

/**
 * A store after each day from now, as the economy plays it and as `daysUntilShort` reckons it:
 * each muster's upkeep, payment and gain from its day, gains stopping at the limit, and the
 * balance and limit growing with the people from the second day on.
 */
function storeByDay(
  amount: number,
  change: number,
  limit: number,
  upkeep: number,
  capPerMan: number,
  schedule: readonly Muster[],
  yearly: { change: number; limit: number },
  days: number,
): number[] {
  const grown = (day: number) => (DAILY ** (day - 1) - 1) / YEARLY_GROWTH;
  let growth = yearly.change;
  let next = 0;
  const amounts = [amount];
  for (let day = 1; day <= days; day++) {
    while (next < schedule.length && (schedule[next]?.inDays ?? Infinity) < day) {
      const men = schedule[next]?.men ?? 0;
      amount -= schedule[next]?.pay ?? 0;
      change += (schedule[next]?.gain ?? 0) - men * upkeep;
      growth += schedule[next]?.growth ?? 0;
      limit += men * capPerMan;
      next++;
    }
    const today = change + growth * grown(day);
    const cap = limit + yearly.limit * grown(day);
    amount = today > 0 ? Math.max(amount, Math.min(cap, amount + today)) : amount + today;
    amounts.push(amount);
  }
  return amounts;
}

/**
 * The player's city where the first level, or else the second, could be started today: the one
 * named, else the first other by id. A city that has the first level is offered its second.
 */
function siteFor<K extends BuildingKind>(
  state: DeepReadonly<GameState>,
  at: CityId | undefined,
  kinds: readonly K[],
): { city: DeepReadonly<City>; kind: K } | undefined {
  const own = Object.values(state.cities)
    .filter((city) => city.owner === state.player)
    .sort((a, b) => (a.id === at ? -1 : b.id === at ? 1 : a.id < b.id ? -1 : 1));
  for (const city of own) {
    const kind = kinds.find((k) => buildRefusal(state, city, k) === undefined);
    if (kind) return { city, kind };
  }
  return undefined;
}

const barracksSite = (state: DeepReadonly<GameState>, at: CityId | undefined) =>
  siteFor(state, at, ['barracks', 'drillField'] as const);

const canalSite = (state: DeepReadonly<GameState>, at: CityId | undefined) =>
  siteFor(state, at, ['canals', 'reservoirs'] as const);

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
  let growth = yearly.change;
  let next = 0;
  for (let day = 1; ; day++) {
    while (next < schedule.length && (schedule[next]?.inDays ?? Infinity) < day) {
      const men = schedule[next]?.men ?? 0;
      amount -= schedule[next]?.pay ?? 0;
      change += (schedule[next]?.gain ?? 0) - men * upkeep;
      growth += schedule[next]?.growth ?? 0;
      limit += men * capPerMan;
      next++;
    }
    // An order is paid before the day's income comes in, so it must be affordable then.
    if (amount < 0) return day;
    const today = change + growth * grown(day);
    if (next === schedule.length) {
      if (today >= -ROUNDING) return undefined;
      return fallingStores(day - 1, amount, change, growth);
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
