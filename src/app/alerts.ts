import type { Pick } from '../render/pick.ts';
import { earlyMusters, FATE_DAYS } from '../sim/cities.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { BattleSideOutcome, DayEvent } from '../sim/events.ts';
import type { ArmyId, CityId, FactionId, SiegeId } from '../sim/ids.ts';
import type { Army, ArmyActivity } from '../sim/state/army.ts';
import type { Day } from '../sim/state/day.ts';
import type { Stores } from '../sim/state/faction.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { insideOutline, type Sight } from '../sim/sight.ts';
import { menOf, RALLY_DISTANCE } from '../sim/systems/economy.ts';
import type { Troop } from '../sim/troops.ts';
import { BLOCKADE_ODDS } from '../sim/systems/sieges.ts';
import { areAtWar } from '../sim/wars.ts';
import type { World } from '../sim/world/world.ts';
import { factionName, placeName, TROOP_NAMES, whole } from './names.ts';

export type AlertKind =
  | 'battleBegan'
  | 'battleEnded'
  | 'armyRetreated'
  | 'armyDestroyed'
  | 'armyDeserted'
  | 'warDeclared'
  | 'armyArrived'
  | 'formationMustered'
  | 'musteredEarly'
  | 'cityChangedOwner'
  | 'siegeBegan'
  | 'storeRanOut'
  | 'fateLapsed'
  | 'enemySighted'
  | 'siegeTooWeak'
  | 'siegeBled'
  | 'columnLeft'
  | 'columnArrived';

export interface Alert {
  readonly kind: AlertKind;
  readonly day: Day;
  readonly text: string;
  /** Good and bad news read apart at a glance. */
  readonly tone: 'good' | 'bad' | 'neutral';
  /** Where a click on the alert takes the camera and what it selects. A store has no place. */
  readonly focus?: { readonly at: MapPoint; readonly select?: Pick };
  /** A battle or an army that is gone by the end of the day, which the player may have seen the day before. */
  readonly seenAs?: Pick;
  /** How many alerts of the same kind, text, and place on the day this one line stands for. */
  readonly count?: number;
}

type State = DeepReadonly<GameState>;

/**
 * The cities whose fate the player settled by choosing to occupy them, with the day each
 * fell. The rules have no order for it, so the page keeps the choice.
 */
export type Occupied = ReadonlyMap<CityId, Day>;

/**
 * A march or a crossing heads for the player's land when it ends on one of the player's
 * provinces or this close to one of the player's cities, in km, which takes in its harbour.
 */
export const THREAT_KM = 40;

/** A march has reached its end when the army stands this close to its last waypoint, in km. */
const ARRIVED_KM = 0.5;

const STORE_NAMES: Record<keyof Stores, string> = {
  gold: 'Gold',
  food: 'Food',
  manpower: 'Manpower',
};

/**
 * What the player should hear about from one day: the day's events that touch the
 * player or that the player may see, and the changes to the player's own armies,
 * cities, and stores between the two days. `alertsInSight` then drops what the
 * player did not see.
 */
