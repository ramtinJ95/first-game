import type { ArmyId, BattleId } from '../ids.ts';
import { allocateId } from '../ids.ts';
import { removeRecord } from '../records.ts';
import { nextRandom } from '../rng.ts';
import type { Army, Stance } from '../state/army.ts';
import type { Formation } from '../state/formation.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { TROOPS } from '../troops.ts';
import { areAtWar } from '../wars.ts';

/**
 * Armies at war this close, in kilometres, lock into a battle. It is at least half
 * a day's march for two armies, so two armies that march at each other cannot pass
 * between ticks.
 */
export const ENGAGEMENT_DISTANCE = 25;

/** The share of the enemy's men that one man of attack 1 kills per day against defence 1. */
const KILL_RATE = 0.045;
/** Morale lost per share of a formation's men lost in a day. */
const MORALE_PER_LOSS = 1.5;
/** Morale lost each day of fighting at even numbers, before any losses. */
const DAILY_STRAIN = 0.02;
/** Each draw scales a formation's blows by a factor in [1 - LUCK, 1 + LUCK). */
const LUCK = 0.4;
/** How strongly falling behind in today's losses costs extra morale, and its cap. */
const BEHIND_WEIGHT = 1;
const MAX_BEHIND = 2;
/** Each point of general's skill adds this share to the army's blows and its morale. */
const GENERAL_EFFECT = 0.04;
/** Morale that a formation of an idle army regains each day. */
export const MORALE_RECOVERY = 0.05;
/** The share of its men that each formation of an army loses when it retreats by order. */
export const RETREAT_LOSS = 0.15;

/** How a stance scales the blows an army gives, the blows it takes, and the morale it loses. */
const STANCE_EFFECTS: Record<Stance, { dealt: number; taken: number; morale: number }> = {
  holdTheLine: { dealt: 1, taken: 1, morale: 1 },
  allOutAssault: { dealt: 1.5, taken: 1.4, morale: 1 },
  skirmishAndWithdraw: { dealt: 0.6, taken: 0.6, morale: 2.5 },
};

type Side = 'attackers' | 'defenders';

/**
 * Starts battles between armies at war that meet, adds armies that come up to a
 * battle, the new ones included, plays one day of every battle, and lets idle armies regain morale.
 */
export function battles(state: GameState): void {
  recoverMorale(state);
  startBattles(state);
  joinBattles(state);
  for (const battle of sortedValues(state.battles)) {
    fightOneDay(state, battle.id);
    settle(state, battle.id);
  }
}

function recoverMorale(state: GameState) {
  for (const army of Object.values(state.armies)) {
    if (army.activity.kind !== 'idle') continue;
    for (const formation of formationsOf(state, army)) {
      formation.morale = Math.min(1, formation.morale + MORALE_RECOVERY);
    }
  }
}

/** An idle or marching army that still has a formation willing to fight. */
function landPosition(state: GameState, army: Army): MapPoint | undefined {
  const { activity } = army;
  if (activity.kind !== 'idle' && activity.kind !== 'marching') return undefined;
  return formationsOf(state, army).some(isFighting) ? activity.position : undefined;
}

function joinBattles(state: GameState) {
  for (const army of sortedValues(state.armies)) {
    const position = landPosition(state, army);
    if (!position) continue;
    for (const battle of sortedValues(state.battles)) {
      if (distance(position, battle.position) > ENGAGEMENT_DISTANCE) continue;
      const side = sideToJoin(state, army, battle.attackers, battle.defenders);
      if (!side) continue;
      battle[side].push(army.id);
      army.activity = { kind: 'inBattle', position, battle: battle.id };
      break;
    }
  }
}

/**
 * The side the army can join: it is at war with every army on the other side and
 * with none on this one, so every pair of armies that strike each other is at war.
 */
function sideToJoin(
  state: GameState,
  army: Army,
  attackers: readonly ArmyId[],
  defenders: readonly ArmyId[],
): Side | undefined {
  const atWarWith = (id: ArmyId) => {
    const other = state.armies[id];
    return !!other && areAtWar(state, army.owner, other.owner);
  };
  const canJoin = (own: readonly ArmyId[], enemy: readonly ArmyId[]) =>
    enemy.length > 0 && enemy.every(atWarWith) && !own.some(atWarWith);
  if (canJoin(defenders, attackers)) return 'defenders';
  if (canJoin(attackers, defenders)) return 'attackers';
  return undefined;
}

