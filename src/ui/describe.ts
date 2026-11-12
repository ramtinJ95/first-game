import { AT_CITY_KM, factionName, nearestCity, placeName, TROOP_NAMES } from '../app/names.ts';
import { factionColour } from '../render/palette.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { Pick } from '../render/pick.ts';
import type { ArmyId, BattleId, CityId, FactionId, ProvinceId } from '../sim/ids.ts';
import type { GameMap } from '../sim/map.ts';
import { CONVOY_KM_PER_DAY, MARCH_KM_PER_DAY } from '../sim/march.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { Sight } from '../sim/sight.ts';
import type { Army, Stance } from '../sim/state/army.ts';
import type { Battle } from '../sim/state/battle.ts';
import type { City } from '../sim/state/city.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { warSides } from '../sim/state/war.ts';
import { STANCE_EFFECTS } from '../sim/systems/battles.ts';
import { menOf } from '../sim/systems/economy.ts';
import { areAtWar } from '../sim/wars.ts';
import { distance } from '../sim/world/find-path.ts';

type State = DeepReadonly<GameState>;

export function cssColour(state: State, faction: FactionId): string {
  return `#${factionColour(state, faction).toString(16).padStart(6, '0')}`;
}

function pathKm(from: MapPoint, waypoints: readonly MapPoint[]): number {
  let km = 0;
  let at = from;
  for (const point of waypoints) {
    km += Math.hypot(point.x - at.x, point.y - at.y);
    at = point;
  }
  return km;
}

function daysLeft(km: number, perDay: number): string {
  const days = Math.max(1, Math.ceil(km / perDay));
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
}

function destination(state: State, end: MapPoint | undefined): string {
  const city = end && nearestCity(state, end);
  if (!city) return '';
  return city.km <= AT_CITY_KM ? ` to ${city.name}` : ` toward ${city.name}`;
}

/** What the army is doing, in a line a player reads at a glance. */
export function activityText(state: State, army: DeepReadonly<Army>): string {
  const { activity } = army;
  switch (activity.kind) {
    case 'idle':
      return `Idle ${placeName(state, activity.position)}`;
    case 'marching':
      return `Marching${destination(state, activity.waypoints.at(-1))} · ${daysLeft(
        pathKm(activity.position, activity.waypoints),
        MARCH_KM_PER_DAY,
      )}`;
    case 'retreating':
      return `Retreating${destination(state, activity.waypoints.at(-1))} · ${daysLeft(
        pathKm(activity.position, activity.waypoints),
        MARCH_KM_PER_DAY,
      )}`;
    case 'inBattle': {
      const battle = state.battles[activity.battle];
      const day = battle ? state.day - battle.startedOn + 1 : 1;
      return `In battle ${placeName(state, activity.position)} · day ${day}`;
    }
    case 'besieging': {
      const siege = state.sieges[activity.siege];
      const city = siege && state.cities[siege.city];
      const day = siege ? state.day - siege.startedOn + 1 : 1;
      return `Besieging ${city?.name ?? 'a city'} · day ${day}`;
    }
    case 'embarked': {
      const convoy = state.convoys[activity.convoy];
      if (!convoy) return 'At sea';
      return `At sea${destination(state, convoy.waypoints.at(-1))} · ${daysLeft(
        pathKm(convoy.position, convoy.waypoints),
        CONVOY_KM_PER_DAY,
      )}`;
    }
  }
}

export function ownerLine(state: State, faction: FactionId): string {
  const record = state.factions[faction];
  if (faction === state.player) return `${factionName(state, faction)} (you)`;
  return record?.kind === 'minor'
    ? `${factionName(state, faction)}, an independent city`
    : factionName(state, faction);
}

/** The last order of a kind waiting for the next day that matches, if any. */
export function pendingOrder<K extends Order['kind']>(
  pending: readonly Order[],
  kind: K,
  matches: (order: Extract<Order, { kind: K }>) => boolean,
): Extract<Order, { kind: K }> | undefined {
  return pending.findLast(
    (order): order is Extract<Order, { kind: K }> =>
      order.kind === kind && matches(order as Extract<Order, { kind: K }>),
  );
}

export function signed(value: number): string {
  const text = Math.abs(value) >= 100 ? Math.round(value).toLocaleString('en') : value.toFixed(1);
  return value >= 0 ? `+${text}` : text.replace('-', '−');
}

/**
 * The battles the side column shows: the selected battle, or the battle of the
 * selected army, while it lasts. Otherwise every battle one of the player's armies is
 * in, so a fight is never out of sight.
 */
