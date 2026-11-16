import { warReadiness } from '../sim/ai/war.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId } from '../sim/ids.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { truceBetween } from '../sim/peace/truce.ts';
import { areAtWar } from '../sim/wars.ts';
import type { World } from '../sim/world/world.ts';
import type { Alert } from './alerts.ts';
import { dateText, factionName, whole } from './names.ts';
import { GUARD_DETER_DAYS } from '../sim/guards.ts';
import { NOTICE_DAYS, NOTICE_SHARE } from '../sim/ai/thresholds.ts';

type State = DeepReadonly<GameState>;

/** A great power this near the odds it needs to declare war on the player is told of: the rules' notice. */
export const THREAT_WARN = NOTICE_SHARE;
/**
 * A power on notice that warned this long ago is told of again. A war needs NOTICE_DAYS on
 * notice in a row, and reminders come this often while it lasts, so every war comes after
 * a warning given between a year and NOTICE_DAYS before it.
 */
export const THREAT_RECALL_DAYS = 365 - NOTICE_DAYS;

/**
 * A power is told of once it has stood on notice this many days, so a strength that comes
 * and goes within days, as most do, stops no game; its war still comes NOTICE_DAYS less
 * this, or more, after the warning.
 */
export const THREAT_STAND_DAYS = 7;

const prefixOf = (faction: string) => `threat:${faction}:`;

/** The day the power last warned in this peace, kept in the told keys. */
function warnedOn(remembered: ReadonlySet<string>, faction: string): number | undefined {
  const prefix = prefixOf(faction);
  for (const key of remembered) if (key.startsWith(prefix)) return Number(key.slice(prefix.length));
  return undefined;
}

function forget(remembered: Set<string>, faction: string) {
  const day = warnedOn(remembered, faction);
  if (day !== undefined) remembered.delete(`${prefixOf(faction)}${day}`);
}

/**
 * The great powers at peace with the player that stand on the rules' notice: at
 * NOTICE_SHARE of the strength they need to declare war on it, which they must hold for
 * NOTICE_DAYS before they may declare (`noticeSince`). A power is told of once it has stood on
 * notice for THREAT_STAND_DAYS, with the first day it may then declare, and again while on
 * notice once THREAT_RECALL_DAYS have passed since it last warned, so a war always follows
 * a warning given between a year and NOTICE_DAYS less THREAT_STAND_DAYS before it;
 * a war or a truce with the player forgets its warning. The news names the city it weighs
 * the player's armies at and, when the player's treasury lowers the odds it needs, by how
 * much.
 */
export function threatNewsOfDay(
  before: State,
  after: State,
  world: World,
  remembered: Set<string>,
): Alert[] {
  const player = after.player;
  const warned: { name: string; threat: Threat; since: number }[] = [];
  for (const power of Object.values(after.factions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (power.id === player || power.kind !== 'greatPower' || power.defeatedOn !== null) continue;
    if (areAtWar(after, power.id, player) || truceBetween(after, power.id, player)) {
      forget(remembered, power.id);
      continue;
    }
    const last = warnedOn(remembered, power.id);
    if (power.noticeSince === null) continue;
    if (before.day - power.noticeSince + 1 < THREAT_STAND_DAYS) continue;
    if (last !== undefined && before.day - last < THREAT_RECALL_DAYS) continue;
    const threat = readinessOf(after, world, power.id);
    if (!threat) continue;
    forget(remembered, power.id);
    remembered.add(`${prefixOf(power.id)}${before.day}`);
    warned.push({ name: factionName(after, power.id), threat, since: power.noticeSince });
  }
  const [first, ...others] = warned;
  if (!first) return [];
  const front = after.cities[first.threat.front];
  // Two warnings at once would not both fit the corner, so one line names every power and the Wars panel what lowers each.
  const text =
    others.length === 0
      ? `${first.name} could soon declare war on you: it has ${percent(first.threat)} of the strength it needs ${weighed(after, first.threat)}, and may declare from ${dateText(first.since + NOTICE_DAYS)} if it holds it.${whatCounts(after, first.threat)} See At peace in Wars.`
      : `${listed(warned.map((w) => w.name))} could soon declare war on you, with ${listed(warned.map((w) => percent(w.threat)))} of the strength each needs. If they hold it, ${listed(warned.map((w) => `${w.name} may declare from ${dateText(w.since + NOTICE_DAYS)}`))}. What lowers each is under At peace in Wars.`;
  return [
    {
      kind: 'warThreat',
      day: before.day,
      tone: 'bad',
      pause: { kind: 'warThreat' },
      text,
      ...(front ? { focus: { at: front.position } } : {}),
    },
  ];
}

const listed = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

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

/** What the power weighs: the forces near one of the player's cities, or every army the player has in the field. */
function weighed(state: State, threat: Threat): string {
  if (threat.pressed) return 'against all your armies in the field, wherever they stand';
  return `against your forces near ${state.cities[threat.front]?.name ?? 'your land'}`;
}

/**
 * What lowers the threat, as the news and the wars panel both say. Weighing a city, the
 * power counts the armies near it, its garrison and its guards for their first
 * GUARD_DETER_DAYS, less what the player's treasury takes off. Pressing a rival that
 * has kept to the cities it began with, it counts only the rival's armies, so guards
 * do nothing there and more men under arms, wherever they stand, are what help.
 */
function whatCounts(state: State, threat: Threat): string {
  if (threat.pressed)
    return ' More men under arms lower it, wherever they stand; guards do not, since it weighs no garrison. It weighs you so only while you hold no more cities than you began with.';
  const front = state.cities[threat.front];
  const gold = state.factions[state.player]?.stores.gold ?? 0;
  const hoard =
    threat.hoard > 0
      ? ` Your treasury of ${whole(gold)} gold lowers that by ${Math.round(threat.hoard * 100)}%, as a peace would make you pay it.`
      : '';
  return `${hoard}${front ? ` Your armies near ${front.name} and guards hired there count against it, guards for their first ${GUARD_DETER_DAYS} days.` : ''}`;
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
      return {
        power: power.id,
        name,
        readiness: Math.min(1, threat.readiness),
        text: `${name} has ${percent(threat)} of the strength it needs to declare war on you, ${weighed(state, threat)}.${whatCounts(state, threat)}${power.noticeSince === null ? '' : ` It may declare from ${dateText(power.noticeSince + NOTICE_DAYS)} if it holds it.`}`,
      };
    });
}

/** How many great powers at peace with the player stand at THREAT_WARN or nearer today, as the top bar counts them. */
export function powersNearWar(state: State, world: World): number {
  return standingThreats(state, world).filter((threat) => (threat.readiness ?? 0) >= THREAT_WARN)
    .length;
}