/**
 * Pairs each free army, in id order, with the nearest free enemy in range. A marching
 * army attacks an idle one. Otherwise the army whose id sorts first attacks.
 */
function startBattles(state: GameState) {
  const free = sortedValues(state.armies).flatMap((army) => {
    const position = landPosition(state, army);
    return position ? [{ army, position }] : [];
  });
  const taken = new Set<ArmyId>();
  for (const a of free) {
    if (taken.has(a.army.id)) continue;
    let nearest: (typeof free)[number] | undefined;
    let nearestDistance = ENGAGEMENT_DISTANCE;
    for (const b of free) {
      if (taken.has(b.army.id) || !areAtWar(state, a.army.owner, b.army.owner)) continue;
      const d = distance(a.position, b.position);
      if (d <= nearestDistance && (!nearest || d < nearestDistance)) {
        nearest = b;
        nearestDistance = d;
      }
    }
    if (!nearest) continue;
    const [attacker, defender] =
      a.army.activity.kind === 'idle' && nearest.army.activity.kind === 'marching'
        ? [nearest, a]
        : [a, nearest];
    const id = allocateId(state, 'battle');
    state.battles[id] = {
      id,
      position: midpoint(attacker.position, defender.position),
      attackers: [attacker.army.id],
      defenders: [defender.army.id],
      startedOn: state.day,
    };
    for (const { army, position } of [attacker, defender]) {
      army.activity = { kind: 'inBattle', position, battle: id };
      taken.add(army.id);
    }
  }
}

interface Fighter {
  formation: Formation;
  army: Army;
}

/** Both sides strike at once: every loss is worked out before any is taken. */
function fightOneDay(state: GameState, id: BattleId) {
  const battle = state.battles[id];
  if (!battle) return;
  const attackers = fightersOf(state, battle.attackers);
  const defenders = fightersOf(state, battle.defenders);
  const attackerMen = sumMen(attackers);
  const defenderMen = sumMen(defenders);
  if (attackerMen === 0 || defenderMen === 0) return;

  const losses = new Map<Formation, number>();
  const strike = (from: Fighter[], at: Fighter[], atMen: number) => {
    for (const { formation, army } of from) {
      const troop = TROOPS[formation.troop];
      const luck = 1 + LUCK * (2 * nextRandom(state) - 1);
      const blows =
        formation.men *
        troop.attack *
        STANCE_EFFECTS[army.stance].dealt *
        generalFactor(army) *
        luck;
      for (const target of at) {
        const bonus = troop.bonus[TROOPS[target.formation.troop].category] ?? 1;
        const killed =
          (blows *
            (target.formation.men / atMen) *
            bonus *
            KILL_RATE *
            STANCE_EFFECTS[target.army.stance].taken) /
          TROOPS[target.formation.troop].defence;
        losses.set(target.formation, (losses.get(target.formation) ?? 0) + killed);
      }
    }
  };
  strike(attackers, defenders, defenderMen);
  strike(defenders, attackers, attackerMen);

  const shareLost = (fighters: Fighter[], men: number) =>
    fighters.reduce((sum, { formation }) => sum + (losses.get(formation) ?? 0), 0) / men;
  const attackersLost = shareLost(attackers, attackerMen);
  const defendersLost = shareLost(defenders, defenderMen);
  for (const [fighters, pressure] of [
    [attackers, pressureOn(attackerMen, defenderMen, attackersLost, defendersLost)],
    [defenders, pressureOn(defenderMen, attackerMen, defendersLost, attackersLost)],
  ] as const) {
    for (const { formation, army } of fighters) {
      const lost = Math.min(formation.men, Math.round(losses.get(formation) ?? 0));
      const moraleLost =
        ((lost / formation.men) * MORALE_PER_LOSS + DAILY_STRAIN) *
        pressure *
        (STANCE_EFFECTS[army.stance].morale /
          (TROOPS[formation.troop].discipline * generalFactor(army)));
      formation.men -= lost;
      formation.morale = Math.max(0, formation.morale - moraleLost);
    }
  }
}

