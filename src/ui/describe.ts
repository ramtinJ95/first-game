import { unrestPaceOf } from '../sim/buildings/buildings.ts';
import {
  AT_CITY_KM,
  armyTitle,
  dateText,
  factionName,
  nearestCity,
  placeName,
  reasonText,
  STANCE_NAMES,
  TROOP_NAMES,
  whole,
} from '../app/names.ts';
import { factionColour } from '../render/palette.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { Pick } from '../render/pick.ts';
import type {
  ArmyId,
  BattleId,
  CityId,
  FactionId,
  ProvinceId,
  RefugeeColumnId,
} from '../sim/ids.ts';
import type { GameMap } from '../sim/map.ts';
import { CONVOY_KM_PER_DAY, MARCH_KM_PER_DAY } from '../sim/march.ts';
import { joinRefusal, type JoinArmyOrder } from '../sim/orders/join-army.ts';
import type { MoveArmyOrder } from '../sim/orders/move-army.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { Sight } from '../sim/sight.ts';
import type { Army, Stance } from '../sim/state/army.ts';
import type { Battle } from '../sim/state/battle.ts';
import type { City } from '../sim/state/city.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { warSides } from '../sim/state/war.ts';
import {
  edgeBetween,
  REFORM_DAYS,
  reforming,
  STANCE_BEATS,
  STANCE_EFFECTS,
  ENGAGEMENT_DISTANCE,
  stanceBlows,
} from '../sim/systems/battles.ts';
import { SACK } from '../sim/cities.ts';
import type { Siege } from '../sim/state/siege.ts';
import type { Stores } from '../sim/state/faction.ts';
import {
  adminShareOf,
  dailyBalances,
  FOOD_PER_PERSON,
  GRANARY_DAYS,
  MANPOWER_SHARE,
  menOf,
  TREASURY_DAYS,
} from '../sim/systems/economy.ts';
import { stormOdds } from '../sim/ai/situation.ts';
import { BLOCKADE_ODDS, defendersAt } from '../sim/systems/sieges.ts';
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
    case 'retreating': {
      const days = daysLeft(pathKm(activity.position, activity.waypoints), MARCH_KM_PER_DAY);
      const end = activity.waypoints.at(-1);
      const refuge =
        end &&
        Object.values(state.cities).find(
          (city) => city.owner === army.owner && distance(city.position, end) <= AT_CITY_KM,
        );
      // A retreat into the field ends near no city of the owner, often by the enemy's.
      return refuge
        ? `Retreating to ${refuge.name} · ${days}`
        : `Falling back into the field · ${days}`;
    }
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
      const landing = convoy.waypoints.at(-1);
      const onward =
        activity.march && landing
          ? `, then marching${destination(state, activity.march.at(-1))} · ${daysLeft(
              pathKm(landing, activity.march),
              MARCH_KM_PER_DAY,
            )}`
          : '';
      const sailing = `${destination(state, landing)} · ${daysLeft(
        pathKm(convoy.position, convoy.waypoints),
        CONVOY_KM_PER_DAY,
      )}${onward}`;
      if (convoy.departsOn !== undefined && convoy.departsOn > state.day) {
        const wait = convoy.departsOn - state.day;
        return `Gathering ships ${placeName(state, convoy.position)} · ${wait} ${wait === 1 ? 'day' : 'days'}, then sailing${sailing}`;
      }
      return `At sea${sailing}`;
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

export interface JoinChoice {
  into: DeepReadonly<Army>;
  order: JoinArmyOrder;
  /** Why the rules refuse the join now, in words, or undefined when they allow it. */
  refusal: string | undefined;
}

