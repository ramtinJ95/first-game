import { reasonText, whole } from '../app/names.ts';
import { buildRefusal, cancelRefund } from '../sim/buildings/build.ts';
import {
  BUILDING_KINDS,
  BUILDINGS,
  hasBuilt,
  type BuildingKind,
} from '../sim/buildings/buildings.ts';
import { buildingGain, type BuildingGain } from '../sim/buildings/gains.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { World } from '../sim/world/world.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { workPause } from '../sim/systems/construction.ts';
import { dailyBalances, limitsOf } from '../sim/systems/economy.ts';
import { signed } from './describe.ts';

type State = DeepReadonly<GameState>;

export interface BuildingLine {
  readonly kind: BuildingKind;
  readonly name: string;
  /** What the building does for this city, in words with the rules' numbers. */
  readonly effect: string;
}

export interface BuildOption extends BuildingLine {
  readonly caution: string | undefined;
  readonly gold: number;
  readonly days: number;
  /** Why this building cannot start, when the reason is its own, such as its gold or its people. */
  readonly why: string | undefined;
}

/** The city's work: a build waiting for the next day, or a building under way. */
export type Work =
  | { readonly kind: 'ordered'; readonly building: BuildingKind; readonly name: string }
  | {
      readonly kind: 'working';
      readonly building: BuildingKind;
      readonly name: string;
      readonly daysLeft: number;
      /** Why the days stand still today, or undefined while the work goes on. */
      readonly paused: string | undefined;
      /** The gold a cancel gives back. */
      readonly refund: number;
      readonly cancelOrdered: boolean;
    };

export interface CityBuildings {
  readonly built: readonly BuildingLine[];
  readonly work: Work | undefined;
  /** The reason no building can start, said once, or undefined. */
  readonly blocked: string | undefined;
  readonly options: readonly BuildOption[];
}

/**
 * The day as the next tick will start it: the player's waiting orders
 * played through the rules' own handlers on a copy, so the gold they spend or
 * give back and the work they start are the rules' answer.
 */
export function afterWaiting(state: State, pending: readonly Order[], world: World): State {
  const orders = pending.filter((order) => order.faction === state.player);
  if (orders.length === 0) return state;
  const copy = structuredClone(state) as GameState;
  for (const order of orders) {
    executeOrder(copy, order, world);
  }
  return copy;
}

/** What the city has built, what it builds now, and what it could build, for its owner's panel. */
export function cityBuildings(
  state: State,
  pending: readonly Order[],
  city: DeepReadonly<City>,
  world: World,
): CityBuildings {
  const waiting = afterWaiting(state, pending, world);
  const next = waiting.cities[city.id] ?? city;
  const built = city.buildings.map((kind) => line(state, city, kind));
  const atWork = [city.construction?.building, next.construction?.building];
  const whys = BUILDING_KINDS.filter((kind) => !hasBuilt(city, kind) && !atWork.includes(kind)).map(
    (kind) => [kind, refusal(state, waiting, next, kind)] as const,
  );
  const shared = whys[0]?.[1];
  const blocked = whys.length > 1 && whys.every(([, why]) => why === shared) ? shared : undefined;
  return {
    built,
    work: work(state, pending, city, next),
    blocked,
    options: whys.map(([kind, why]) => ({
      ...line(state, city, kind),
      caution: gainCaution(waiting, next, kind),
      gold: BUILDINGS[kind].gold,
      days: BUILDINGS[kind].days,
      why: blocked ? undefined : why,
    })),
  };
}

/** Current usefulness, separate from permission to build and the building's lasting effect. */
function gainCaution(
  state: State,
  city: DeepReadonly<City>,
  kind: BuildingKind,
): string | undefined {
  const gain = buildingGain(state, city, kind);
  if (kind === 'temple') {
    return gain.calmed.some((id) => (state.cities[id]?.unrestDays ?? 0) > 0)
      ? undefined
      : 'No city whose unrest this would hasten is in unrest now.';
  }
  const stores = state.factions[city.owner]?.stores;
  const balance = dailyBalances(state).get(city.owner);
  const withIt: State = {
    ...state,
    cities: { ...state.cities, [city.id]: { ...city, buildings: [...city.buildings, kind] } },
  };
  const limits = limitsOf(withIt).get(city.owner);
  const wasted = (['gold', 'food', 'manpower'] as const).filter(
    (key) =>
      gain.daily[key] > 0 &&
      stores &&
      balance &&
      limits &&
      stores[key] >= limits[key] &&
      balance[key] >= 0,
  );
  return wasted.length > 0
    ? `${wasted.map((key) => key[0]?.toUpperCase() + key.slice(1)).join(' and ')} full: the extra daily gain would be lost now.`
    : undefined;
}

