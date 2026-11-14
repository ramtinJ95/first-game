import { leaveSiege, removeArmy } from '../armies.ts';
import { emit, type BattleSideName } from '../events.ts';
import type { ArmyId, BattleId, FactionId } from '../ids.ts';
import { allocateId } from '../ids.ts';
import { removeRecord } from '../records.ts';
import { nextRandom } from '../rng.ts';
import type { Army, Stance } from '../state/army.ts';
import type { Battle } from '../state/battle.ts';
import type { Formation } from '../state/formation.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { landPath, MARCH_KM_PER_DAY, marchDays } from '../march.ts';
import { connected, surfaceAt } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import { TROOPS } from '../troops.ts';
import { recordBattleLosses, recordLoss } from '../peace/war-record.ts';
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
const MAX_BEHIND = 1.5;
/**
 * Each point of general's skill adds this share to the army's blows and its morale, so
 * the best general against none does not make up for a fifth more men.
 */
export const GENERAL_EFFECT = 0.015;
/** A formation loses at most this share of its men in a day, */
const MAX_DAILY_LOSS = 0.2;
/** or this many men, whichever is more, so only a remnant this small can die in one day. */
const REMNANT_MEN = 50;
/** Morale that a formation of an idle army regains each day. */
export const MORALE_RECOVERY = 0.05;
/**
 * Morale that a formation regains each day instead while its idle army stands within
 * REFUGE_KM of a city of its owner that no siege holds, so a beaten army that reached a
 * safe city can face the enemy that follows it.
 */
export const REFUGE_RECOVERY = 0.2;
export const REFUGE_KM = 10;
/** The share of its men that each formation of an army loses when it retreats by order. */
export const RETREAT_LOSS = 0.15;
/**
 * A beaten army is cut down as it breaks: each formation loses PURSUIT_BASE of its men,
 * plus PURSUIT_PER_RIDER for each unbroken enemy horseman per man of the army, up to
 * PURSUIT_MAX.
 */
const PURSUIT_BASE = 0.03;
const PURSUIT_PER_RIDER = 0.2;
const PURSUIT_MAX = 0.25;
/** A retreat goes to a city at least this far from every enemy it fled from. */
export const SAFE_KM = 2 * ENGAGEMENT_DISTANCE;
/** With no safe city, a retreat goes this far into the field, away from the enemy. */
export const FIELD_RETREAT_KM = 100;
/**
 * No retreat takes longer than this. A beaten army that walks farther to a city is back
 * to full morale later than one that falls back into the field and recovers there.
 */
export const MAX_RETREAT_DAYS =
  FIELD_RETREAT_KM / MARCH_KM_PER_DAY + 1 / MORALE_RECOVERY - 1 / REFUGE_RECOVERY;

/** How a stance scales the blows an army gives, the blows it takes, and the morale it loses. */
export const STANCE_EFFECTS: Record<Stance, { dealt: number; taken: number; morale: number }> = {
  holdTheLine: { dealt: 1, taken: 1, morale: 1 },
  allOutAssault: { dealt: 1.25, taken: 1.25, morale: 1 },
  skirmishAndWithdraw: { dealt: 0.75, taken: 0.75, morale: 1 },
};

/**
 * The stance each stance beats. A held line breaks an assault on its braced front, an
 * assault runs skirmishers down before they can withdraw, and skirmishers shoot down a
 * line that stands still. The army whose stance beats its enemy's deals STANCE_EDGE
 * times its blows to it, the beaten stance deals that much less, and the beaten side's
 * morale falls STANCE_EDGE times as fast, so the right stance is worth about a quarter
 * more men.
 */
export const STANCE_BEATS: Readonly<Record<Stance, Stance>> = {
  holdTheLine: 'allOutAssault',
  allOutAssault: 'skirmishAndWithdraw',
  skirmishAndWithdraw: 'holdTheLine',
};
export const STANCE_EDGE = 1.27;

/**
 * An army that changed its stance re-forms for this many days, counting the day of the
 * change, and every enemy that is not re-forming meets it as a stance that beats its own,
 * so a change is a commitment and a change a day is always beaten.
 */
export const REFORM_DAYS = 3;

/** Whether the army is still re-forming after a change of stance. */
export function reforming(state: { day: number }, army: Pick<Army, 'stanceChangedOn'>): boolean {
  return army.stanceChangedOn !== undefined && state.day - army.stanceChangedOn < REFORM_DAYS;
}

