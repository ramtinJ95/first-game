import { warReadiness } from '../sim/ai/war.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { truceBetween } from '../sim/peace/truce.ts';
import { areAtWar } from '../sim/wars.ts';
import type { World } from '../sim/world/world.ts';
import type { Alert } from './alerts.ts';
import { factionName, whole } from './names.ts';

type State = DeepReadonly<GameState>;

/** A great power this near the odds it needs to declare war on the player is told of. */
export const THREAT_WARN = 0.8;
/** and told of again only once it has fallen back below this, or a war or a truce came between. */
export const THREAT_CLEAR = 0.6;

const keyOf = (faction: string) => `threat:${faction}`;

/**
 * The great powers at peace with the player that have come within THREAT_WARN of the
 * odds they need to declare war on it, by the rule the AI declares by, told once until
 * the power falls back below THREAT_CLEAR or a war or a truce comes between. The news
 * names the city it weighs the player's armies at and, when the player's treasury
 * lowers the odds it needs, by how much. A power that cannot reach the player says
 * nothing and keeps what was told, so a power whose armies are all on the march
 * elsewhere for a day is not told of again.
 */
export function threatNewsOfDay(
  before: State,
  after: State,
  world: World,
  remembered: Set<string>,
): Alert[] {
  const player = after.player;
  const news: Alert[] = [];
  for (const power of Object.values(after.factions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (power.id === player || power.kind !== 'greatPower' || power.defeatedOn !== null) continue;
    const key = keyOf(power.id);
    if (areAtWar(after, power.id, player) || truceBetween(after, power.id, player)) {
      remembered.delete(key);
      continue;
    }
    const threat = warReadiness(after, world, power.id, player);
    if (!threat) continue;
    if (threat.readiness < THREAT_CLEAR) remembered.delete(key);
    if (threat.readiness < THREAT_WARN || remembered.has(key)) continue;
    remembered.add(key);
    const front = after.cities[threat.front];
    const gold = after.factions[player]?.stores.gold ?? 0;
    const hoard =
      threat.hoard > 0 && !threat.pressed
        ? ` Your treasury of ${whole(gold)} gold lowers what it needs by ${Math.round(threat.hoard * 100)}%, since a peace would make you pay it.`
        : '';
    news.push({
      kind: 'warThreat',
      day: before.day,
      tone: 'bad',
      text: `${factionName(after, power.id)} could soon declare war on you: its armies have ${Math.round(Math.min(1, threat.readiness) * 100)}% of the strength it needs against your forces near ${front?.name ?? 'your land'}.${hoard}`,
      ...(front ? { focus: { at: front.position } } : {}),
    });
  }
  return news;
}