/** Both the army being joined and its receiver acknowledge a paused order. */
export function joinOrderedText(
  state: State,
  pending: readonly Order[],
  army: DeepReadonly<Army>,
): string | undefined {
  const joins = pending.filter(
    (order) =>
      order.kind === 'joinArmy' &&
      order.faction === state.player &&
      (order.army === army.id || order.into === army.id),
  );
  const lines = joins.flatMap((order) => {
    if (order.kind !== 'joinArmy') return [];
    const other = state.armies[order.army === army.id ? order.into : order.army];
    if (!other) return [];
    return [
      order.army === army.id
        ? `Join ${armyTitle(state, other)} ordered for the next day`
        : `${armyTitle(state, other)} ordered to join this army next day`,
    ];
  });
  return lines.length ? lines.join('. ') : undefined;
}

/**
 * The player's other armies that stand at the player's army, each with the order that
 * has the army join it and why the rules refuse that order now, if they do. A player's
 * armies become one only by this order, so two armies may stand apart at one city.
 */
export function joinChoices(state: State, sight: Sight, army: DeepReadonly<Army>): JoinChoice[] {
  const at = armyPosition(state, army);
  if (army.owner !== state.player || army.activity.kind !== 'idle' || !at) return [];
  return armiesAt(state, sight, at, army.id)
    .filter((other) => other.owner === state.player)
    .map((into) => {
      const order: JoinArmyOrder = {
        kind: 'joinArmy',
        faction: state.player,
        army: army.id,
        into: into.id,
      };
      const reason = joinRefusal(state, order)?.replace(
        /\barmy ([a-z0-9-]+)/g,
        (words, id: string) =>
          (Object.hasOwn(state.armies, id) ? state.armies[id as ArmyId]?.name : undefined) ?? words,
      );
      return { into, order, refusal: reason && reasonText(state, reason) };
    });
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
  const mirror = stanceBlows(stance, stance);
  const same =
    mirror === dealt * taken ? '' : `, ${blows(mirror)} against an enemy that skirmishes too`;
  return morale === 1 ? `${both}${same}` : `${both}${same}, morale falls ${morale} times as fast`;
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
 * Why the idle army stands at or beside a foreign city without besieging it, or nothing
 * when it stands beside none or besieges with the next day. It follows `canBesiege` and
 * `beginSieges`: within AT_CITY_KM, at war with the owner, neither gold nor food below
 * zero, and a formation with men and morale. An army beside an enemy city, within
 * ENGAGEMENT_DISTANCE but too far to besiege it, is offered the march there that besieges it.
 */
export function whyNotBesieging(
  state: State,
  army: DeepReadonly<Army>,
  pending: readonly Order[],
): { readonly text: string; readonly besiege?: MoveArmyOrder } | undefined {
  if (army.activity.kind !== 'idle') return undefined;
  const at = army.activity.position;
  const near = Object.values(state.cities)
    .filter(
      (city) => city.owner !== army.owner && distance(city.position, at) <= ENGAGEMENT_DISTANCE,
    )
    .sort((a, b) => distance(a.position, at) - distance(b.position, at));
  const declaredOn = (c: DeepReadonly<City>) =>
    pendingOrder(
      pending,
      'declareWar',
      (order) => order.faction === army.owner && order.against === c.owner,
    );
  const city =
    near.find((c) => areAtWar(state, army.owner, c.owner) || declaredOn(c)) ??
    near.find((c) => distance(c.position, at) <= AT_CITY_KM);
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
  const declared = declaredOn(city);
  const atWar = areAtWar(state, army.owner, city.owner) || !!declared;
  const km = distance(city.position, at);
  if (blocked && atWar) return { text: blocked };
  if (!atWar) {
    const target = city.name === owner ? 'it' : city.name;
    return { text: `At peace with ${owner}. Declare war to besiege ${target}.` };
  }
  if (km <= AT_CITY_KM) {
    return declared
      ? { text: `War on ${owner} begins with the next day, and the siege with it.` }
      : undefined;
  }
  const moving = pendingOrder(pending, 'moveArmy', (order) => order.army === army.id);
  if (moving) return undefined;
  return {
    text: `Stands ${whole(km)} km from ${city.name}, too far to besiege it. An army besieges a city it stands within ${AT_CITY_KM} km of.`,
    besiege: {
      kind: 'moveArmy',
      faction: army.owner,
      army: army.id,
      to: { x: city.position.x, y: city.position.y },
    },
  };
}

/** How many of the player's armies have orders waiting, or nothing when none has. */
export function ordersWaitingText(
  pending: readonly Order[],
  player: FactionId,
): { readonly short: string; readonly full: string } | undefined {
  const armies = new Set(
    pending.flatMap((order) => (order.faction === player && 'army' in order ? [order.army] : [])),
  );
  if (armies.size === 0) return undefined;
  return armies.size === 1
    ? { short: '1 army', full: '1 army has orders for the next day' }
    : {
        short: `${armies.size} armies`,
        full: `${armies.size} armies have orders for the next day`,
      };
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
  readonly name: string;
  readonly activity: string;
  readonly men: number;
}

export interface WarRow {
  readonly against: FactionId;
  readonly name: string;
  readonly since: Day;
}

/** A column of the player's people on the road from one city to another. */
export interface ColumnRow {
  readonly column: RefugeeColumnId;
  readonly people: number;
  readonly route: string;
  /** The destination, which a click on the row selects. */
  readonly pick: Pick;
  readonly at: MapPoint;
}

/**
 * The player's cities, armies, people on the road, and wars, as the overview lists them,
 * or the day the realm fell, when nothing is left to list.
 */
export type Overview =
  | {
      readonly kind: 'standing';
      readonly cities: readonly CityRow[];
      readonly armies: readonly ArmyRow[];
      readonly columns: readonly ColumnRow[];
      readonly wars: readonly WarRow[];
    }
  | { readonly kind: 'fallen'; readonly on: Day };

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
    parts.push(`Besieged${by} since ${dateText(siege.startedOn)}`);
  }
  if (city.unrestDays > 0) parts.push(`In unrest for ${unrestDaysLeft(state, city)} more days`);
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
  const fallenOn = state.factions[state.player]?.defeatedOn ?? null;
  if (fallenOn !== null) return { kind: 'fallen', on: fallenOn };
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
          name: army.name,
          activity: activityText(state, army),
          men: menOf(state, army),
          pick: { kind: 'army', army: army.id } as const,
          at,
        },
      ];
    });
  const columns = Object.values(state.refugeeColumns)
    .filter((column) => column.owner === state.player)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .flatMap((column) => {
      const to = state.cities[column.to];
      if (!to) return [];
      const from = state.cities[column.from]?.name ?? 'the road';
      return [
        {
          column: column.id,
          people: column.people,
          route: `${from} to ${to.name}`,
          pick: { kind: 'province', province: to.province } as const,
          at: column.position,
        },
      ];
    });
  return { kind: 'standing', cities, armies, columns, wars: warsOf(state, state.player) };
}

