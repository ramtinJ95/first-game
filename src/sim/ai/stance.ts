import type { Order } from '../orders/orders.ts';
import { STANCES, type Stance } from '../state/army.ts';
import { reforming, stanceEdge } from '../systems/battles.ts';
import type { Context } from './armies.ts';
import { formationsOf, sorted } from './situation.ts';

/**
 * Sets the stance of each of the faction's armies in a battle to the one that holds the
 * best edge over the stances of the enemy's men, by the battles' own `stanceEdge`. A
 * change costs `REFORM_DAYS` of being beaten, so after its first choice in a battle an army
 * changes again only while the enemy's stances beat its own and no enemy is re-forming,
 * and never while it re-forms itself. An army keeps its stance otherwise.
 */
export function stances({ state, faction }: Context): Order[] {
  const orders: Order[] = [];
  for (const army of sorted(state.armies)) {
    if (army.owner !== faction || army.activity.kind !== 'inBattle') continue;
    if (reforming(state, army)) continue;
    const battle = state.battles[army.activity.battle];
    if (!battle) continue;
    const enemies = battle.attackers.includes(army.id) ? battle.defenders : battle.attackers;
    const menIn = new Map<Stance, number>();
    let settled = true;
    for (const id of enemies) {
      const enemy = state.armies[id];
      if (!enemy) continue;
      if (reforming(state, enemy)) settled = false;
      const men = formationsOf(state, enemy).reduce((sum, f) => sum + f.men, 0);
      menIn.set(enemy.stance, (menIn.get(enemy.stance) ?? 0) + men);
    }
    const edge = (stance: Stance) =>
      [...menIn].reduce((sum, [theirs, men]) => sum + men * stanceEdge(stance, theirs), 0);
    const first = army.stanceChangedOn === undefined || army.stanceChangedOn < battle.startedOn;
    const beaten = edge(army.stance) < [...menIn.values()].reduce((a, b) => a + b, 0);
    if (!first && !(settled && beaten)) continue;
    let best = army.stance;
    for (const stance of STANCES) if (edge(stance) > edge(best)) best = stance;
    if (best !== army.stance)
      orders.push({ kind: 'setStance', faction, army: army.id, stance: best });
  }
  return orders;
}
