import type { Pick } from '../render/pick.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { ArmyId, FactionId } from '../sim/ids.ts';
import type { Army, ArmyActivity } from '../sim/state/army.ts';
import type { Battle } from '../sim/state/battle.ts';
import type { Day } from '../sim/state/day.ts';
import type { Stores } from '../sim/state/faction.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { factionName, placeName, TROOP_NAMES } from './names.ts';

export type AlertKind =
  | 'battleBegan'
  | 'battleEnded'
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
 * What the player should hear about from one day to the next, worked out by
 * comparing the two states. It concerns the player's own armies, cities, and stores.
 */
export function alertsBetween(before: State, after: State): Alert[] {
  const player = after.player;
  const day = after.day;
  const alerts: Alert[] = [];
  const add = (alert: Omit<Alert, 'day'>) => alerts.push({ ...alert, day });

  for (const battle of Object.values(after.battles)) {
    if (before.battles[battle.id] || !fightsIn(after, battle, player)) continue;
    const enemies =
      sideOf(after, battle, player) === 'attackers' ? battle.defenders : battle.attackers;
    add({
      kind: 'battleBegan',
      tone: 'neutral',
      text: `Battle ${placeName(after, battle.position)} against ${ownersOf(after, enemies)}`,
      focus: { at: battle.position, select: { kind: 'battle', battle: battle.id } },
    });
  }

  for (const battle of Object.values(before.battles)) {
    if (after.battles[battle.id] || !fightsIn(before, battle, player)) continue;
    const ours = sideOf(before, battle, player);
    const theirs = ours === 'attackers' ? 'defenders' : 'attackers';
    const where = placeName(before, battle.position);
    const standing = battle[ours ?? 'attackers'].find((id) => heldField(before, after, id));
    if (standing) {
      add({
        kind: 'battleEnded',
        tone: 'good',
        text: `You held the field ${where}`,
        focus: { at: battle.position, select: { kind: 'army', army: standing } },
      });
    } else if (battle[theirs].some((id) => heldField(before, after, id))) {
      add({
        kind: 'battleEnded',
        tone: 'bad',
        text: `${ownersOf(before, battle[theirs])} held the field ${where}`,
        focus: { at: battle.position },
      });
    } else {
      add({
        kind: 'battleEnded',
        tone: 'neutral',
        text: `The battle ${where} ended with neither side holding the field`,
        focus: { at: battle.position },
      });
    }
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
    } else if (army.activity.kind !== 'marching' && arrived(was.activity, at)) {
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

function positionOf(state: State, army: DeepReadonly<Army>): MapPoint | undefined {
  const { activity } = army;
  return activity.kind === 'embarked'
    ? state.convoys[activity.convoy]?.position
    : activity.position;
}

function fightsIn(state: State, battle: DeepReadonly<Battle>, faction: FactionId): boolean {
  return sideOf(state, battle, faction) !== undefined;
}

function sideOf(
  state: State,
  battle: DeepReadonly<Battle>,
  faction: FactionId,
): 'attackers' | 'defenders' | undefined {
  const owns = (id: ArmyId) => state.armies[id]?.owner === faction;
  if (battle.attackers.some(owns)) return 'attackers';
  if (battle.defenders.some(owns)) return 'defenders';
  return undefined;
}

/**
 * A beaten army is gone, marches home, or has already reached a home close by. An
 * army still standing where it fought held the field.
 */
function heldField(before: State, after: State, id: ArmyId): boolean {
  const was = before.armies[id]?.activity;
  const is = after.armies[id]?.activity;
  if (!was || !is || was.kind === 'embarked' || is.kind === 'embarked') return false;
  return is.kind !== 'marching' && distanceKm(was.position, is.position) <= ARRIVED_KM;
}

/**
 * The army reached the end of its march. A march shorter than a day starts and ends
 * between two days and is never seen, so an army that stands somewhere new arrived too.
 */
function arrived(was: DeepReadonly<ArmyActivity>, at: MapPoint): boolean {
  if (was.kind === 'embarked') return false;
  if (was.kind !== 'marching') return distanceKm(was.position, at) > ARRIVED_KM;
  const end = was.waypoints.at(-1);
  return !!end && distanceKm(end, at) <= ARRIVED_KM;
}

function distanceKm(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ownersOf(state: State, armies: readonly ArmyId[]): string {
  const owners = [...new Set(armies.flatMap((id) => state.armies[id]?.owner ?? []))].map((owner) =>
    factionName(state, owner),
  );
  return owners.length > 0 ? owners.join(' and ') : 'an enemy';
}
