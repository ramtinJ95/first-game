import type { Pick } from '../render/pick.ts';
import { BUILDINGS } from '../sim/buildings/buildings.ts';
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
import { peaceText, termsText } from '../sim/ai/peace.ts';
import { warKey } from '../sim/state/war.ts';
import { areAtWar } from '../sim/wars.ts';
import type { World } from '../sim/world/world.ts';
import {
  armyTitle,
  buildingList,
  dateText,
  factionName,
  placeName,
  peaceFundsText,
  reasonText,
  TROOP_NAMES,
  whole,
} from './names.ts';

import { ALERT_KINDS } from './alert-kinds.generated.ts';
export { ALERT_KINDS };
export type AlertKind = (typeof ALERT_KINDS)[number];

/**
 * The news that can stop the game for the player to decide: a battle of theirs begins,
 * a siege of theirs is too weak to starve the city, and an enemy army comes near their
 * land. The Game menu turns each on or off.
 */
export const PAUSE_KINDS = ['battle', 'weakSiege', 'sighted'] as const;
export type PauseKind = (typeof PAUSE_KINDS)[number];

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
  /**
   * The pause this news asks for, and a key for news that stops the game only the first
   * time, such as the first enemy seen near the player's land in a war.
   */
  readonly pause?: { readonly kind: PauseKind; readonly once?: string };
  /** The game paused for this news. */
  readonly paused?: true;
  /**
   * News of the world beyond the player's own affairs, drawn quieter than the player's
   * own. The chronicle keeps it all, and the corner shows only the `corner` kind.
   */
  readonly world?: WorldReach;
}

export const WORLD_REACHES = ['corner', 'chronicle'] as const;
export type WorldReach = (typeof WORLD_REACHES)[number];

