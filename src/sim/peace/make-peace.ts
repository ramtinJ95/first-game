import { leaveSiege } from '../armies.ts';
import { emit } from '../events.ts';
import type { ArmyId, FactionId } from '../ids.ts';
import { removeRecord } from '../records.ts';
import type { Day } from '../state/day.ts';
import type { GameState } from '../state/game-state.ts';
import type { PeaceTerms } from '../state/peace.ts';
import { warKey } from '../state/war.ts';
import { payTerms } from './terms.ts';
import { TRUCE_DAYS } from './truce.ts';

/**
 * Ends the war between the two on the terms, which the caller checked, and starts a truce.
 * Their armies leave at once the battles they fight against each other and the sieges of
 * each other's cities, so no later order of the day storms or fights on, and no army is
 * lost. That comes before any city changes hands, so a siege of a ceded city ends too.
 * They go home when the homecoming system runs the same day, after every order.
 */
export function makePeace(state: GameState, a: FactionId, b: FactionId, terms: PeaceTerms): void {
  const key = warKey(a, b);
  part(state, a, b);
  if (terms.kind === 'payment') payTerms(state, terms, terms.payer === a ? b : a);
  removeRecord(state.wars, key);
  removeRecord(state.peaceOffers, key);
  state.truces[key] = { since: state.day, endsOn: (state.day + TRUCE_DAYS) as Day };
  emit(state, { kind: 'peaceMade', between: [a, b], terms });
}

/** Takes the armies of each side out of the battles against the other and the sieges of its cities. */
function part(state: GameState, a: FactionId, b: FactionId) {
  const other = (owner: FactionId | undefined) => (owner === a ? b : owner === b ? a : undefined);
  for (const id of Object.keys(state.battles).sort()) {
    const battle = state.battles[id as keyof typeof state.battles];
    if (!battle) continue;
    const ownersOf = (ids: readonly ArmyId[]) =>
      new Set(ids.map((army) => state.armies[army]?.owner));
    const owners = { attackers: ownersOf(battle.attackers), defenders: ownersOf(battle.defenders) };
    for (const side of ['attackers', 'defenders'] as const) {
      const enemies = owners[side === 'attackers' ? 'defenders' : 'attackers'];
      for (const armyId of [...battle[side]]) {
        const army = state.armies[armyId];
        const enemy = other(army?.owner);
        if (!army || army.activity.kind !== 'inBattle' || !enemy || !enemies.has(enemy)) continue;
        battle[side] = battle[side].filter((id) => id !== armyId);
        army.activity = { kind: 'idle', position: army.activity.position };
      }
    }
    if (battle.attackers.length === 0 && battle.defenders.length === 0) {
      removeRecord(state.battles, battle.id);
    }
  }
  for (const army of Object.values(state.armies)) {
    if (army.activity.kind !== 'besieging') continue;
    const siege = state.sieges[army.activity.siege];
    const city = siege && state.cities[siege.city];
    if (city && city.owner === other(army.owner)) leaveSiege(state, army);
  }
}
