import {
  ADVANCE_BRANCHES,
  ADVANCES,
  advancesOf,
  PRICED_CITIES,
  hasStudied,
  type AdvanceBranch,
  type AdvanceKind,
} from '../sim/advances/advances.ts';
import { advanceGain } from '../sim/advances/gains.ts';
import { citiesOf, studyPrice, studyRefund, type StudyOrder } from '../sim/advances/study.ts';
import { FOOD_MARGIN_MEN } from '../sim/ai/build.ts';
import {
  bestStudy,
  drilledMen,
  nearestTarget,
  sharperMen,
  spareFoodMen,
  studyPayback,
} from '../sim/ai/study.ts';
import { GARRISON_ODDS } from '../sim/ai/thresholds.ts';
import { UNREST_DAYS, unrestDaysFor } from '../sim/cities.ts';
import { GUARD_DETER_DAYS, GUARD_GOLD } from '../sim/guards.ts';
import { fullDefences, WALL_WEAR_PER_THOUSAND_MEN } from '../sim/systems/sieges.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import { dailyBalances, limitsOf } from '../sim/systems/economy.ts';
import type { World } from '../sim/world/world.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { whole } from '../app/names.ts';
import { STARTING_GENERAL_SKILL } from '../sim/new-game.ts';
import { worthBuilding } from '../app/building-hint.ts';
import { BUILDINGS } from '../sim/buildings/buildings.ts';
import { paybackBasis } from './buildings-text.ts';

type State = DeepReadonly<GameState>;

export const BRANCH_NAMES: Readonly<Record<AdvanceBranch, string>> = {
  military: 'Military',
  economy: 'Economy',
  statecraft: 'Statecraft',
};

/** The rule in a sentence, as the panel opens with it. */
export const ADVANCE_RULE =
  'Your realm studies one advance at a time, in any order. Its gold is paid when study starts, and its effect lasts for good once the days are done.';

/** One advance as the panel shows it to the realm today. */
export interface AdvanceRowView {
  readonly kind: AdvanceKind;
  readonly name: string;
  /** The gold the realm pays to start it today. */
  readonly gold: number;
  /** Why that is more than the listed price, in words, when it is. */
  readonly why?: string;
  readonly days: number;
  /** What it would do for this realm today, in the realm's own numbers. */
  readonly does: string;
  /** What the advance does in any realm, in a sentence. */
  readonly effect: string;
  readonly payback: string;
  readonly status: 'studied' | 'studying' | 'ordered' | 'open';
  /** Why the realm cannot start it now, in words, while it is open. */
  readonly refusal?: string;
  /** The advance that pays back soonest of those the realm can start now. */
  readonly suggested: boolean;
}

export interface BranchView {
  readonly branch: AdvanceBranch;
  readonly name: string;
  readonly rows: readonly AdvanceRowView[];
}

/** The three branches with each advance, as the realm stands today and with the orders waiting. */
export function advancesView(
  state: State,
  world: World,
  faction: FactionId,
  pending: readonly Order[],
): BranchView[] {
  const record = state.factions[faction];
  const ordered = pending.find(
    (order): order is StudyOrder => order.kind === 'study' && order.faction === faction,
  )?.advance;
  const suggested = marked(state, world, faction).advance;
  return ADVANCE_BRANCHES.map((branch) => ({
    branch,
    name: BRANCH_NAMES[branch],
    rows: advancesOf(branch).map((kind) => {
      const { name, days } = ADVANCES[kind];
      const gold = studyPrice(state, faction, kind);
      const why = priceWhy(state, faction, kind);
      const status = hasStudied(record, kind)
        ? 'studied'
        : record?.study?.advance === kind
          ? 'studying'
          : ordered === kind
            ? 'ordered'
            : 'open';
      const refusal =
        status !== 'open'
          ? undefined
          : ordered
            ? `${ADVANCES[ordered].name} is ordered for the next day`
            : refusalText(state, faction, kind);
      return {
        kind,
        name,
        gold,
        ...(why ? { why } : {}),
        days,
        does: doesText(state, faction, kind),
        effect: ADVANCE_EFFECTS[kind],
        payback: paybackText(state, faction, kind),
        status,
        ...(refusal ? { refusal } : {}),
        suggested: kind === suggested,
      };
    }),
  }));
}

/**
 * What the panel puts first: the advance that pays back soonest of those the realm can start
 * with all its gold, unless one of the player's cities could start a building that pays back
 * sooner, by the building hint's reckoning (`worthBuilding`), whether or not the treasury pays
 * for it today, since study would only put it off. Then that building, and no advance.
 * A Temple or a Sanctuary is weighed only by a realm that holds a city the map gave another,
 * since its payback is reckoned from a city taken each year, which a realm that has never
 * taken one does not earn.
 */
export function marked(
  state: State,
  world: World,
  faction: FactionId,
): {
  advance?: AdvanceKind;
  building?: NonNullable<ReturnType<typeof worthBuilding>>;
  soonest?: { advance: AdvanceKind; payback: number };
} {
  const gold = state.factions[faction]?.stores.gold;
  const soonest = gold === undefined ? undefined : bestStudy(state, faction, gold);
  if (!soonest) return {};
  const building =
    faction === state.player
      ? worthBuilding(state, true, !hasConquered(state, world, faction))
      : undefined;
  if (building && building.years < soonest.payback) return { building, soonest };
  return { advance: soonest.advance, soonest };
}