function line(state: State, city: DeepReadonly<City>, kind: BuildingKind): BuildingLine {
  return {
    kind,
    name: BUILDINGS[kind].name,
    effect: gainText(buildingGain(state, city, kind), city.id),
  };
}

function work(
  state: State,
  pending: readonly Order[],
  city: DeepReadonly<City>,
  next: DeepReadonly<City>,
): Work | undefined {
  const now = city.construction;
  if (!now) {
    return next.construction
      ? {
          kind: 'ordered',
          building: next.construction.building,
          name: BUILDINGS[next.construction.building].name,
        }
      : undefined;
  }
  return {
    kind: 'working',
    building: now.building,
    name: BUILDINGS[now.building].name,
    daysLeft: now.daysLeft,
    paused: pausedText(state, city),
    refund: cancelRefund(now.building),
    cancelOrdered: pending.some(
      (order) =>
        order.kind === 'cancelBuilding' && order.faction === state.player && order.city === city.id,
    ),
  };
}

/** The construction system does no work in a city in unrest or with an enemy at its walls. */
function pausedText(state: State, city: DeepReadonly<City>): string | undefined {
  const pause = workPause(state, city);
  if (pause === 'unrest') return 'paused while the city is in unrest';
  if (pause === 'siege') return 'paused while an enemy stands at the walls';
  return undefined;
}

/**
 * Why the rules would refuse the building tomorrow, in a player's words. When gold is
 * all it lacks, it says how much more gold it needs.
 */
function refusal(
  state: State,
  waiting: State,
  city: DeepReadonly<City>,
  kind: BuildingKind,
): string | undefined {
  const why = buildRefusal(waiting, city, kind);
  if (!why) return undefined;
  const cost = BUILDINGS[kind].gold;
  const gold = waiting.factions[city.owner]?.stores.gold ?? 0;
  if (gold < cost && !buildRefusal(withGold(waiting, city.owner, cost), city, kind)) {
    return `Needs ${whole(cost - gold)} more gold`;
  }
  return buildingReasonText(state, why);
}

function withGold(state: State, faction: FactionId, gold: number): State {
  const record = state.factions[faction];
  if (!record) return state;
  return {
    ...state,
    factions: { ...state.factions, [faction]: { ...record, stores: { ...record.stores, gold } } },
  };
}

/** A building refusal as the rules write it, with cities, factions, buildings, and large numbers put into words. */
export function buildingReasonText(state: State, reason: string): string {
  const kinds = BUILDING_KINDS.join('|');
  return reasonText(
    state,
    reason.replace(new RegExp(`\\ba (${kinds})\\b`, 'g'), '$1').replace(/\bcity (?=[a-z])/g, ''),
  )
    .replace(
      new RegExp(`\\b(${kinds})\\b`, 'gi'),
      (kind) => BUILDINGS[kind.toLowerCase() as BuildingKind].name,
    )
    .replace(/\b\d{4,}\b/g, (n) => whole(Number(n)));
}

const SHARE_WORDS: Readonly<Record<number, string>> = {
  0.5: 'half',
  0.25: 'a quarter of',
  0.75: 'three quarters of',
};

/**
 * What a building changes, such as "+8.4 gold a day" or "+50 walls and +450 garrison",
 * from what `buildingGain` worked out through the rules.
 */
export function gainText(gain: BuildingGain, city: CityId): string {
  const parts: string[] = [];
  const daily = (['gold', 'food', 'manpower'] as const)
    .filter((store) => Math.abs(gain.daily[store]) >= 0.05)
    .map((store) => `${signed(gain.daily[store])} ${store}`);
  if (daily.length > 0) parts.push(`${daily.join(', ')} a day`);
  if (gain.levy >= 1) parts.push(`${whole(gain.levy)} more men to call up`);
  if (gain.trainingShare < 1) {
    const share = SHARE_WORDS[gain.trainingShare] ?? `${Math.round(gain.trainingShare * 100)}% of`;
    parts.push(`recruits train in ${share} the days`);
  }
  const defence = [
    ...(gain.walls >= 0.5 ? [`+${whole(gain.walls)} walls`] : []),
    ...(gain.garrison >= 0.5 ? [`+${whole(gain.garrison)} garrison`] : []),
  ];
  if (defence.length > 0) parts.push(defence.join(' and '));
  if (gain.calmed.length > 0) {
    const { unrestPace, reachKm } = BUILDINGS.temple;
    const where =
      gain.calmed.length === 1 && gain.calmed[0] === city
        ? 'here'
        : `in ${gain.calmed.length} ${gain.calmed.length === 1 ? 'city' : 'cities'} within ${reachKm} km`;
    parts.push(`unrest counts down ${unrestPace} days a day ${where}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'adds nothing here today';
}
