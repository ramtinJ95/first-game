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
/** and told of again only after a war or a truce came between, or it stayed below this */
export const THREAT_CLEAR = 0.6;
/** for this many days in a row. */
export const THREAT_CALM_DAYS = 365;

const keyOf = (faction: string) => `threat:${faction}`;
const calmPrefix = (faction: string) => `threat-calm:${faction}:`;

/** The day a warned power fell below THREAT_CLEAR and has stayed there since, kept in the told keys. */
function calmSince(remembered: ReadonlySet<string>, faction: string): number | undefined {
  const prefix = calmPrefix(faction);
  for (const key of remembered) if (key.startsWith(prefix)) return Number(key.slice(prefix.length));
  return undefined;
}

function forgetCalm(remembered: Set<string>, faction: string) {
  const since = calmSince(remembered, faction);
  if (since !== undefined) remembered.delete(`${calmPrefix(faction)}${since}`);
}

/**
 * The great powers at peace with the player that have come within THREAT_WARN of the
 * odds they need to declare war on it, by the rule the AI declares by. A power is told
 * of once in a peace: again only after a war or a truce with the player, or after it
 * stayed below THREAT_CLEAR for THREAT_CALM_DAYS, because its armies march off and come
 * back within months and a warning each time teaches the player to ignore it. The news
 * names the city it weighs the player's armies at and, when the player's treasury
 * lowers the odds it needs, by how much. A day the power cannot reach the player counts
 * as calm.
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
      forgetCalm(remembered, power.id);
      continue;
    }
    const threat = warReadiness(after, world, power.id, player);
    const readiness = threat?.readiness ?? 0;
    if (remembered.has(key)) {
      const since = calmSince(remembered, power.id);
      if (since !== undefined && before.day - since >= THREAT_CALM_DAYS) {
        remembered.delete(key);
        forgetCalm(remembered, power.id);
      } else if (readiness >= THREAT_CLEAR) forgetCalm(remembered, power.id);
      else if (since === undefined) remembered.add(`${calmPrefix(power.id)}${before.day}`);
    }
    if (!threat || readiness < THREAT_WARN || remembered.has(key)) continue;
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
      text: `${factionName(after, power.id)} could soon declare war on you: its armies have ${Math.round(Math.min(1, threat.readiness) * 100)}% of the strength it needs against your forces near ${front?.name ?? 'your land'}.${hoard}${front && !threat.pressed ? ` Guards hired at ${front.name} count against it.` : ''}`,
      ...(front ? { focus: { at: front.position } } : {}),
    });
  }
  return news;
}