/** What one army multiplies its blows on another by, for their stances and their re-forming. */
export function edgeBetween(
  state: { readonly day: number },
  mine: Pick<Army, 'stance' | 'stanceChangedOn'>,
  theirs: Pick<Army, 'stance' | 'stanceChangedOn'>,
): number {
  const a = reforming(state, mine);
  const b = reforming(state, theirs);
  if (a && b) return 1;
  if (a) return 1 / STANCE_EDGE;
  if (b) return STANCE_EDGE;
  return stanceEdge(mine.stance, theirs.stance);
}

/**
 * What the two stances make of one army's blows on another: the striker's `dealt` times
 * the target's `taken`. Two armies that both skirmish cannot both keep their distance, so
 * between them the blows are normal, and their battle lasts as long as two that hold.
 */
export function stanceBlows(striker: Stance, target: Stance): number {
  if (striker === 'skirmishAndWithdraw' && target === 'skirmishAndWithdraw') return 1;
  return STANCE_EFFECTS[striker].dealt * STANCE_EFFECTS[target].taken;
}

/** What one army's stance multiplies its blows on another army by. */
export function stanceEdge(mine: Stance, theirs: Stance): number {
  if (STANCE_BEATS[mine] === theirs) return STANCE_EDGE;
  if (STANCE_BEATS[theirs] === mine) return 1 / STANCE_EDGE;
  return 1;
}

type Side = 'attackers' | 'defenders';

/**
 * Adds armies that come up to a running battle, starts battles between armies at
 * war that meet, plays one day of every battle, and lets idle armies regain morale.
 */
export function battles(state: GameState, world: World): void {
  recoverMorale(state);
  joinBattles(state);
  startBattles(state);
  for (const battle of sortedValues(state.battles)) {
    fightOneDay(state, battle.id);
    settle(state, world, battle.id);
  }
}

function recoverMorale(state: GameState) {
  const besieged = new Set(Object.values(state.sieges).map((siege) => siege.city));
  const refuges = Object.values(state.cities).filter((city) => !besieged.has(city.id));
  for (const army of Object.values(state.armies)) {
    const { activity } = army;
    if (activity.kind !== 'idle') continue;
    const sheltered = refuges.some(
      (city) =>
        city.owner === army.owner && distance(city.position, activity.position) <= REFUGE_KM,
    );
    const recovery = sheltered ? REFUGE_RECOVERY : MORALE_RECOVERY;
    for (const formation of formationsOf(state, army)) {
      formation.morale = Math.min(1, formation.morale + recovery);
    }
  }
}

/** An idle, marching, or besieging army that still has a formation willing to fight. */
function landPosition(state: GameState, army: Army): MapPoint | undefined {
  const { activity } = army;
  if (activity.kind !== 'idle' && activity.kind !== 'marching' && activity.kind !== 'besieging')
    return undefined;
  return formationsOf(state, army).some(isFighting) ? activity.position : undefined;
}

/**
 * Each free army joins a battle it is in reach of, again and again until none joins, so an
 * army that comes up to an enemy who has just joined a battle is drawn in after it.
 */
function joinBattles(state: GameState) {
  let joined = true;
  while (joined) {
    joined = false;
    for (const army of sortedValues(state.armies)) {
      const position = landPosition(state, army);
      if (!position) continue;
      for (const battle of sortedValues(state.battles)) {
        if (join(state, army, position, battle)) {
          joined = true;
          break;
        }
      }
    }
  }
}

/**
 * An army joins a battle that one of the armies in it stands within ENGAGEMENT_DISTANCE
 * of, so an enemy that one battle has already taken cannot walk past it.
 */
function join(state: GameState, army: Army, position: MapPoint, battle: Battle): boolean {
  const inReach = [...battle.attackers, ...battle.defenders].some((id) => {
    const other = state.armies[id]?.activity;
    return other?.kind === 'inBattle' && distance(position, other.position) <= ENGAGEMENT_DISTANCE;
  });
  if (!inReach && distance(position, battle.position) > ENGAGEMENT_DISTANCE) return false;
  const side = sideToJoin(state, army, battle.attackers, battle.defenders);
  if (!side) return false;
  battle[side].push(army.id);
  const { factions } = battle.sides[side];
  if (!factions.includes(army.owner)) factions.push(army.owner);
  enterBattle(state, army, position, battle.id);
  return true;
}

