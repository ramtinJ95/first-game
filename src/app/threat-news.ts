import { warReadiness } from '../sim/ai/war.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId } from '../sim/ids.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { truceBetween } from '../sim/peace/truce.ts';
import { areAtWar } from '../sim/wars.ts';
import type { World } from '../sim/world/world.ts';
import type { Alert } from './alerts.ts';
import { factionName, whole } from './names.ts';
import { GUARD_DETER_DAYS } from '../sim/guards.ts';

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
    const threat = readinessOf(after, world, power.id);
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
    news.push({
      kind: 'warThreat',
      day: before.day,
      tone: 'bad',
      text: `${factionName(after, power.id)} could soon declare war on you: its armies have ${percent(threat)} of the strength it needs against your forces near ${front?.name ?? 'your land'}.${whatCounts(after, threat)} ${WATCH}`,
      ...(front ? { focus: { at: front.position } } : {}),
    });
  }
  return news;
}

/** Where the warning sends the player to watch the threat between warnings. */
const WATCH = 'Watch it under At peace in the Wars panel.';

type Threat = NonNullable<ReturnType<typeof warReadiness>>;

const reckoned = new WeakMap<State, Map<FactionId, Threat | undefined>>();

/**
 * The power's war readiness against the player in this state, reckoned once: the day's news
 * reckons it inside the clock's frame, and the top bar and the wars panel read the same
 * state afterwards, so they add no reckoning of their own. A state is never changed after.
 */
function readinessOf(state: State, world: World, power: FactionId): Threat | undefined {
  let day = reckoned.get(state);
  if (!day) {
    day = new Map();
    reckoned.set(state, day);
  }
  if (!day.has(power)) day.set(power, warReadiness(state, world, power, state.player));
  return day.get(power);
}

const percent = (threat: Threat) => `${Math.round(Math.min(1, threat.readiness) * 100)}%`;

/** What the player's treasury takes off what the power needs, and that guards count against it, as the news and the wars panel both say. */
function whatCounts(state: State, threat: Threat): string {
  if (threat.pressed) return '';
  const front = state.cities[threat.front];
  const gold = state.factions[state.player]?.stores.gold ?? 0;
  const hoard =
    threat.hoard > 0
      ? ` Your treasury of ${whole(gold)} gold lowers what it needs by ${Math.round(threat.hoard * 100)}%, since a peace would make you pay it.`
      : '';
  return `${hoard}${front ? ` Guards hired at ${front.name} count against it for their first ${GUARD_DETER_DAYS} days.` : ''}`;
}

/** How near one great power at peace with the player stands to declaring war on it today, as the wars panel lists it. */
export interface StandingThreat {
  readonly power: FactionId;
  readonly name: string;
  /** Its share of the strength it needs, 0 to 1, or undefined when it weighs no war on the player. */
  readonly readiness: number | undefined;
  readonly text: string;
}

/**
 * Each great power at peace with the player and bound by no truce, by id, with how near
 * it stands to the strength it needs to declare war on the player by the rule the AI
 * declares by, in the news's words. A truce row says when a power bound by one may.
 */
export function standingThreats(state: State, world: World): StandingThreat[] {
  const player = state.player;
  return Object.values(state.factions)
    .filter(
      (power) =>
        power.id !== player &&
        power.kind === 'greatPower' &&
        power.defeatedOn === null &&
        !areAtWar(state, power.id, player) &&
        !truceBetween(state, power.id, player),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((power) => {
      const name = factionName(state, power.id);
      const threat = readinessOf(state, world, power.id);
      if (!threat)
        return {
          power: power.id,
          name,
          readiness: undefined,
          text: `${name} is not weighing a war on you now: none of its cities is near enough to yours, or none of its armies stands ready to march.`,
        };
      const front = state.cities[threat.front];
      return {
        power: power.id,
        name,
        readiness: Math.min(1, threat.readiness),
        text: `${name} has ${percent(threat)} of the strength it needs to declare war on you, ${threat.pressed ? 'weighing all your armies in the field' : `against your forces near ${front?.name ?? 'your land'}`}.${whatCounts(state, threat)}`,
      };
    });
}

/** How many great powers at peace with the player stand at THREAT_WARN or nearer today, as the top bar counts them. */
export function powersNearWar(state: State, world: World): number {
  return standingThreats(state, world).filter((threat) => (threat.readiness ?? 0) >= THREAT_WARN)
    .length;
}