/** Whether the realm holds a city the map gave another owner: it has taken a city and kept it. */
export function hasConquered(state: State, world: World, faction: FactionId): boolean {
  return world.map.provinces.some(
    (province) =>
      (province.owner as string) !== (faction as string) &&
      state.cities[province.id as string as CityId]?.owner === faction,
  );
}

/** The panel's opening line naming the advance it marks, so it is seen without scrolling. */
export function markedLine(
  state: State,
  world: World,
  faction: FactionId,
): { advance: AdvanceKind; text: string } | undefined {
  const { advance, soonest } = marked(state, world, faction);
  if (!advance || !soonest) return undefined;
  return {
    advance,
    text: `Pays back soonest of what you can start: ${ADVANCES[advance].name}, in ${soonest.payback.toFixed(1)} years.`,
  };
}

/** The line that names a building that would pay back sooner than any advance the realm can start, or undefined. */
export function buildingFirstLine(
  state: State,
  world: World,
  faction: FactionId,
): string | undefined {
  const { building, soonest } = marked(state, world, faction);
  if (!building || !soonest) return undefined;
  const { city, kind, years } = building;
  const { name, gold: price } = BUILDINGS[kind];
  const gold = state.factions[faction]?.stores.gold ?? 0;
  const net = dailyBalances(state).get(faction)?.gold ?? 0;
  const missing = price - gold;
  const limit = limitsOf(state).get(faction)?.gold ?? Infinity;
  const costs = `It costs ${whole(price)} gold, ${whole(Math.ceil(missing))} more than you hold`;
  // Gold stops at the treasury's limit, so a price above it is never saved up.
  const short =
    missing <= 0
      ? ''
      : price > limit
        ? ` ${costs}, and more than your treasury holds at its limit of ${whole(Math.floor(limit))}, so it waits until the limit grows.`
        : net > 0
          ? ` ${costs}, which today's income brings in ${whole(Math.ceil(missing / net))} days.`
          : ` ${costs}, and today's income does not bring it in.`;
  return `Building ${name} at ${city.name} would pay back in ${years.toFixed(1)} years${paybackBasis(kind)}, sooner than any advance you can start: the soonest, ${ADVANCES[soonest.advance].name}, takes ${soonest.payback.toFixed(1)}.${short} Build first, and study with the gold left.`;
}

/** What each advance does, in a sentence with its number. */
export const ADVANCE_EFFECTS: Readonly<Record<AdvanceKind, string>> = {
  drillmasters: `Every army's general rises to skill ${ADVANCES.drillmasters.generalSkill}, and each new army starts there.`,
  marchingRations: `Each man under arms eats ${percent(1 - ADVANCES.marchingRations.foodShare)} less food.`,
  siegeEngineers: `Your besiegers wear walls down ${times(ADVANCES.siegeEngineers.wallWearShare)} as fast.`,
  standardCoin: `Every city yields ${percent(ADVANCES.standardCoin.goldShare - 1)} more gold.`,
  fallowFields: `Every city's people grow ${percent(ADVANCES.fallowFields.foodShare - 1)} more food.`,
  marketWeights: `Every trade route pays your ends ${percent(ADVANCES.marketWeights.tradeShare - 1)} more.`,
  citizenRolls: `Every city gives ${percent(ADVANCES.citizenRolls.levyShare - 1)} more manpower, a day and to call up.`,
  clemency: `A city you take, sack or enslave has ${percent(1 - ADVANCES.clemency.unrestShare)} fewer days of unrest.`,
  longContracts: `A band of guards serves ${Math.round(12 * ADVANCES.longContracts.guardShare)} months instead of 12 for the same ${whole(GUARD_GOLD)} gold.`,
};

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function times(share: number): string {
  return share === 1.5 ? 'half again' : `${share} times`;
}

/** What the advance would do for this realm today, from the rules' own sums. */
export function doesText(state: State, faction: FactionId, kind: AdvanceKind): string {
  const { daily, limits } = advanceGain(state, faction, kind);
  const parts: string[] = [];
  const extra = extraText(state, faction, kind);
  if (extra) parts.push(extra);
  const add = (amount: number, what: string) => {
    if (Math.abs(amount) >= 0.05)
      parts.push(`${amount > 0 ? '+' : ''}${amount.toFixed(1)} ${what}`);
  };
  add(daily.gold, 'gold a day');
  add(daily.food, 'food a day');
  add(daily.manpower, 'manpower a day');
  if (Math.abs(limits.manpower) >= 1)
    parts.push(`${limits.manpower > 0 ? '+' : ''}${whole(limits.manpower)} men to call up`);
  return parts.length > 0 ? parts.join(', ') : 'nothing yet';
}