/** A marching army keeps the rest of its march, to take up again if it holds the field. */
function enterBattle(state: GameState, army: Army, position: MapPoint, battle: BattleId) {
  const march = army.activity.kind === 'marching' ? army.activity.waypoints : [];
  leaveSiege(state, army);
  army.activity = { kind: 'inBattle', position, battle, march };
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
 * Pairs each free army, in id order, with the nearest free enemy in range, and lets
 * the free armies in range of the new battle join it before the next pair is made. A marching
 * army attacks an idle or besieging one, which leaves its siege. Otherwise the army whose
 * id sorts first attacks.
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
      a.army.activity.kind !== 'marching' && nearest.army.activity.kind === 'marching'
        ? [nearest, a]
        : [a, nearest];
    const id = allocateId(state, 'battle');
    const battle: Battle = {
      id,
      position: midpoint(attacker.position, defender.position),
      attackers: [attacker.army.id],
      defenders: [defender.army.id],
      startedOn: state.day,
      sides: {
        attackers: { factions: [attacker.army.owner], lost: 0 },
        defenders: { factions: [defender.army.owner], lost: 0 },
      },
    };
    state.battles[id] = battle;
    for (const { army, position } of [attacker, defender]) {
      enterBattle(state, army, position, id);
      taken.add(army.id);
    }
    let joined = true;
    while (joined) {
      joined = false;
      for (const { army, position } of free) {
        if (taken.has(army.id) || !join(state, army, position, battle)) continue;
        taken.add(army.id);
        joined = true;
      }
    }
    emit(state, {
      kind: 'battleBegan',
      battle: id,
      position: { ...battle.position },
      attackers: [...battle.sides.attackers.factions],
      defenders: [...battle.sides.defenders.factions],
      forces: [...battle.attackers, ...battle.defenders].flatMap((id) => {
        const army = state.armies[id];
        return army ? [{ army: army.id, faction: army.owner, men: menOf(state, army) }] : [];
      }),
    });
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
      const blows = formation.men * troop.attack * generalFactor(army) * luck;
      for (const target of at) {
        const bonus = troop.bonus[TROOPS[target.formation.troop].category] ?? 1;
        const killed =
          (blows *
            stanceBlows(army.stance, target.army.stance) *
            edgeBetween(state, army, target.army) *
            (target.formation.men / atMen) *
            bonus *
            KILL_RATE) /
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
  const edges = new Map<Army, number>();
  for (const [fighters, enemies] of [
    [attackers, defenders],
    [defenders, attackers],
  ] as const) {
    for (const { army } of fighters) {
      if (!edges.has(army)) edges.set(army, edgeOn(state, army, enemies));
    }
  }
  const lostBy = {
    attackers: new Map<FactionId, number>(),
    defenders: new Map<FactionId, number>(),
  };
  for (const [side, fighters, pressure] of [
    ['attackers', attackers, pressureOn(attackerMen, defenderMen, attackersLost, defendersLost)],
    ['defenders', defenders, pressureOn(defenderMen, attackerMen, defendersLost, attackersLost)],
  ] as const) {
    for (const { formation, army } of fighters) {
      const cap = Math.max(Math.round(formation.men * MAX_DAILY_LOSS), REMNANT_MEN);
      const lost = Math.min(formation.men, cap, Math.round(losses.get(formation) ?? 0));
      battle.sides[side].lost += lost;
      lostBy[side].set(army.owner, (lostBy[side].get(army.owner) ?? 0) + lost);
      const moraleLost =
        ((lost / formation.men) * MORALE_PER_LOSS + DAILY_STRAIN) *
        pressure *
        (edges.get(army) ?? 1) *
        (STANCE_EFFECTS[army.stance].morale /
          (TROOPS[formation.troop].discipline * generalFactor(army)));
      formation.men -= lost;
      formation.morale = Math.max(0, formation.morale - moraleLost);
    }
  }
  recordBattleLosses(state, [
    { factions: battle.sides.attackers.factions, lost: lostBy.attackers },
    { factions: battle.sides.defenders.factions, lost: lostBy.defenders },
  ]);
}

/** The edge the enemy's stances hold over the army's, weighted by the enemy's men. */
function edgeOn(state: GameState, army: Army, enemies: readonly Fighter[]): number {
  let men = 0;
  let sum = 0;
  for (const { formation, army: enemy } of enemies) {
    men += formation.men;
    sum += formation.men * edgeBetween(state, enemy, army);
  }
  return men === 0 ? 1 : sum / men;
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
 * Removes emptied formations and armies, sends beaten armies away, and ends the battle
 * when a side has no army left in it. An army that holds the field takes up the march
 * it was on, or stands where it fought.
 */
function settle(state: GameState, world: World, id: BattleId) {
  const battle = state.battles[id];
  if (!battle) return;
  for (const side of ['attackers', 'defenders'] as const) {
    for (const armyId of [...battle[side]]) {
      const army = state.armies[armyId];
      if (!army) continue;
      removeEmptyFormations(state, army);
      if (army.formations.length === 0) {
        removeArmy(state, army, 'battle');
      } else if (!formationsOf(state, army).some(isFighting)) {
        retreatFromBattle(state, world, army, false);
      }
    }
  }
  if (battle.attackers.length > 0 && battle.defenders.length > 0) return;
  for (const armyId of [...battle.attackers, ...battle.defenders]) {
    const army = state.armies[armyId];
    if (army?.activity.kind !== 'inBattle') continue;
    const { position, march } = army.activity;
    army.activity =
      march.length > 0
        ? { kind: 'marching', position, waypoints: march }
        : { kind: 'idle', position };
  }
  const winner: BattleSideName | 'none' =
    battle.attackers.length > 0 ? 'attackers' : battle.defenders.length > 0 ? 'defenders' : 'none';
  emit(state, {
    kind: 'battleEnded',
    battle: id,
    position: { ...battle.position },
    startedOn: battle.startedOn,
    days: state.day - battle.startedOn + 1,
    winner,
    standing: [...battle.attackers, ...battle.defenders],
    attackers: { ...battle.sides.attackers, factions: [...battle.sides.attackers.factions] },
    defenders: { ...battle.sides.defenders, factions: [...battle.sides.defenders.factions] },
  });
  removeRecord(state.battles, id);
}

/**
 * Takes an army out of its battle, broken, and sends it to safety. Ordered out, each
 * formation loses RETREAT_LOSS of its men. Beaten, it loses what the enemy's horsemen
 * cut down as it breaks. It retreats to the nearest city its owner holds that a land
 * route of at most MAX_RETREAT_DAYS reaches, that is not besieged, that has no enemy army
 * within ENGAGEMENT_DISTANCE, and that lies at least SAFE_KM from every army it fought.
 * With no such city it goes FIELD_RETREAT_KM into the field, as directly away from those
 * armies as the land allows. With neither it surrenders. No battle takes it until it arrives. The battle may be left
 * with an empty side, which the battles system ends the same day.
 */
export function retreatFromBattle(
  state: GameState,
  world: World,
  army: Army,
  ordered: boolean,
): void {
  const { activity } = army;
  if (activity.kind !== 'inBattle') return;
  const battle = state.battles[activity.battle];
  const side: BattleSideName = battle?.attackers.includes(army.id) ? 'attackers' : 'defenders';
  const enemyIds = battle ? battle[side === 'attackers' ? 'defenders' : 'attackers'] : [];
  const before = menOf(state, army);
  const share = ordered ? RETREAT_LOSS : pursuitShare(fightersOf(state, enemyIds), before);
  for (const formation of formationsOf(state, army)) {
    formation.men -= Math.round(formation.men * share);
    formation.morale = 0;
  }
  const lost = before - menOf(state, army);
  const foesOf = battle
    ? battle.sides[side === 'attackers' ? 'defenders' : 'attackers'].factions
    : [];
  recordLoss(state, army.owner, foesOf, lost);
  if (battle) {
    battle.sides[side].lost += lost;
    battle.attackers = battle.attackers.filter((id) => id !== army.id);
    battle.defenders = battle.defenders.filter((id) => id !== army.id);
  }
  removeEmptyFormations(state, army);
  if (army.formations.length === 0) {
    removeArmy(state, army, 'battle');
    return;
  }
  const from = activity.position;
  const foes = enemyIds.flatMap((id) => {
    const enemy = state.armies[id];
    return enemy && enemy.activity.kind !== 'embarked' ? [enemy.activity.position] : [];
  });
  const path = retreatPath(state, world, army.owner, from, foes, battle?.position ?? from);
  if (!path) {
    if (battle) battle.sides[side].lost += menOf(state, army);
    recordLoss(state, army.owner, foesOf, menOf(state, army));
    removeArmy(state, army, 'surrender');
    return;
  }
  army.activity = { kind: 'retreating', position: { x: from.x, y: from.y }, waypoints: path };
  emit(state, {
    kind: 'armyRetreated',
    army: army.id,
    owner: army.owner,
    from: { ...from },
    to: { ...(path.at(-1) as MapPoint) },
    ordered,
    lost,
    men: menOf(state, army),
  });
}

function pursuitShare(enemies: readonly Fighter[], men: number): number {
  if (men === 0) return 0;
  const riders = enemies
    .filter(({ formation }) => TROOPS[formation.troop].category === 'cavalry')
    .reduce((sum, { formation }) => sum + formation.men, 0);
  return Math.min(PURSUIT_MAX, PURSUIT_BASE + (PURSUIT_PER_RIDER * riders) / men);
}

/** Unit vectors turned from straight away, nearest first, to try for a retreat into the field. */
const AWAY_TURNS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.8660254037844386, 0.5],
  [0.8660254037844386, -0.5],
  [0.5, 0.8660254037844386],
  [0.5, -0.8660254037844386],
  [0, 1],
  [0, -1],
  [-0.5, 0.8660254037844386],
  [-0.5, -0.8660254037844386],
  [-1, 0],
];