export function alertsOfDay(
  before: State,
  after: State,
  events: readonly DeepReadonly<DayEvent>[],
  occupied: Occupied = new Map(),
): Alert[] {
  const player = after.player;
  // The day played, which the rules also stamp on what happened in it, such as a city's fall.
  const day = before.day;
  const alerts: Alert[] = [];
  const add = (alert: Omit<Alert, 'day'>) => alerts.push({ ...alert, day });

  for (const event of events) {
    const alert = eventAlert(before, after, event);
    const seenAs = goneRecord(event);
    if (alert) add(seenAs ? { ...alert, seenAs } : alert);
  }

  for (const army of Object.values(after.armies)) {
    if (army.owner !== player) continue;
    const was = before.armies[army.id];
    const at = army.activity.kind === 'embarked' ? undefined : army.activity.position;
    if (!was || !at) continue;
    const select = { kind: 'army', army: army.id } as const;
    if (was.activity.kind === 'embarked') {
      add({
        kind: 'armyArrived',
        tone: 'neutral',
        text: `Your army landed ${placeName(after, at)}`,
        focus: { at, select },
      });
    } else if (!isOnTheMove(army.activity) && arrived(was.activity, at)) {
      add({
        kind: 'armyArrived',
        tone: 'neutral',
        text: `Your army arrived ${placeName(after, at)}`,
        focus: { at, select },
      });
    }
  }

  const musters = earlyMusters(before, after);
  const told: { at: MapPoint; troop: Troop }[] = [];
  for (const muster of musters) {
    const city = after.cities[muster.city];
    if (!city) continue;
    const besieging = Object.values(after.sieges).some(
      (siege) =>
        siege.city === city.id && siege.besiegers.some((id) => after.armies[id]?.owner === player),
    );
    if (muster.owner !== player && !besieging) continue;
    if (muster.owner === player) {
      for (const troop of muster.troops) told.push({ at: city.position, troop });
    }
    const troops = troopsText(muster.troops);
    add({
      kind: 'musteredEarly',
      tone: muster.owner === player ? 'good' : 'bad',
      text:
        muster.owner === player
          ? `Besieged ${city.name} mustered its recruits early: ${troops}. It cannot fall or be stormed while they stand`
          : `${city.name} mustered its recruits against your siege: ${troops}. It cannot fall or be stormed while they stand`,
      focus: { at: city.position, select: { kind: 'province', province: city.province } },
    });
  }

  for (const formation of Object.values(after.formations)) {
    if (before.formations[formation.id]) continue;
    const army = after.armies[formation.army];
    const at = army && positionOf(after, army);
    if (!army || army.owner !== player || !at) continue;
    const early = told.findIndex(
      ({ at: city, troop }) => troop === formation.troop && distanceKm(city, at) <= RALLY_DISTANCE,
    );
    if (early >= 0) {
      told.splice(early, 1);
      continue;
    }
    add({
      kind: 'formationMustered',
      tone: 'good',
      text: `${TROOP_NAMES[formation.troop]} mustered ${placeName(after, at)}`,
      focus: { at, select: { kind: 'army', army: army.id } },
    });
  }

  for (const city of Object.values(after.cities)) {
    const was = before.cities[city.id];
    if (!was || was.owner === city.owner) continue;
    if (city.owner !== player && was.owner !== player) continue;
    add({
      kind: 'cityChangedOwner',
      tone: city.owner === player ? 'good' : 'bad',
      text: `${city.name} fell to ${factionName(after, city.owner)}`,
      focus: { at: city.position, select: { kind: 'province', province: city.province } },
    });
  }

  for (const siege of Object.values(after.sieges)) {
    if (before.sieges[siege.id]) continue;
    const city = after.cities[siege.city];
    if (!city) continue;
    const ours = siege.besiegers.some((id) => after.armies[id]?.owner === player);
    if (!ours && city.owner !== player) continue;
    add({
      kind: 'siegeBegan',
      tone: ours ? 'neutral' : 'bad',
      text: ours
        ? `Your army besieges ${city.name}`
        : `${ownersOf(after, siege.besiegers)} besieges ${city.name}`,
      focus: { at: city.position, select: { kind: 'province', province: city.province } },
    });
  }

  for (const city of Object.values(after.cities)) {
    if (city.owner !== player || city.fellOn === null) continue;
    if (after.day - city.fellOn !== FATE_DAYS + 1) continue;
    if (before.cities[city.id]?.fellOn !== city.fellOn) continue;
    if (occupied.get(city.id) === city.fellOn) continue;
    add({
      kind: 'fateLapsed',
      tone: 'neutral',
      text: `No fate was chosen for ${city.name}: you occupy it as it stands`,
      focus: { at: city.position, select: { kind: 'province', province: city.province } },
    });
  }

  for (const column of Object.values(after.refugeeColumns)) {
    if (column.owner !== player || before.refugeeColumns[column.id]) continue;
    const from = after.cities[column.from];
    const to = after.cities[column.to];
    if (!from || !to) continue;
    add({
      kind: 'columnLeft',
      tone: 'neutral',
      text: `${whole(column.people)} people left ${from.name} for ${to.name}`,
      focus: { at: column.position, select: { kind: 'province', province: from.province } },
    });
  }
  for (const column of Object.values(before.refugeeColumns)) {
    if (column.owner !== player || after.refugeeColumns[column.id]) continue;
    // A defeat removes its columns too, and that is told as the fall of the last city.
    if (after.factions[player]?.defeatedOn !== null) continue;
    const from = after.cities[column.from];
    const to = after.cities[column.to];
    if (!to) continue;
    add({
      kind: 'columnArrived',
      tone: 'good',
      text: `${whole(column.people)} people from ${from?.name ?? 'the road'} settled in ${to.name}`,
      focus: { at: to.position, select: { kind: 'province', province: to.province } },
    });
  }

  const had = before.factions[player]?.stores;
  const has = after.factions[player]?.stores;
  if (had && has && after.factions[player]?.defeatedOn === null) {
    for (const store of Object.keys(STORE_NAMES) as (keyof Stores)[]) {
      if (had[store] > 0 && has[store] <= 0) {
        add({
          kind: 'storeRanOut',
          tone: 'bad',
          text:
            store === 'manpower'
              ? 'Manpower ran out: no troops can be raised'
              : `${STORE_NAMES[store]} ran out: your formations desert each day`,
        });
      }
    }
  }

  return alerts;
}