/**
 * What a minor city holds for whoever goes to war with it, in plain words: its walls and
 * wealth (`fortified`), the partner of its league, which joins its wars, and the men of
 * its own armies at the city that the player sees. A great power has no minor kind.
 */
export function minorText(
  state: State,
  sight: Sight,
  city: DeepReadonly<City>,
): string | undefined {
  const owner = state.factions[city.owner];
  if (owner?.kind !== 'minor') return undefined;
  const men = armiesAt(state, sight, city.position)
    .filter((army) => army.owner === city.owner)
    .reduce((sum, army) => sum + menOf(state, army), 0);
  const parts: string[] = [];
  if (city.fortified > 1) parts.push('Rich and walled: strong walls and a large granary');
  if (city.fortified < 1) parts.push('Poor and open: weak walls and little food');
  const partner = owner.league ? state.factions[owner.league] : undefined;
  const independent =
    partner?.kind === 'minor' &&
    partner.defeatedOn === null &&
    Object.values(state.cities).some((other) => other.owner === partner.id);
  if (independent) parts.push(`Leagued with ${partner.name}, which joins its wars`);
  else if (owner.league) parts.push('Leagued city: its partner is no longer independent');
  else if (city.fortified === 1)
    parts.push(men > 0 ? 'Standing-army city' : 'Unleagued city: standard walls');
  if (men > 0) parts.push(`Keeps an army of ${whole(men)} men at the city`);
  return parts.length > 0 ? parts.join('. ') : undefined;
}