/** The realm's own numbers of the advances whose effect the daily sums do not show. */
function extraText(state: State, faction: FactionId, kind: AdvanceKind): string | undefined {
  if (kind === 'drillmasters') {
    if (hasStudied(state.factions[faction], kind)) {
      const men = drilledMen(state, faction);
      return men >= 1
        ? `Your armies strike as ${whole(men)} more men would than under generals of skill ${STARTING_GENERAL_SKILL}, and each new army starts at skill ${ADVANCES.drillmasters.generalSkill}`
        : `Each new army starts at skill ${ADVANCES.drillmasters.generalSkill}`;
    }
    const men = sharperMen(state, faction);
    return men >= 1 ? `Your armies strike as ${whole(men)} more men would` : undefined;
  }
  if (kind === 'siegeEngineers' || kind === 'clemency') {
    const target = nearestTarget(state, faction);
    if (!target) return undefined;
    if (kind === 'clemency') {
      const days = unrestDaysFor(
        { ...state, factions: learned(state, faction, kind) },
        faction,
        UNREST_DAYS,
      );
      return `${target.name} would stay in unrest ${days} days instead of ${UNREST_DAYS}`;
    }
    const men = Math.ceil(GARRISON_ODDS * fullDefences(target).garrison);
    const wear = (men / 1000) * WALL_WEAR_PER_THOUSAND_MEN;
    const days = Math.ceil(fullDefences(target).walls / wear);
    const faster = Math.ceil(days / ADVANCES.siegeEngineers.wallWearShare);
    return `${whole(men)} men wear down the walls of ${target.name} in ${faster} days instead of ${days}`;
  }
  if (kind === 'longContracts') {
    const bands = Object.values(state.cities)
      .filter((city) => city.owner === faction)
      .reduce((sum, city) => sum + city.guards.length, 0);
    if (bands === 0) return undefined;
    const named = `${bands} ${bands === 1 ? 'band' : 'bands'}`;
    return hasStudied(state.factions[faction], kind)
      ? `Each band you hire serves ${Math.round(12 * ADVANCES.longContracts.guardShare)} months; you hold ${named}`
      : `Your ${named} would cost a third less each year hired again`;
  }
  return undefined;
}

function learned(state: State, faction: FactionId, kind: AdvanceKind): State['factions'] {
  const record = state.factions[faction];
  if (!record) return state.factions;
  return { ...state.factions, [faction]: { ...record, advances: [...record.advances, kind] } };
}

/** Why the realm pays more than the listed price, or undefined when it pays the listed price. */
export function priceWhy(state: State, faction: FactionId, kind: AdvanceKind): string | undefined {
  const listed = ADVANCES[kind].gold;
  if (studyPrice(state, faction, kind) <= listed) return undefined;
  const cities = citiesOf(state, faction);
  return `Listed at ${whole(listed)} gold for a realm of up to ${PRICED_CITIES} cities. It adds to every city, so your ${cities} cities pay ${whole(listed)} × ${cities} ÷ ${PRICED_CITIES}.`;
}

function paybackText(state: State, faction: FactionId, kind: AdvanceKind): string {
  if (kind === 'longContracts')
    return `No payback in years: it saves gold only on guards kept to defend a city, and a band still counts ${GUARD_DETER_DAYS} days against a threat whatever its term`;
  const years = studyPayback(state, faction, kind);
  if (years === undefined) {
    const food = advanceGain(state, faction, kind).daily.food;
    // Food counts at its gold price only while the harvest's surplus is thin, as for buildings.
    if (food > 0 && spareFoodMen(state, faction) >= FOOD_MARGIN_MEN)
      return `Pays nothing back today: your food already feeds ${whole(FOOD_MARGIN_MEN)} more men than you keep`;
    return 'Pays nothing back today';
  }
  return years > 20 ? 'Pays back in over 20 years' : `Pays back in ${years.toFixed(1)} years`;
}

function refusalText(state: State, faction: FactionId, kind: AdvanceKind): string | undefined {
  const record = state.factions[faction];
  if (!record) return 'Your realm has fallen';
  if (record.defeatedOn !== null) return 'Your realm has fallen';
  if (record.study) return `Studying ${ADVANCES[record.study.advance].name}; one at a time`;
  const gold = studyPrice(state, faction, kind);
  if (record.stores.gold < gold) return `Needs ${whole(gold - record.stores.gold)} more gold`;
  return undefined;
}

/**
 * What the realm studies and the days left, or that it studies nothing: `short` for a wide
 * top bar, `days` where only the days fit, and `full` for the panel and the tooltip.
 */
export function studyLine(
  state: State,
  faction: FactionId,
): { short: string; days: string; full: string } {
  const study = state.factions[faction]?.study;
  if (!study) return { short: 'None studied', days: 'None', full: 'Nothing is being studied.' };
  const { name } = ADVANCES[study.advance];
  const days = `${study.daysLeft} ${study.daysLeft === 1 ? 'day' : 'days'}`;
  return {
    short: `${name} · ${days}`,
    days,
    full: `Studying ${name}: ${days} left.`,
  };
}

/** The words of the cancel button: the gold that giving up the study gives back. */
export function cancelText(paid: number): string {
  return `Give up (${whole(studyRefund(paid))} gold back)`;
}
