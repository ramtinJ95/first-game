import { warReadiness } from '../sim/ai/war.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId } from '../sim/ids.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { truceBetween } from '../sim/peace/truce.ts';
import { areAtWar } from '../sim/wars.ts';
import type { World } from '../sim/world/world.ts';
import type { Alert } from './alerts.ts';
import { dateText, factionName, TROOP_NAMES, whole } from './names.ts';
import { trainingDaysAt } from '../sim/buildings/buildings.ts';
import { TROOPS, type Troop } from '../sim/troops.ts';
import { beleaguered } from '../sim/systems/sieges.ts';
import type { Stores } from '../sim/state/faction.ts';
import { GUARD_DETER_DAYS } from '../sim/guards.ts';
import { NOTICE_DAYS, NOTICE_SHARE } from '../sim/ai/thresholds.ts';

type State = DeepReadonly<GameState>;

/** A great power this near the odds it needs to declare war on the player is told of: the rules' notice. */
export const THREAT_WARN = NOTICE_SHARE;
/**
 * A power still on the notice it warned of is told of again once the day its last warning
 * named is this many days past, so no war comes longer than this after the day it was told of.
 */
export const THREAT_REMIND_DAYS = 60;

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
 * NOTICE_DAYS before they may declare (`noticeSince`). A power is told of each notice once it
 * has stood THREAT_STAND_DAYS, with the first day it may then declare, whatever it warned of
 * before, and again while on that notice once THREAT_REMIND_DAYS have passed since the day
 * its last warning named, so a war always follows a warning of its own notice NOTICE_DAYS less
 * THREAT_STAND_DAYS or more before it, and comes no more than THREAT_REMIND_DAYS after the day
 * it was last told of; a war or a truce with the player forgets its warning. The news names the city it weighs
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
  const warned: { name: string; threat: Threat; from: string }[] = [];
  for (const power of Object.values(after.factions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (power.id === player || power.kind !== 'greatPower' || power.defeatedOn !== null) continue;
    if (areAtWar(after, power.id, player) || truceBetween(after, power.id, player)) {
      forget(remembered, power.id);
      continue;
    }
    const last = warnedOn(remembered, power.id);
    if (power.noticeSince === null) continue;
    if (before.day - power.noticeSince + 1 < THREAT_STAND_DAYS) continue;
    if (
      last !== undefined &&
      last >= power.noticeSince &&
      before.day - Math.max(last, power.noticeSince + NOTICE_DAYS) < THREAT_REMIND_DAYS
    )
      continue;
    const threat = readinessOf(after, world, power.id);
    if (!threat) continue;
    forget(remembered, power.id);
    remembered.add(`${prefixOf(power.id)}${before.day}`);
    warned.push({
      name: factionName(after, power.id),
      threat,
      from: mayDeclare(before, power.noticeSince),
    });
  }
  const [first, ...others] = warned;
  if (!first) return [];
  const front = after.cities[first.threat.front];
  // Two warnings at once would not both fit the corner, so one line names every power and the Wars panel what lowers each.
  const text =
    others.length === 0
      ? `${first.name} could soon declare war on you: it has ${percent(first.threat)} of the strength it needs ${weighed(after, first.threat)}, and may declare ${first.from} if it holds it.${whatCounts(after, first.threat)} See At peace in Wars.`
      : `${listed(warned.map((w) => w.name))} could soon declare war on you, with ${listed(warned.map((w) => percent(w.threat)))} of the strength each needs. If they hold it, ${listed(warned.map((w) => `${w.name} may declare ${w.from}`))}. What lowers each is under At peace in Wars.`;
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

/** When a power on the notice that began on `since` may first declare war: a day to come, or any day once that has passed. */
const mayDeclare = (state: State, since: number) =>
  since + NOTICE_DAYS > state.day ? `from ${dateText(since + NOTICE_DAYS)}` : 'any day now';

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
  if (threat.pressed) return 'against all your armies in the field';
  return `against your forces near ${state.cities[threat.front]?.name ?? 'your land'}`;
}

/**
 * What lowers the threat, as the news and the wars panel both say. Weighing a city, the
 * power counts the armies near it, its garrison and its guards for their first
 * GUARD_DETER_DAYS, less what the player's treasury takes off. Pressing a rival that
 * has kept to the cities it began with, it counts only the rival's armies, so guards
 * do nothing there and more men under arms, wherever they stand, are what help.
 */
function whatCounts(state: State, threat: Threat, stores?: DeepReadonly<Stores>): string {
  if (threat.pressed)
    return ` ${raiseAdvice(state, stores ?? state.factions[state.player]?.stores)}. It weighs you so only while you hold no more cities than at the start.`;
  const front = state.cities[threat.front];
  const gold = state.factions[state.player]?.stores.gold ?? 0;
  const hoard =
    threat.hoard > 0
      ? ` Your treasury of ${whole(gold)} gold lowers the strength it needs by ${Math.round(threat.hoard * 100)}%, so more gold brings war nearer.`
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
export function standingThreats(
  state: State,
  world: World,
  stores?: DeepReadonly<Stores>,
): StandingThreat[] {
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
        text: `${name} has ${percent(threat)} of the strength it needs to declare war on you, ${weighed(state, threat)}.${whatCounts(state, threat, stores)}${power.noticeSince === null ? '' : ` It may declare ${mayDeclare(state, power.noticeSince)} if it holds it.`}`,
      };
    });
}

/** How many great powers at peace with the player stand at THREAT_WARN or nearer today, as the top bar counts them. */
export function powersNearWar(state: State, world: World): number {
  return standingThreats(state, world).filter((threat) => (threat.readiness ?? 0) >= THREAT_WARN)
    .length;
}

/**
 * What raising men takes today, as the field-army threat advises it: the cheapest troop the
 * player can afford with the stores given, which the wars panel reckons after the orders
 * waiting, and its quickest training among the cities that may recruit now; or, with none
 * affordable, the cheapest troop's price and days and what the player lacks for it.
 */
function raiseAdvice(state: State, stores: DeepReadonly<Stores> | undefined): string {
  const cities = Object.values(state.cities).filter(
    (city) => city.owner === state.player && city.unrestDays === 0 && !beleaguered(state, city),
  );
  if (cities.length === 0)
    return 'More men lower it, not guards, but no city of yours may recruit now';
  const troops = (Object.keys(TROOPS) as Troop[]).sort(
    (a, b) => TROOPS[a].recruit.gold - TROOPS[b].recruit.gold,
  );
  const days = (troop: Troop) =>
    Math.min(...cities.map((city) => trainingDaysAt(city, TROOPS[troop].recruit.days)));
  const gold = stores?.gold ?? 0;
  const manpower = stores?.manpower ?? 0;
  const affordable = troops.find(
    (troop) => TROOPS[troop].recruit.gold <= gold && TROOPS[troop].recruit.men <= manpower,
  );
  if (affordable)
    return `More men lower it, not guards: ${TROOP_NAMES[affordable]} cost ${whole(TROOPS[affordable].recruit.gold)} gold and train in ${whole(days(affordable))} days`;
  const [cheapest] = troops;
  if (!cheapest) return 'More men lower it, not guards';
  const { gold: price, men } = TROOPS[cheapest].recruit;
  const name = TROOP_NAMES[cheapest];
  return gold < price
    ? `More men lower it, not guards, but even ${name} cost ${whole(price)} gold, ${whole(days(cheapest))} days; you have ${whole(gold)}`
    : `More men lower it, not guards, but even ${name} need ${whole(men)} men, ${whole(days(cheapest))} days; you have ${whole(manpower)}`;
}