export function shownBattles(state: State, selection: Pick | undefined): DeepReadonly<Battle>[] {
  let chosen: BattleId | undefined;
  if (selection?.kind === 'battle') chosen = selection.battle;
  if (selection?.kind === 'army') {
    const activity = state.armies[selection.army]?.activity;
    if (activity?.kind === 'inBattle') chosen = activity.battle;
  }
  const selected = chosen && state.battles[chosen];
  if (selected) return [selected];
  return Object.values(state.battles).filter((battle) =>
    [...battle.attackers, ...battle.defenders].some(
      (id) => state.armies[id]?.owner === state.player,
    ),
  );
}

/** Where the army stands, or where its convoy sails while it is at sea. */
export function armyPosition(state: State, army: DeepReadonly<Army>): MapPoint | undefined {
  const { activity } = army;
  return activity.kind === 'embarked'
    ? state.convoys[activity.convoy]?.position
    : activity.position;
}

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id.localeCompare(b.id, 'en', { numeric: true });
}

/**
 * The armies in sight that stand at the point, the player's first. Several armies at
 * one place draw as one banner on the map, so the panels list them.
 */
export function armiesAt(
  state: State,
  sight: Sight,
  point: MapPoint,
  except?: ArmyId,
): DeepReadonly<Army>[] {
  const ours = (army: DeepReadonly<Army>) => Number(army.owner === state.player);
  return Object.values(state.armies)
    .filter((army) => {
      if (army.id === except || !sight.armies.has(army.id)) return false;
      const at = armyPosition(state, army);
      return at !== undefined && distance(at, point) <= AT_CITY_KM;
    })
    .sort((a, b) => ours(b) - ours(a) || byId(a, b));
}

function blows(factor: number): string {
  const percent = Math.round(Math.abs(factor - 1) * 100);
  return percent === 0 ? 'normal blows' : `${percent}% ${factor > 1 ? 'more' : 'less'}`;
}

/** What a stance does in a battle, worked out from the numbers the battles use. */
export function stanceEffectText(stance: Stance): string {
  const { dealt, taken, morale } = STANCE_EFFECTS[stance];
  const both =
    blows(dealt) === blows(taken)
      ? `Deals and takes ${blows(dealt)}`
      : `Deals ${blows(dealt)}, takes ${blows(taken)}`;
  return morale === 1 ? both : `${both}, morale falls ${morale} times as fast`;
}

/** The faction that held the province when the game began, as the map gives it. */
export function startingOwner(
  map: DeepReadonly<GameMap>,
  province: ProvinceId,
): FactionId | undefined {
  const start = map.provinces.find((p) => p.id === province);
  if (!start) return undefined;
  return (start.owner === 'independent' ? start.id : start.owner) as string as FactionId;
}

/** The city's rank, and whose it was when its owner is not the one it began with. */
export function rankText(
  state: State,
  map: DeepReadonly<GameMap>,
  city: DeepReadonly<City>,
): string {
  const first = startingOwner(map, city.province) ?? city.owner;
  const taken = first !== city.owner;
  if (city.rank === 'capital') {
    return taken
      ? `Capital of ${factionName(state, first)}, held by ${factionName(state, city.owner)}`
      : 'Capital';
  }
  const rank = state.factions[city.owner]?.kind === 'minor' ? 'Independent city' : 'City';
  return taken ? `${rank}, taken from ${factionName(state, first)}` : rank;
}

/**
 * Why the idle army stands at a foreign city without besieging it, or nothing when it
 * stands at none or besieges with the next day. It follows `canBesiege` and
 * `beginSieges`: at war with the owner, neither gold nor food below zero, and a
 * formation with men and morale.
 */
export function whyNotBesieging(
  state: State,
  army: DeepReadonly<Army>,
  pending: readonly Order[],
): string | undefined {
  if (army.activity.kind !== 'idle') return undefined;
  const at = army.activity.position;
  const near = Object.values(state.cities)
    .filter((city) => city.owner !== army.owner && distance(city.position, at) <= AT_CITY_KM)
    .sort((a, b) => distance(a.position, at) - distance(b.position, at));
  const city = near.find((c) => areAtWar(state, army.owner, c.owner)) ?? near[0];
  if (!city) return undefined;
  const owner = factionName(state, city.owner);
  const stores = state.factions[army.owner]?.stores;
  const short = (['gold', 'food'] as const).filter((store) => stores && stores[store] < 0);
  const fit = army.formations.some((id) => {
    const formation = state.formations[id];
    return formation !== undefined && formation.men > 0 && formation.morale > 0;
  });
  const blocked =
    short.length > 0
      ? `Short of ${short.join(' and ')}, so this army cannot besiege ${city.name}.`
      : fit
        ? undefined
        : `Every formation is broken. The siege of ${city.name} waits for morale.`;
  if (!areAtWar(state, army.owner, city.owner)) {
    const declared = pendingOrder(
      pending,
      'declareWar',
      (order) => order.faction === army.owner && order.against === city.owner,
    );
    if (declared)
      return blocked ?? `War on ${owner} begins with the next day, and the siege with it.`;
    const target = city.name === owner ? 'it' : city.name;
    return `At peace with ${owner}. Declare war to besiege ${target}.`;
  }
  return blocked;
}