/**
 * The days until the city is calm, at the pace the rules count its unrest down today:
 * faster within reach of its owner's temple (`unrestPaceOf`).
 */
export function unrestDaysLeft(state: State, city: DeepReadonly<City>): number {
  return Math.ceil(city.unrestDays / unrestPaceOf(state, city));
}

/** How long a city's unrest lasts from today, as the city panel and the fate prompt both say it. */
export function unrestText(days: number): string {
  return days > 0 ? `${days} days left` : 'Calm';
}

/**
 * What the city adds to its owner's stores each day: the economy's own balance of a realm
 * of this city alone, with its gold and manpower cut to the share a city of its owner's
 * realm yields for the realm's size.
 */
export function cityBalance(state: State, city: DeepReadonly<City>): Stores {
  const alone = { ...state, cities: { [city.id]: city }, armies: {} };
  const balance = dailyBalances(alone).get(city.owner) ?? { gold: 0, food: 0, manpower: 0 };
  const share = adminShareOf(state, city.owner);
  return { gold: balance.gold * share, food: balance.food, manpower: balance.manpower * share };
}

/** What the city's fields grow and its people eat each day, and the difference. */
export function cityFoodText(state: State, city: DeepReadonly<City>): string {
  const eats = city.population * FOOD_PER_PERSON;
  const net = cityBalance(state, city).food;
  return `Grows ${(net + eats).toFixed(1)}, eats ${eats.toFixed(1)} a day · ${signed(net)}`;
}

/** How long a sacked city still yields less gold, or nothing once it has recovered. */
export function sackText(state: State, city: DeepReadonly<City>): string | undefined {
  if (city.sackedOn === null) return undefined;
  const left = SACK.poorDays - (state.day - city.sackedOn);
  if (left <= 0) return undefined;
  const share = SACK.poorOutput === 0.5 ? 'half' : `${Math.round(SACK.poorOutput * 100)}% of`;
  return `Sacked in ${dateText(city.sackedOn)}: yields ${share} its gold for ${whole(left)} more days`;
}

/** A store's balance that runs out within this many days is a warning. */
export const WARN_DAYS = 60;

export interface StoreNote {
  readonly text: string;
  /** Why, in a sentence, for the tooltip. */
  readonly why: string;
  readonly bad: boolean;
}

/**
 * What the top bar says beside a store, in a word or two, and in full in `why`: that it
 * ran out, how many days it lasts while it falls, or that it stops growing at its limit
 * (`limitsOf`), today or with tomorrow's gain.
 */
export function storeNote(
  store: keyof Stores,
  amount: number,
  change: number,
  limit: number | undefined,
): StoreNote | undefined {
  if (store !== 'manpower' && amount <= 0) {
    return {
      text: 'Ran out',
      why: 'Ran out: formations desert. Each formation loses men every day while it lasts.',
      bad: true,
    };
  }
  if (store !== 'manpower' && change < 0) {
    const days = Math.floor(amount / -change);
    return {
      text: `${whole(days)} days left`,
      why: `Runs out in ${whole(days)} days at today's balance. Formations desert once it runs out.`,
      bad: days <= WARN_DAYS,
    };
  }
  if (limit === undefined || change <= 0 || amount + change <= limit) return undefined;
  const when = amount >= limit ? '' : ' tomorrow';
  if (store === 'gold') {
    return {
      text: `Full${when}`,
      why: `Treasury full${when}. It holds ${TREASURY_DAYS} days of the gold your people pay. More gold is lost: spend it on troops.`,
      bad: false,
    };
  }
  return store === 'food'
    ? {
        text: `Full${when}`,
        why: `Granaries full${when}. They hold ${GRANARY_DAYS} days of what your people and men eat. More food spoils.`,
        bad: false,
      }
    : {
        text: `At the call-up limit${when}`,
        why: `At the call-up limit${when}. You can call up ${Math.round(MANPOWER_SHARE * 100)}% of your people, less the men under arms and in training. Grow your cities or let men go to call up more.`,
        bad: false,
      };
}

