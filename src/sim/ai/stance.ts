import type { Order } from '../orders/orders.ts';
import { STANCES, type Stance } from '../state/army.ts';
import { stanceEdge } from '../systems/battles.ts';
import type { Context } from './armies.ts';
import { formationsOf, sorted } from './situation.ts';

/**
 * Sets the stance of each of the faction's armies in a battle to the one that holds the
 * best edge over the stances of the enemy's men, by the battles' own `stanceEdge`. An
 * army keeps its stance when no other does better.
 */
export function stances({ state, faction }: Context): Order[] {
  const orders: Order[] = [];
  for (const army of sorted(state.armies)) {
    if (army.owner !== faction || army.activity.kind !== 'inBattle') continue;
    const battle = state.battles[army.activity.battle];
    if (!battle) continue;
    const enemies = battle.attackers.includes(army.id) ? battle.defenders : battle.attackers;
    const menIn = new Map<Stance, number>();
    for (const id of enemies) {
      const enemy = state.armies[id];
      if (!enemy) continue;
      const men = formationsOf(state, enemy).reduce((sum, f) => sum + f.men, 0);
      menIn.set(enemy.stance, (menIn.get(enemy.stance) ?? 0) + men);
    }
    const edge = (stance: Stance) =>
      [...menIn].reduce((sum, [theirs, men]) => sum + men * stanceEdge(stance, theirs), 0);
    let best = army.stance;
    for (const stance of STANCES) if (edge(stance) > edge(best)) best = stance;
    if (best !== army.stance)
      orders.push({ kind: 'setStance', faction, army: army.id, stance: best });
  }
  return orders;
}
