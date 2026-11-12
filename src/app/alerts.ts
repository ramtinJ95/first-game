import type { Pick } from '../render/pick.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { BattleSideOutcome, DayEvent } from '../sim/events.ts';
import type { ArmyId, FactionId } from '../sim/ids.ts';
import type { Army, ArmyActivity } from '../sim/state/army.ts';
import type { Day } from '../sim/state/day.ts';
import type { Stores } from '../sim/state/faction.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { areAtWar } from '../sim/wars.ts';
import { factionName, placeName, TROOP_NAMES } from './names.ts';

export type AlertKind =
  | 'battleBegan'
  | 'battleEnded'
  | 'armyRetreated'
  | 'armyDestroyed'
  | 'armyDeserted'
  | 'warDeclared'
  | 'armyArrived'
  | 'formationMustered'
  | 'cityChangedOwner'
  | 'siegeBegan'
  | 'storeRanOut';

export interface Alert {
  readonly kind: AlertKind;
  readonly day: Day;
  readonly text: string;
  /** Good and bad news read apart at a glance. */
  readonly tone: 'good' | 'bad' | 'neutral';
  /** Where a click on the alert takes the camera and what it selects. A store has no place. */
  readonly focus?: { readonly at: MapPoint; readonly select?: Pick };
}

type State = DeepReadonly<GameState>;

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
): Alert[] {
  const player = after.player;
  const day = after.day;
  const alerts: Alert[] = [];
  const add = (alert: Omit<Alert, 'day'>) => alerts.push({ ...alert, day });

  for (const event of events) {
    const alert = eventAlert(before, after, event);
    if (alert) add(alert);
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

  for (const formation of Object.values(after.formations)) {
    if (before.formations[formation.id]) continue;
    const army = after.armies[formation.army];
    const at = army && positionOf(after, army);
    if (!army || army.owner !== player || !at) continue;
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

  const had = before.factions[player]?.stores;
  const has = after.factions[player]?.stores;
  if (had && has) {
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
        if (event.winner === 'none') {
          return {
            kind: 'battleEnded',
            tone: 'neutral',
            text: `The battle ${where} ended with neither side holding the field`,
            focus: { at: event.position },
          };
        }
        const beaten = event.winner === 'attackers' ? event.defenders : event.attackers;
        return {
          kind: 'battleEnded',
          tone: 'neutral',
          text: `${namesOf(after, event[event.winner].factions)} beat ${namesOf(after, beaten.factions)} ${where}`,
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
          text: `The battle ${where} ended with neither side holding the field. ${losses}`,
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
      if (event.owner !== player || isShort(before, player)) return undefined;
      return {
        kind: 'armyDeserted',
        tone: 'bad',
        text: `${event.men} men deserted your army ${placeName(after, event.position)}`,
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

const LOSS_TEXT: Record<DeepReadonly<DayEvent & { kind: 'armyDestroyed' }>['cause'], string> = {
  battle: 'was destroyed in battle',
  surrender: 'surrendered',
  storm: 'was lost storming the walls',
  defeat: 'laid down its arms',
};

function lossesText(
  state: State,
  ours: DeepReadonly<BattleSideOutcome>,
  theirs: DeepReadonly<BattleSideOutcome>,
): string {
  return `You lost ${ours.lost} men, ${namesOf(state, theirs.factions)} lost ${theirs.lost}.`;
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