/** A siege of the player's that is too weak to cut the food, from the day it was told of. */
export interface WeakSiege {
  /** Each besieging army's men on the day before, so a loss is counted only while it stays. */
  readonly men: ReadonlyMap<ArmyId, number>;
  /** The men the besiegers lost while in the siege since it was told of. */
  readonly killed: number;
  /** Whether the player has been told that the sallies killed `BLED_SHARE` of them. */
  readonly bled: boolean;
}

/** The share of a weak siege's men that sallies kill before the player is warned again. */
export const BLED_SHARE = 1 / 3;

/**
 * The news of the player's sieges too weak to cut the food (besiegers fewer than
 * `BLOCKADE_ODDS` times the garrison): one alert on the day a siege is weak, and one
 * once the besiegers have lost `BLED_SHARE` of their men while in it. An army that
 * leaves takes its men with it and counts as no loss, and one that joins adds its own.
 * `watched` is what was told before, which the page keeps, and the result gives it for
 * the next day.
 */
export function weakSiegeNews(
  before: State,
  after: State,
  watched: ReadonlyMap<SiegeId, WeakSiege>,
): { alerts: Alert[]; watched: Map<SiegeId, WeakSiege> } {
  const player = after.player;
  const alerts: Alert[] = [];
  const next = new Map<SiegeId, WeakSiege>();
  for (const siege of Object.values(after.sieges)) {
    const city = after.cities[siege.city];
    const armies = siege.besiegers.flatMap((id) => after.armies[id] ?? []);
    if (!city || !armies.some((army) => army.owner === player)) continue;
    const men = new Map(armies.map((army) => [army.id, menOf(after, army)] as const));
    const total = [...men.values()].reduce((sum, n) => sum + n, 0);
    if (total >= BLOCKADE_ODDS * city.garrison) continue;
    const focus = {
      at: city.position,
      select: { kind: 'province', province: city.province },
    } as const;
    const was = watched.get(siege.id);
    if (!was) {
      alerts.push({
        kind: 'siegeTooWeak',
        day: before.day,
        tone: 'bad',
        text: `Your siege of ${city.name} is too weak to starve it: ${whole(total)} men against a garrison of ${whole(city.garrison)}, whose sallies kill besiegers each day`,
        focus,
      });
      next.set(siege.id, { men, killed: 0, bled: false });
      continue;
    }
    let killed = was.killed;
    for (const [id, now] of men) {
      const had = was.men.get(id);
      if (had !== undefined) killed += Math.max(0, had - now);
    }
    const bled = !was.bled && killed >= BLED_SHARE * (total + killed);
    if (bled) {
      alerts.push({
        kind: 'siegeBled',
        day: before.day,
        tone: 'bad',
        text: `Sallies from ${city.name} have killed a third of your besiegers: ${whole(killed)} men lost, ${whole(total)} left`,
        focus,
      });
    }
    next.set(siege.id, { men, killed, bled: was.bled || bled });
  }
  return { alerts, watched: next };
}