/** The alerts the corner list shows, newest first: all but the world news kept for the chronicle. */
export function cornerAlerts(alerts: readonly Alert[], shown: number): Alert[] {
  return alerts.filter((alert) => alert.world !== 'chronicle').slice(0, shown);
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
        text: `${army.name} landed ${placeName(after, at)}`,
        focus: { at, select },
      });
    } else if (
      (army.activity.kind === 'idle' || army.activity.kind === 'besieging') &&
      arrived(was.activity, at)
    ) {
      add({
        kind: 'armyArrived',
        tone: 'neutral',
        text: `${army.name} arrived ${placeName(after, at)}`,
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
    const named = ours
      ? siege.besiegers.filter((id) => after.armies[id]?.owner === player)
      : [...new Set(siege.besiegers.flatMap((id) => after.armies[id]?.owner ?? []))];
    const verb = named.length > 1 ? 'besiege' : 'besieges';
    add({
      kind: 'siegeBegan',
      tone: ours ? 'neutral' : 'bad',
      text: ours
        ? `${namesOfArmies(
            after,
            siege.besiegers.filter((id) => after.armies[id]?.owner === player),
          )} ${verb} ${city.name}`
        : `${ownersOf(after, siege.besiegers)} ${verb} ${city.name}`,
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
  /** Whether the player has been told that the besiegers lost `BLED_SHARE` of their men. */
  readonly bled: boolean;
}

/** The share of a weak siege's men lost, to sallies, storms, or desertion, before the player is warned again. */
export const BLED_SHARE = 1 / 3;

/**
 * The news of the player's sieges too weak to cut the food (besiegers fewer than
 * `BLOCKADE_ODDS` times the garrison): one alert on the day a siege is weak, and one
 * once the besiegers have lost `BLED_SHARE` of their men while in it, whatever killed
 * them, since the page cannot tell a sally's dead from a storm's. An army that
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
        pause: { kind: 'weakSiege' },
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
        text: `Your besiegers at ${city.name} have lost a third of their men in a siege too weak to starve it: ${whole(killed)} lost, ${whole(total)} left`,
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
 * not see the day before. With the page's `told` keys, an unchanged force is not retold
 * after fog flicker: only a changed target or strength above its last report warrants
 * another alert. The mutable set is page state, already saved with the news.
 */
export function sightingsOfDay(
  before: State,
  after: State,
  saw: Sight,
  sees: Sight,
  world: World,
  told?: Set<string>,
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
  /** The place an enemy heads for, by name, and a key that tells two places apart. */
  const target = (to: MapPoint) => {
    const city = [...ownCities].sort(
      (a, b) => distanceKm(a.position, to) - distanceKm(b.position, to),
    )[0];
    return sees.sees(to) && city && distanceKm(city.position, to) <= THREAT_KM
      ? { name: city.name, key: city.id as string }
      : { name: 'your land', key: `${to.x},${to.y}` };
  };
  const seen: Sighting[] = [];
  // Keep one high-water mark per force in the existing page news keys. Fog flicker,
  // casualties, and a reload do not retell an unchanged approach; a new target or
  // strength above the last report does, even if the force never left sight.
  const tell = (id: string, owner: FactionId, to: MapPoint, men: number, wasSeen: boolean) => {
    if (!told) return !wasSeen;
    const prefix = `approach:${warOnce(after, owner)}:${id}:`;
    const last = [...told].find((key) => key.startsWith(prefix));
    const destination = `${to.x},${to.y}`;
    const next = `${prefix}${destination}|${men}`;
    if (last) {
      const [target, strength] = last.slice(prefix.length).split('|');
      if (target === destination && men <= Number(strength)) return false;
      told.delete(last);
    }
    told.add(next);
    return true;
  };

  for (const convoy of Object.values(after.convoys)) {
    if (!sees.convoys.has(convoy.id)) continue;
    if (!areAtWar(after, convoy.owner, player)) continue;
    const to = convoy.waypoints[convoy.waypoints.length - 1];
    if (!to || !threatens(to)) continue;
    const men = convoy.armies.reduce((sum, id) => {
      const army = after.armies[id];
      return sum + (army ? menOf(after, army) : 0);
    }, 0);
    if (!tell(convoy.id, convoy.owner, to, men, saw.convoys.has(convoy.id))) continue;
    const first = convoy.armies[0];
    const place = target(to);
    seen.push({
      by: 'sea',
      owner: convoy.owner,
      target: place,
      men,
      alone: `A fleet of ${factionName(after, convoy.owner)} with ${namesOfArmies(after, convoy.armies)}, ${whole(men)} men, is sailing for ${place.name}`,
      focus: {
        at: convoy.position,
        ...(first && { select: { kind: 'army', army: first } as const }),
      },
    });
  }

  for (const army of Object.values(after.armies)) {
    if (army.activity.kind !== 'marching') continue;
    if (!sees.armies.has(army.id)) continue;
    if (!areAtWar(after, army.owner, player)) continue;
    const to = army.activity.waypoints[army.activity.waypoints.length - 1];
    if (!to || !threatens(to)) continue;
    const men = menOf(after, army);
    if (!tell(army.id, army.owner, to, men, saw.armies.has(army.id))) continue;
    const place = target(to);
    seen.push({
      by: 'land',
      owner: army.owner,
      target: place,
      men,
      alone: `${armyTitle(after, army)} with ${whole(men)} men is marching on ${place.name}`,
      focus: { at: army.activity.position, select: { kind: 'army', army: army.id } },
    });
  }

  // Fleets or armies of one power seen on one day on their way to one place are one
  // invasion, told as one line with their men together.
  const groups = new Map<string, Sighting[]>();
  for (const sighting of seen) {
    const key = `${sighting.by}|${sighting.owner}|${sighting.target.key}`;
    groups.set(key, [...(groups.get(key) ?? []), sighting]);
  }
  return [...groups.values()].flatMap((group): Alert[] => {
    const [first] = group;
    if (!first) return [];
    const men = whole(group.reduce((sum, { men }) => sum + men, 0));
    const owner = factionName(after, first.owner);
    return [
      {
        kind: 'enemySighted',
        day,
        tone: 'bad',
        text:
          group.length === 1
            ? first.alone
            : first.by === 'sea'
              ? `${group.length} fleets of ${owner} with ${men} men are sailing for ${first.target.name}`
              : `${group.length} armies of ${owner} with ${men} men are marching on ${first.target.name}`,
        focus: first.focus,
        pause: { kind: 'sighted', once: warOnce(after, first.owner) },
      },
    ];
  });
}

/** A fleet or a marching army of an enemy seen on its way to the player's land. */
interface Sighting {
  readonly by: 'sea' | 'land';
  readonly owner: FactionId;
  /** The place it heads for: its name in the alert, and a key that tells two places apart. */
  readonly target: { readonly name: string; readonly key: string };
  readonly men: number;
  /** The alert's text when it comes alone. */
  readonly alone: string;
  readonly focus: NonNullable<Alert['focus']>;
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
          pause: { kind: 'battle' },
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
        text: `${calledOf(before, after, event.army)} ${event.ordered ? 'withdrew' : 'broke'} ${placeName(before, event.from)}${lost}, and falls back ${destinationText(after, event.to)}`,
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
          text: `${calledOf(before, after, event.army, event.owner)} ${LOSS_TEXT[event.cause]} ${where}`,
          focus,
        };
      }
      return {
        kind: 'armyDestroyed',
        tone: 'bad',
        text:
          event.cause === 'surrender'
            ? `${calledOf(before, after, event.army)}, ${event.men} men, had nowhere to retreat and surrendered ${where}`
            : `${calledOf(before, after, event.army)} ${LOSS_TEXT[event.cause]} ${where}`,
        focus,
      };
    }
    case 'armyDeserted': {
      if (isShort(before, event.owner)) return undefined;
      const ours = event.owner === player;
      return {
        kind: 'armyDeserted',
        tone: ours ? 'bad' : 'neutral',
        text: `${event.men} men deserted ${calledOf(before, after, event.army, event.owner)} ${placeName(after, event.position)}`,
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
    case 'buildingFinished': {
      const city = after.cities[event.city];
      if (event.owner !== player || !city) return undefined;
      return {
        kind: 'buildingFinished',
        tone: 'good',
        text: `${BUILDINGS[event.building].name} finished at ${city.name}`,
        focus: { at: event.position, select: { kind: 'province', province: city.province } },
      };
    }
    case 'buildingsLost': {
      // The owner is the sacker, or the faction the city fell from.
      const city = after.cities[event.city];
      if (event.owner !== player || !city) return undefined;
      return {
        kind: 'buildingsLost',
        tone: event.cause === 'sack' ? 'neutral' : 'bad',
        text:
          event.cause === 'sack'
            ? `Sack of ${city.name} destroyed its ${buildingList(event.buildings)}`
            : `${city.name} fell with its ${buildingList(event.buildings)} unfinished`,
        focus: { at: event.position, select: { kind: 'province', province: city.province } },
      };
    }
    case 'peaceOffered': {
      const terms = peaceText(after, event.terms, player);
      if (event.to === player) {
        const details = [peaceFundsText(after, event.terms), event.change]
          .filter(Boolean)
          .join(' ');
        return {
          kind: 'peaceOffered',
          tone: 'neutral',
          text: `${factionName(after, event.from)} offers ${terms}${details ? `. ${details}` : ''}`,
        };
      }
      if (event.from === player) {
        return {
          kind: 'peaceOffered',
          tone: 'neutral',
          text: `You offered ${factionName(after, event.to)} ${terms}`,
        };
      }
      return undefined;
    }
    case 'peaceOfferEnded':
      if (event.from !== player && event.to !== player) return undefined;
      return {
        kind: 'peaceOfferEnded',
        tone: 'neutral',
        text: `Peace offer with ${factionName(after, event.from === player ? event.to : event.from)} ended. ${reasonText(after, event.reason)}`,
      };
    case 'peaceRefused': {
      if (event.from === player) {
        const name = factionName(after, event.by);
        const reason = reasonText(after, event.reason);
        const repeated = `${name} would refuse. `;
        return {
          kind: 'peaceRefused',
          tone: 'bad',
          text: `${name} refused your offer of peace. ${reason.startsWith(repeated) ? reason.slice(repeated.length) : reason}`,
        };
      }
      if (event.by === player) {
        return {
          kind: 'peaceRefused',
          tone: 'neutral',
          text: `You refused peace with ${factionName(after, event.from)}, and the war goes on`,
        };
      }
      return undefined;
    }
    case 'peaceMade': {
      const [a, b] = event.between;
      const other = a === player ? b : b === player ? a : undefined;
      if (other) {
        const truce = after.truces[warKey(a, b)];
        const until = truce ? `. The truce holds until ${dateText(truce.endsOn)}` : '';
        return {
          kind: 'peaceMade',
          tone: 'good',
          text: `Peace with ${factionName(after, other)}${event.terms.kind === 'asThingsStand' ? ' as things stand' : `: ${termsText(after, event.terms, player)}`}${until}`,
        };
      }
      // A peace between two others is the world's news (`worldNewsOfDay`).
      return undefined;
    }
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
  // A redirected march can finish today somewhere other than yesterday's destination.
  if (distanceKm(was.position, at) > ARRIVED_KM) return true;
  const end =
    was.kind === 'marching' || was.kind === 'retreating' ? was.waypoints.at(-1) : undefined;
  return !!end && distanceKm(end, at) <= ARRIVED_KM && distanceKm(was.position, at) > 0;
}

function distanceKm(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * An army by its name, from the day it was last seen, since a lost army is gone by the
 * end of the day. One raised and lost within the day is "your army" or "an army of" its owner.
 */
function calledOf(
  before: State,
  after: State,
  id: ArmyId,
  owner: FactionId = after.player,
): string {
  const army = after.armies[id] ?? before.armies[id];
  if (army) return armyTitle(after, army);
  return owner === after.player ? 'Your army' : `An army of ${factionName(after, owner)}`;
}

/** The armies by name, such as "First Legion and Second Legion". */
function namesOfArmies(state: State, ids: readonly ArmyId[]): string {
  const names = ids.flatMap((id) => {
    const army = state.armies[id];
    return army ? [armyTitle(state, army)] : [];
  });
  if (names.length === 0) return 'an army';
  return names.length === 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The war of the player with the faction, as a key that a new war after a peace changes. */
function warOnce(state: State, faction: FactionId): string {
  const key = warKey(state.player, faction);
  return `${key}@${state.wars[key]?.since ?? ''}`;
}

function namesOf(state: State, factions: readonly FactionId[]): string {
  const names = factions.map((faction) => factionName(state, faction));
  return names.length > 0 ? names.join(' and ') : 'an enemy';
}

function ownersOf(state: State, armies: readonly ArmyId[]): string {
  return namesOf(state, [...new Set(armies.flatMap((id) => state.armies[id]?.owner ?? []))]);
}