/**
 * Why a siege does not starve its city, or nothing when it does: its besiegers are
 * fewer than the blockade needs, so the food holds and the garrison sallies. Nothing
 * either while a besieger is out of sight, so the count gives away no hidden army.
 */
export function weakSiegeText(
  state: State,
  sight: Sight,
  siege: DeepReadonly<Siege>,
): string | undefined {
  const city = state.cities[siege.city];
  if (!city || !siege.besiegers.every((id) => sight.armies.has(id))) return undefined;
  const men = siege.besiegers.reduce((sum, id) => {
    const army = state.armies[id];
    return sum + (army ? menOf(state, army) : 0);
  }, 0);
  if (men >= BLOCKADE_ODDS * city.garrison) return undefined;
  const needed = Math.ceil(BLOCKADE_ODDS * city.garrison) - men;
  return `Too few to starve ${city.name}: ${whole(men)} besiegers against a garrison of ${whole(city.garrison)}. The food does not fall, and sallies cut down besiegers each day. ${whole(needed)} more men would cut the food.`;
}

/**
 * What a storm of the city today would do, by the storm rule's own odds (`stormOdds`): the
 * chance that the player's besiegers take it, and the men they are expected to lose either way.
 */
export function stormText(state: State, siege: DeepReadonly<Siege>): string | undefined {
  const city = state.cities[siege.city];
  if (!city) return undefined;
  const stormers = siege.besiegers.flatMap((id) => {
    const army = state.armies[id];
    return army?.owner === state.player ? [army] : [];
  });
  if (stormers.length === 0) return undefined;
  if (defendersAt(state, city)) {
    return `No storm while an army of ${factionName(state, city.owner)} defends ${city.name} in the field. Beat it first.`;
  }
  const { chance, loss, men } = stormOdds(state, city, stormers);
  const percent = Math.round(chance * 100);
  const odds =
    chance <= 0
      ? `A storm cannot take ${city.name} today`
      : chance >= 1
        ? `A storm takes ${city.name} for certain`
        : `A storm takes ${city.name} ${percent === 0 ? 'less than 1' : percent === 100 ? 'more than 99' : percent} times in 100`;
  return `${odds}. It is expected to cost ${whole(loss)} of your ${whole(men)} men, whether it takes the city or not.`;
}

/**
 * The people of the city who are on the road to another city of its owner, so the panel
 * says where the people missing from its population went.
 */
export function leavingText(state: State, city: DeepReadonly<City>): string | undefined {
  // Only the player's own cities: a foreign column may be out of the player's sight.
  if (city.owner !== state.player) return undefined;
  const columns = Object.values(state.refugeeColumns).filter(
    (column) => column.from === city.id && column.owner === city.owner,
  );
  if (columns.length === 0) return undefined;
  return columns
    .map((column) => {
      const to = state.cities[column.to]?.name ?? 'another city';
      return `${whole(column.people)} of its people are on the road to ${to}`;
    })
    .join('. ');
}

/** A stance as the object of a sentence, such as "beats an all-out assault". */
const STANCE_OBJECTS: Record<Stance, string> = {
  holdTheLine: 'hold the line',
  allOutAssault: 'an all-out assault',
  skirmishAndWithdraw: 'skirmish and withdraw',
};

/** A side's stance as a noun with its verb, for the line on where the player stands. */
const STANCE_NOUNS: Record<Stance, { readonly noun: string; readonly beats: string }> = {
  holdTheLine: { noun: 'line', beats: 'beats' },
  allOutAssault: { noun: 'assault', beats: 'beats' },
  skirmishAndWithdraw: { noun: 'skirmishers', beats: 'beat' },
};