function retreatPath(
  state: GameState,
  world: World,
  owner: FactionId,
  from: MapPoint,
  foes: readonly MapPoint[],
  battlePosition: MapPoint,
): MapPoint[] | undefined {
  const refuge = refugePath(state, world, owner, from, foes);
  if (refuge) return refuge;
  const centre =
    foes.length > 0
      ? {
          x: foes.reduce((sum, p) => sum + p.x, 0) / foes.length,
          y: foes.reduce((sum, p) => sum + p.y, 0) / foes.length,
        }
      : battlePosition;
  const dx = from.x - centre.x;
  const dy = from.y - centre.y;
  const length = Math.hypot(dx, dy);
  const [ux, uy] = length > 0 ? [dx / length, dy / length] : [1, 0];
  for (const [cos, sin] of AWAY_TURNS) {
    const to = {
      x: Math.round((from.x + FIELD_RETREAT_KM * (ux * cos - uy * sin)) * 10) / 10,
      y: Math.round((from.y + FIELD_RETREAT_KM * (ux * sin + uy * cos)) * 10) / 10,
    };
    if (surfaceAt(world.mesh, to) !== 'land' || !connected(world.mesh, from, to, 'land')) continue;
    const path = landPath(world, from, to);
    if (typeof path !== 'string' && marchDays(from, path) <= MAX_RETREAT_DAYS) return path;
  }
  return undefined;
}