/** How many of the player's armies have orders waiting, or nothing when none has. */
export function ordersWaitingText(
  pending: readonly Order[],
  player: FactionId,
): string | undefined {
  const armies = new Set(
    pending.flatMap((order) => (order.faction === player && 'army' in order ? [order.army] : [])),
  );
  if (armies.size === 0) return undefined;
  return armies.size === 1
    ? '1 army has orders for the next day'
    : `${armies.size} armies have orders for the next day`;
}

/** What a click on a row selects, and where it centres the map. */
export interface Shown {
  readonly pick: Pick;
  readonly at: MapPoint;
}

export interface CityRow extends Shown {
  readonly city: CityId;
  readonly name: string;
  readonly population: number;
  readonly status: string;
}

export interface ArmyRow extends Shown {
  readonly army: ArmyId;
  readonly activity: string;
  readonly men: number;
}

export interface WarRow {
  readonly against: FactionId;
  readonly name: string;
  readonly since: Day;
}

/** The player's cities, armies, and wars, as the overview lists them. */
export interface Overview {
  readonly cities: readonly CityRow[];
  readonly armies: readonly ArmyRow[];
  readonly wars: readonly WarRow[];
}

function troopsText(recruits: DeepReadonly<City>['recruits']): string {
  const counts = new Map<string, number>();
  for (const { troop } of recruits) {
    const name = TROOP_NAMES[troop];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n === 1 ? name : `${name} ×${n}`)).join(', ');
}

/**
 * A city's siege, unrest, and recruits, or calm. A besieger out of sight goes
 * unnamed, though the player knows that its own city is besieged.
 */
export function cityStatus(state: State, sight: Sight, city: DeepReadonly<City>): string {
  const parts: string[] = [];
  const siege = Object.values(state.sieges).find((s) => s.city === city.id);
  if (siege) {
    const owners = new Set(
      siege.besiegers.flatMap((id) => {
        const army = sight.armies.has(id) ? state.armies[id] : undefined;
        return army ? [factionName(state, army.owner)] : [];
      }),
    );
    const by = owners.size > 0 ? ` by ${[...owners].join(' and ')}` : '';
    parts.push(`Besieged${by} since day ${siege.startedOn}`);
  }
  if (city.unrestDays > 0) parts.push(`In unrest for ${city.unrestDays} more days`);
  if (city.recruits.length > 0) parts.push(`Training ${troopsText(city.recruits)}`);
  return parts.length > 0 ? parts.join(' · ') : 'Calm';
}

/** The wars the faction is in, oldest first. */
export function warsOf(state: State, faction: FactionId): WarRow[] {
  return Object.entries(state.wars)
    .flatMap(([key, war]) => {
      const sides = warSides(key);
      if (!sides?.includes(faction)) return [];
      const against = sides[0] === faction ? sides[1] : sides[0];
      return [{ against, name: factionName(state, against), since: war.since }];
    })
    .sort((a, b) => a.since - b.since || a.name.localeCompare(b.name));
}

export function overviewOf(state: State, sight: Sight): Overview {
  const cities = Object.values(state.cities)
    .filter((city) => city.owner === state.player)
    .sort((a, b) => b.population - a.population || a.name.localeCompare(b.name))
    .map((city) => ({
      city: city.id,
      name: city.name,
      population: city.population,
      status: cityStatus(state, sight, city),
      pick: { kind: 'province', province: city.province } as const,
      at: city.position,
    }));
  const armies = Object.values(state.armies)
    .filter((army) => army.owner === state.player)
    .sort(byId)
    .flatMap((army) => {
      const at = armyPosition(state, army);
      if (!at) return [];
      return [
        {
          army: army.id,
          activity: activityText(state, army),
          men: menOf(state, army),
          pick: { kind: 'army', army: army.id } as const,
          at,
        },
      ];
    });
  return { cities, armies, wars: warsOf(state, state.player) };
}
