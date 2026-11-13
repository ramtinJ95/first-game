import { leaveSiege } from '../armies.ts';
import type { FactionId } from '../ids.ts';
import { landOwnerAt, sailHome, sendHome } from '../peace/home.ts';
import { removeRecord } from '../records.ts';
import type { Army } from '../state/army.ts';
import type { GameState } from '../state/game-state.ts';
import { warSides } from '../state/war.ts';
import type { World } from '../world/world.ts';

/**
 * Parts the two sides of a peace. On its day, after the day's orders, their armies leave
 * the battles they fight against each other and the sieges of each other's cities, and
 * every army of either side marching or sailing to the other's land turns home. On every
 * day of the truce, an idle army of either side on the other's land goes on home, so an
 * army that reached a shore takes ship. No army is lost by it. It runs first in the day,
 * so the march home starts at once.
 */
export function homecoming(state: GameState, world: World): void {
  for (const [key, truce] of Object.entries(state.truces)) {
    const sides = truce.endsOn > state.day ? warSides(key) : undefined;
    if (sides) part(state, world, sides, truce.since === state.day);
  }
}

function part(
  state: GameState,
  world: World,
  [a, b]: readonly [FactionId, FactionId],
  today: boolean,
) {
  const other = (owner: FactionId) => (owner === a ? b : owner === b ? a : undefined);
  const parted: Army[] = [];
  if (!today) {
    for (const id of Object.keys(state.armies).sort()) {
      const army = state.armies[id as keyof typeof state.armies];
      const enemy = army && other(army.owner);
      if (
        army?.activity.kind === 'idle' &&
        enemy &&
        landOwnerAt(state, army.activity.position) === enemy
      ) {
        sendHome(state, world, army);
      }
    }
    return;
  }
  for (const id of Object.keys(state.battles).sort()) {
    const battle = state.battles[id as keyof typeof state.battles];
    if (!battle) continue;
    const ownersOf = (ids: readonly string[]) =>
      new Set(ids.map((army) => state.armies[army as keyof typeof state.armies]?.owner));
    const attackers = ownersOf(battle.attackers);
    const defenders = ownersOf(battle.defenders);
    const leaves = (army: Army | undefined, enemies: Set<FactionId | undefined>) => {
      const enemy = army && other(army.owner);
      return !!enemy && enemies.has(enemy);
    };
    for (const side of ['attackers', 'defenders'] as const) {
      const enemies = side === 'attackers' ? defenders : attackers;
      for (const armyId of [...battle[side]]) {
        const army = state.armies[armyId];
        if (!army || army.activity.kind !== 'inBattle' || !leaves(army, enemies)) continue;
        battle[side] = battle[side].filter((id) => id !== armyId);
        army.activity = { kind: 'idle', position: army.activity.position };
        parted.push(army);
      }
    }
    if (battle.attackers.length === 0 && battle.defenders.length === 0) {
      removeRecord(state.battles, battle.id);
    }
  }

  for (const army of Object.values(state.armies)) {
    const enemy = other(army.owner);
    if (!enemy || army.activity.kind !== 'besieging') continue;
    const siege = state.sieges[army.activity.siege];
    const city = siege && state.cities[siege.city];
    if (city?.owner === enemy) leaveSiege(state, army);
  }

  for (const id of Object.keys(state.armies).sort()) {
    const army = state.armies[id as keyof typeof state.armies];
    const enemy = army && other(army.owner);
    if (!army || !enemy) continue;
    const { activity } = army;
    if (activity.kind !== 'idle' && activity.kind !== 'marching') continue;
    const end = activity.kind === 'marching' ? activity.waypoints.at(-1) : undefined;
    const onTheirLand = landOwnerAt(state, activity.position) === enemy;
    const bound = end !== undefined && landOwnerAt(state, end) === enemy;
    if (onTheirLand || bound || parted.includes(army)) sendHome(state, world, army);
  }

  for (const id of Object.keys(state.convoys).sort()) {
    const convoy = state.convoys[id as keyof typeof state.convoys];
    const enemy = convoy && other(convoy.owner);
    const end = convoy?.waypoints.at(-1);
    if (convoy && enemy && end && landOwnerAt(state, end) === enemy) sailHome(state, world, convoy);
  }
}