/**
 * Scales a side's morale loss by how badly it is outnumbered and by how its share of
 * men lost today compares with the enemy's, so the side that falls behind breaks first.
 */
function pressureOn(men: number, enemyMen: number, shareLost: number, enemyShareLost: number) {
  const behind = enemyShareLost > 0 ? shareLost / enemyShareLost : MAX_BEHIND;
  return (
    Math.sqrt(enemyMen / men) *
    Math.min(MAX_BEHIND, Math.max(1 / MAX_BEHIND, behind)) ** BEHIND_WEIGHT
  );
}

/**
 * Removes emptied formations and armies, sends beaten armies home, and ends the battle
 * when a side has no army left in it.
 */
function settle(state: GameState, id: BattleId) {
  const battle = state.battles[id];
  if (!battle) return;
  for (const side of ['attackers', 'defenders'] as const) {
    for (const armyId of [...battle[side]]) {
      const army = state.armies[armyId];
      if (!army) continue;
      removeEmptyFormations(state, army);
      if (army.formations.length === 0) {
        battle[side] = battle[side].filter((other) => other !== armyId);
        removeArmy(state, army);
      } else if (!formationsOf(state, army).some(isFighting)) {
        retreatFromBattle(state, army);
      }
    }
  }
  if (battle.attackers.length > 0 && battle.defenders.length > 0) return;
  for (const armyId of [...battle.attackers, ...battle.defenders]) {
    const army = state.armies[armyId];
    if (army?.activity.kind === 'inBattle') {
      army.activity = { kind: 'idle', position: army.activity.position };
    }
  }
  removeRecord(state.battles, id);
}

/**
 * Takes an army out of its battle and sets it marching to the nearest city its owner
 * holds. An army whose owner holds no city has nowhere to go and surrenders. The
 * battle may be left with an empty side, which the battles system ends the same day.
 */
export function retreatFromBattle(state: GameState, army: Army): void {
  const { activity } = army;
  if (activity.kind !== 'inBattle') return;
  const battle = state.battles[activity.battle];
  if (battle) {
    battle.attackers = battle.attackers.filter((id) => id !== army.id);
    battle.defenders = battle.defenders.filter((id) => id !== army.id);
  }
  const home = nearestOwnCity(state, army, activity.position);
  if (!home) {
    removeArmy(state, army);
    return;
  }
  army.activity = { kind: 'marching', position: activity.position, destination: home };
}

function nearestOwnCity(state: GameState, army: Army, from: MapPoint): MapPoint | undefined {
  let best: MapPoint | undefined;
  for (const city of sortedValues(state.cities)) {
    if (city.owner !== army.owner) continue;
    if (!best || distance(from, city.position) < distance(from, best)) best = city.position;
  }
  return best && { x: best.x, y: best.y };
}

export function removeEmptyFormations(state: GameState, army: Army): void {
  for (const formation of formationsOf(state, army)) {
    if (formation.men === 0) removeRecord(state.formations, formation.id);
  }
  army.formations = army.formations.filter((id) => Object.hasOwn(state.formations, id));
}

function removeArmy(state: GameState, army: Army) {
  for (const id of army.formations) removeRecord(state.formations, id);
  removeRecord(state.armies, army.id);
}

function fightersOf(state: GameState, ids: readonly ArmyId[]): Fighter[] {
  return ids.flatMap((id) => {
    const army = state.armies[id];
    if (!army) return [];
    return formationsOf(state, army)
      .filter(isFighting)
      .map((formation) => ({ formation, army }));
  });
}

function formationsOf(state: GameState, army: Army): Formation[] {
  return army.formations.flatMap((id) => state.formations[id] ?? []);
}

function isFighting(formation: Formation): boolean {
  return formation.men > 0 && formation.morale > 0;
}

function generalFactor(army: Army): number {
  return 1 + GENERAL_EFFECT * army.generalSkill;
}

function sumMen(fighters: Fighter[]): number {
  return fighters.reduce((sum, { formation }) => sum + formation.men, 0);
}

function sortedValues<V extends { id: string }>(records: Record<string, V>): V[] {
  return Object.values(records).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: MapPoint, b: MapPoint): MapPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