/**
 * The enemies that came into the player's sight today on their way to the player's land:
 * a convoy or a marching army of a faction at war with the player, which the player did
 * not see the day before. Each is one alert with its men, and with the place it heads for
 * when the player sees that place.
 */
export function sightingsOfDay(
  before: State,
  after: State,
  saw: Sight,
  sees: Sight,
  world: World,
): Alert[] {
  const player = after.player;
  const day = before.day;
  const held = new Set<string>(
    Object.values(after.provinces)
      .filter((province) => after.cities[province.city]?.owner === player)
      .map((province) => province.id),
  );
  const own = world.map.provinces.filter((province) => held.has(province.id));
  const ownCities = Object.values(after.cities).filter((city) => city.owner === player);
  const threatens = (to: MapPoint) =>
    ownCities.some((city) => distanceKm(city.position, to) <= THREAT_KM) ||
    own.some((province) => insideOutline(province.outline, to));
  const target = (to: MapPoint) => {
    if (!sees.sees(to)) return 'your land';
    const city = [...ownCities].sort(
      (a, b) => distanceKm(a.position, to) - distanceKm(b.position, to),
    )[0];
    return city && distanceKm(city.position, to) <= THREAT_KM ? city.name : 'your land';
  };
  const alerts: Alert[] = [];

  for (const convoy of Object.values(after.convoys)) {
    if (!sees.convoys.has(convoy.id) || saw.convoys.has(convoy.id)) continue;
    if (!areAtWar(after, convoy.owner, player)) continue;
    const to = convoy.waypoints[convoy.waypoints.length - 1];
    if (!to || !threatens(to)) continue;
    const men = convoy.armies.reduce((sum, id) => {
      const army = after.armies[id];
      return sum + (army ? menOf(after, army) : 0);
    }, 0);
    const first = convoy.armies[0];
    alerts.push({
      kind: 'enemySighted',
      day,
      tone: 'bad',
      text: `A fleet of ${factionName(after, convoy.owner)} with ${whole(men)} men is sailing for ${target(to)}`,
      focus: {
        at: convoy.position,
        ...(first && { select: { kind: 'army', army: first } as const }),
      },
    });
  }

  for (const army of Object.values(after.armies)) {
    if (army.activity.kind !== 'marching') continue;
    if (!sees.armies.has(army.id) || saw.armies.has(army.id)) continue;
    if (!areAtWar(after, army.owner, player)) continue;
    const to = army.activity.waypoints[army.activity.waypoints.length - 1];
    if (!to || !threatens(to)) continue;
    alerts.push({
      kind: 'enemySighted',
      day,
      tone: 'bad',
      text: `An army of ${factionName(after, army.owner)} with ${whole(menOf(after, army))} men is marching on ${target(to)}`,
      focus: { at: army.activity.position, select: { kind: 'army', army: army.id } },
    });
  }
  return alerts;
}

/**
 * Folds the alerts of one kind with the same text at the same place into one line with
 * a count, in the place of the first, so six formations that muster at one city on one
 * day read as one line.
 */
export function groupAlerts(alerts: readonly Alert[]): Alert[] {
  const grouped: Alert[] = [];
  const at = new Map<string, number>();
  for (const alert of alerts) {
    const place = alert.focus ? `${alert.focus.at.x},${alert.focus.at.y}` : '';
    const key = `${alert.day}|${alert.kind}|${place}|${alert.text}`;
    const index = at.get(key);
    const first = index === undefined ? undefined : grouped[index];
    if (index === undefined || !first) {
      at.set(key, grouped.length);
      grouped.push(alert);
    } else {
      grouped[index] = { ...first, count: (first.count ?? 1) + (alert.count ?? 1) };
    }
  }
  return grouped;
}

/** "2 Spearmen and Archers", by troop in the order they trained. */
function troopsText(troops: readonly Troop[]): string {
  const counts = new Map<Troop, number>();
  for (const troop of troops) counts.set(troop, (counts.get(troop) ?? 0) + 1);
  const parts = [...counts].map(([troop, n]) =>
    n > 1 ? `${n} ${TROOP_NAMES[troop]}` : TROOP_NAMES[troop],
  );
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : (parts[0] ?? '');
}