function beatenBy(stance: Stance): Stance {
  return (
    (Object.keys(STANCE_BEATS) as Stance[]).find((other) => STANCE_BEATS[other] === stance) ??
    stance
  );
}

/** What the stance beats and what beats it, by `STANCE_BEATS`, after its name. */
export function stanceMatchShort(stance: Stance): string {
  return `Beats ${STANCE_OBJECTS[STANCE_BEATS[stance]]}, beaten by ${STANCE_OBJECTS[beatenBy(stance)]}.`;
}

/** The stance's name and what it beats and what beats it, as the guide lists them. */
export function stanceMatchText(stance: Stance): string {
  const short = stanceMatchShort(stance);
  return `${STANCE_NAMES[stance]}: ${short.charAt(0).toLowerCase()}${short.slice(1)}`;
}

/** What a change of stance costs, by `REFORM_DAYS`. */
export function reformCostText(): string {
  return `A change of stance takes ${REFORM_DAYS} days to re-form. Until then every enemy that is not re-forming too beats it, whatever its stance.`;
}

/** How long the army still re-forms after a change of stance, or nothing. */
export function reformingText(state: State, army: DeepReadonly<Army>): string | undefined {
  if (!reforming(state, army) || army.stanceChangedOn === undefined) return undefined;
  const left = REFORM_DAYS - (state.day - army.stanceChangedOn);
  return `Re-forming, ${left} ${left === 1 ? 'day' : 'days'} left`;
}

/** The enemy army in the army's battle that the player faces: the strongest on the other side. */
export function enemyInBattle(
  state: State,
  army: DeepReadonly<Army>,
): DeepReadonly<Army> | undefined {
  if (army.activity.kind !== 'inBattle') return undefined;
  const battle = state.battles[army.activity.battle];
  if (!battle) return undefined;
  const theirs = battle.attackers.includes(army.id) ? battle.defenders : battle.attackers;
  return theirs
    .flatMap((id) => state.armies[id] ?? [])
    .sort((a, b) => menOf(state, b) - menOf(state, a) || (a.id < b.id ? -1 : 1))[0];
}

/**
 * Where the player's army stands against the enemy it fights, in one plain line, by the
 * same edge the battle deals its blows with (`edgeBetween`).
 */
export function standingText(
  state: State,
  army: DeepReadonly<Army>,
  enemy: DeepReadonly<Army>,
): string {
  const edge = edgeBetween(state, army, enemy);
  const mine = STANCE_NOUNS[army.stance];
  const theirs = STANCE_NOUNS[enemy.stance];
  const ours = reforming(state, army);
  const their = reforming(state, enemy);
  if (edge > 1) {
    return their
      ? `Their army re-forms, so your ${mine.noun} ${mine.beats} it`
      : `Your ${mine.noun} ${mine.beats} their ${theirs.noun}`;
  }
  if (edge < 1) {
    return ours
      ? `Your army re-forms, so their ${theirs.noun} ${theirs.beats} it`
      : `Their ${theirs.noun} ${theirs.beats} your ${mine.noun}`;
  }
  return 'Neither stance beats the other';
}

/**
 * What the stance's button says beside its name: that it answers the enemy's stance, and
 * what changing to it costs. The stance the army holds costs nothing.
 */
export function stanceChoiceText(
  state: State,
  army: DeepReadonly<Army>,
  stance: Stance,
  held: Stance,
  enemy: DeepReadonly<Army> | undefined,
): { readonly answers: boolean; readonly cost: string | undefined } {
  const answers = enemy !== undefined && STANCE_BEATS[stance] === enemy.stance;
  if (stance === held) return { answers, cost: undefined };
  const cost = reforming(state, army)
    ? `re-forms ${REFORM_DAYS} days again`
    : `re-forms ${REFORM_DAYS} days`;
  return { answers, cost };
}