/** The shortest land path to a safe city of the owner within MAX_RETREAT_DAYS, if any. */
function refugePath(
  state: GameState,
  world: World,
  owner: FactionId,
  from: MapPoint,
  foes: readonly MapPoint[],
): MapPoint[] | undefined {
  const besieged = new Set(Object.values(state.sieges).map((siege) => siege.city));
  const hostile = Object.values(state.armies).flatMap((army) =>
    army.activity.kind !== 'embarked' && areAtWar(state, owner, army.owner)
      ? [army.activity.position]
      : [],
  );
  const reach = MAX_RETREAT_DAYS * MARCH_KM_PER_DAY;
  const near = Object.values(state.cities)
    .map((city) => ({ city, km: distance(from, city.position) }))
    .filter(({ city, km }) => city.owner === owner && km <= reach && !besieged.has(city.id))
    .sort((a, b) => a.km - b.km || (a.city.id < b.city.id ? -1 : 1));
  let best: { path: MapPoint[]; days: number } | undefined;
  for (const { city, km } of near) {
    // No road is shorter than the straight line, so no later city can be nearer by road.
    if (best && km / MARCH_KM_PER_DAY >= best.days) break;
    if (foes.some((foe) => distance(foe, city.position) < SAFE_KM)) continue;
    if (hostile.some((enemy) => distance(enemy, city.position) <= ENGAGEMENT_DISTANCE)) continue;
    if (!connected(world.mesh, from, city.position, 'land')) continue;
    const path = landPath(world, from, city.position);
    if (typeof path === 'string') continue;
    const days = marchDays(from, path);
    if (days <= MAX_RETREAT_DAYS && days < (best?.days ?? Number.POSITIVE_INFINITY)) {
      best = { path, days };
    }
  }
  return best?.path;
}

export function removeEmptyFormations(state: GameState, army: Army): void {
  for (const formation of formationsOf(state, army)) {
    if (formation.men === 0) removeRecord(state.formations, formation.id);
  }
  army.formations = army.formations.filter((id) => Object.hasOwn(state.formations, id));
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

function menOf(state: GameState, army: Army): number {
  return formationsOf(state, army).reduce((sum, formation) => sum + formation.men, 0);
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