function eventAlert(
  before: State,
  after: State,
  event: DeepReadonly<DayEvent>,
): Omit<Alert, 'day'> | undefined {
  const player = after.player;
  switch (event.kind) {
    case 'battleBegan': {
      const where = placeName(after, event.position);
      const select = after.battles[event.battle]
        ? ({ kind: 'battle', battle: event.battle } as const)
        : undefined;
      const focus = { at: event.position, ...(select && { select }) };
      const enemies = event.attackers.includes(player)
        ? event.defenders
        : event.defenders.includes(player)
          ? event.attackers
          : undefined;
      if (enemies) {
        return {
          kind: 'battleBegan',
          tone: 'neutral',
          text: `Battle ${where} against ${namesOf(after, enemies)}`,
          focus,
        };
      }
      return {
        kind: 'battleBegan',
        tone: 'neutral',
        text: `Battle ${where}: ${namesOf(after, event.attackers)} against ${namesOf(after, event.defenders)}`,
        focus,
      };
    }
    case 'battleEnded': {
      const where = placeName(after, event.position);
      const side = event.attackers.factions.includes(player)
        ? 'attackers'
        : event.defenders.factions.includes(player)
          ? 'defenders'
          : undefined;
      if (!side) {
        const losses = `${sideLosses(after, event.attackers)}, ${sideLosses(after, event.defenders)}.`;
        if (event.winner === 'none') {
          return {
            kind: 'battleEnded',
            tone: 'neutral',
            text: `The battle ${where} ended with neither side holding the field after ${daysText(event.days)}. ${losses}`,
            focus: { at: event.position },
          };
        }
        const beaten = event.winner === 'attackers' ? event.defenders : event.attackers;
        return {
          kind: 'battleEnded',
          tone: 'neutral',
          text: `${namesOf(after, event[event.winner].factions)} beat ${namesOf(after, beaten.factions)} ${where} after ${daysText(event.days)}. ${sideLosses(after, event[event.winner])}, ${sideLosses(after, beaten)}.`,
          focus: { at: event.position },
        };
      }
      const ours = event[side];
      const theirs = side === 'attackers' ? event.defenders : event.attackers;
      const losses = lossesText(after, ours, theirs);
      const standing = event.standing.find((id) => after.armies[id]?.owner === player);
      if (event.winner === side) {
        return {
          kind: 'battleEnded',
          tone: 'good',
          text: `You held the field ${where} after ${daysText(event.days)}. ${losses}`,
          focus: {
            at: event.position,
            ...(standing && { select: { kind: 'army', army: standing } as const }),
          },
        };
      }
      if (event.winner === 'none') {
        return {
          kind: 'battleEnded',
          tone: 'neutral',
          text: `The battle ${where} ended with neither side holding the field after ${daysText(event.days)}. ${losses}`,
          focus: { at: event.position },
        };
      }
      return {
        kind: 'battleEnded',
        tone: 'bad',
        text: `${namesOf(after, theirs.factions)} held the field ${where} after ${daysText(event.days)}. ${losses}`,
        focus: { at: event.position },
      };
    }
    case 'armyRetreated': {
      if (event.owner !== player) return undefined;
      const lost = event.lost > 0 ? `, losing ${event.lost} men to the pursuit` : '';
      return {
        kind: 'armyRetreated',
        tone: 'bad',
        text: `Your army ${event.ordered ? 'withdrew' : 'broke'} ${placeName(before, event.from)}${lost}, and falls back ${destinationText(after, event.to)}`,
        focus: {
          at: event.from,
          ...(after.armies[event.army] && {
            select: { kind: 'army', army: event.army } as const,
          }),
        },
      };
    }
    case 'armyDestroyed': {
      const where = placeName(before, event.position);
      const focus = { at: event.position };
      if (event.owner !== player) {
        return {
          kind: 'armyDestroyed',
          tone: areAtWar(after, player, event.owner) ? 'good' : 'neutral',
          text: `An army of ${factionName(after, event.owner)} ${LOSS_TEXT[event.cause]} ${where}`,
          focus,
        };
      }
      return {
        kind: 'armyDestroyed',
        tone: 'bad',
        text:
          event.cause === 'surrender'
            ? `Your army of ${event.men} men had nowhere to retreat and surrendered ${where}`
            : `Your army ${LOSS_TEXT[event.cause]} ${where}`,
        focus,
      };
    }
    case 'armyDeserted': {
      if (isShort(before, event.owner)) return undefined;
      const ours = event.owner === player;
      return {
        kind: 'armyDeserted',
        tone: ours ? 'bad' : 'neutral',
        text: `${event.men} men deserted ${ours ? 'your army' : `an army of ${factionName(after, event.owner)}`} ${placeName(after, event.position)}`,
        focus: {
          at: event.position,
          ...(after.armies[event.army] && {
            select: { kind: 'army', army: event.army } as const,
          }),
        },
      };
    }
    case 'warDeclared':
      if (event.against === player) {
        return {
          kind: 'warDeclared',
          tone: 'bad',
          text: `${factionName(after, event.by)} declared war on you`,
        };
      }
      if (event.by === player) {
        return {
          kind: 'warDeclared',
          tone: 'neutral',
          text: `You declared war on ${factionName(after, event.against)}`,
        };
      }
      return undefined;
  }
}

function goneRecord(event: DeepReadonly<DayEvent>): Pick | undefined {
  if (event.kind === 'battleEnded') return { kind: 'battle', battle: event.battle };
  if (event.kind === 'armyDestroyed') return { kind: 'army', army: event.army };
  return undefined;
}

const LOSS_TEXT: Record<DeepReadonly<DayEvent & { kind: 'armyDestroyed' }>['cause'], string> = {
  battle: 'was destroyed in battle',
  surrender: 'surrendered',
  storm: 'was lost storming the walls',
  sally: 'was cut down by sallies from the walls',
  defeat: 'laid down its arms',
};

function lossesText(
  state: State,
  ours: DeepReadonly<BattleSideOutcome>,
  theirs: DeepReadonly<BattleSideOutcome>,
): string {
  return `You lost ${ours.lost} men, ${namesOf(state, theirs.factions)} lost ${theirs.lost}.`;
}

function sideLosses(state: State, side: DeepReadonly<BattleSideOutcome>): string {
  return `${namesOf(state, side.factions)} lost ${side.lost}`;
}

function daysText(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/** "to Roma" for a city's own spot, otherwise the place in the field. */
function destinationText(state: State, to: MapPoint): string {
  const city = Object.values(state.cities).find((c) => distanceKm(c.position, to) <= ARRIVED_KM);
  return city ? `to ${city.name}` : `into the field ${placeName(state, to)}`;
}

/** Desertion began on an earlier day while a store was already below zero. */
function isShort(state: State, faction: FactionId): boolean {
  const stores = state.factions[faction]?.stores;
  return !!stores && (stores.gold < 0 || stores.food < 0);
}

function positionOf(state: State, army: DeepReadonly<Army>): MapPoint | undefined {
  const { activity } = army;
  return activity.kind === 'embarked'
    ? state.convoys[activity.convoy]?.position
    : activity.position;
}

/**
 * The army reached the end of its march. A march shorter than a day starts and ends
 * between two days and is never seen, so an army that stands somewhere new arrived too.
 */
function arrived(was: DeepReadonly<ArmyActivity>, at: MapPoint): boolean {
  if (was.kind === 'embarked') return false;
  if (!isOnTheMove(was)) return distanceKm(was.position, at) > ARRIVED_KM;
  const end = was.waypoints.at(-1);
  return !!end && distanceKm(end, at) <= ARRIVED_KM;
}

function isOnTheMove(
  activity: DeepReadonly<ArmyActivity>,
): activity is DeepReadonly<ArmyActivity & { kind: 'marching' | 'retreating' }> {
  return activity.kind === 'marching' || activity.kind === 'retreating';
}

function distanceKm(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function namesOf(state: State, factions: readonly FactionId[]): string {
  const names = factions.map((faction) => factionName(state, faction));
  return names.length > 0 ? names.join(' and ') : 'an enemy';
}

function ownersOf(state: State, armies: readonly ArmyId[]): string {
  return namesOf(state, [...new Set(armies.flatMap((id) => state.armies[id]?.owner ?? []))]);
}
