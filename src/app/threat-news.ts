import { warReadiness } from '../sim/ai/war.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId } from '../sim/ids.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { truceBetween } from '../sim/peace/truce.ts';
import { areAtWar } from '../sim/wars.ts';
import { canFight } from '../sim/ai/situation.ts';
import type { World } from '../sim/world/world.ts';
import type { Alert } from './alerts.ts';
import { dateText, factionName, TROOP_NAMES, whole } from './names.ts';
import { trainingDaysAt } from '../sim/buildings/buildings.ts';
import { TROOPS, type Troop } from '../sim/troops.ts';
import { beleaguered } from '../sim/systems/sieges.ts';
import type { Stores } from '../sim/state/faction.ts';
import { GUARD_DETER_DAYS } from '../sim/guards.ts';
import { NOTICE_DAYS, NOTICE_SHARE, WAR_FRONT_KM } from '../sim/ai/thresholds.ts';

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
  const warned: {
    name: string;
    threat: Threat;
    from: string;
    by: number | undefined;
    /** For a reminder, the day the player was last warned of this notice. */
    told: number | undefined;
  }[] = [];
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
      by: dayToCome(before, power.noticeSince),
      told: last !== undefined && last >= power.noticeSince ? last : undefined,
    });
  }
  const [first, ...others] = warned;
  if (!first) return [];
  const front = after.cities[first.threat.front];
  // Two warnings at once would not both fit the corner, so one line names every power and the Wars panel what lowers each.
  const text =
    others.length === 0
      ? `${first.told === undefined ? `${first.name} could soon declare war on you:` : `${first.name} still stands near war with you, as warned on ${dateText(first.told)}:`} it has ${percent(first.threat)} of the strength it needs ${weighed(after, first.threat)}, and may declare ${first.from} if it holds it.${whatCounts(after, first.threat, undefined, first.by, 'corner')} See At peace in Wars.`
      : `${listed(warned.map((w) => w.name))} could soon declare war on you, with ${listed(warned.map((w) => percent(w.threat)))} of the strength each needs. If they hold it, ${listed(warned.map((w) => `${w.name}${w.told === undefined ? '' : `, as warned on ${dateText(w.told)},`} may declare ${w.from}`))}. What lowers each is under At peace in Wars.`;
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

/** The first day a power on the notice that began on `since` may declare war, while it is still to come. */
const dayToCome = (state: State, since: number | null) =>
  since !== null && since + NOTICE_DAYS > state.day ? since + NOTICE_DAYS : undefined;

/**
 * When a power that stands at NOTICE_SHARE may declare war on the player: from the day its
 * notice runs out, any day once that has passed, or, not yet on notice, once it has stood
 * there NOTICE_DAYS.
 */
export function mayDeclareWhen(state: State, power: FactionId): string {
  const since = state.factions[power]?.noticeSince ?? null;
  return since === null
    ? `once it has stood at ${Math.round(NOTICE_SHARE * 100)}% for ${NOTICE_DAYS} days`
    : mayDeclare(state, since);
}

/** When a power on the notice that began on `since` may first declare war: a day to come, or any day once that has passed. */
const mayDeclare = (state: State, since: number) => {
  const day = dayToCome(state, since);
  return day === undefined ? 'any day now' : `from ${dateText(day)}`;
};

/**
 * The great powers at peace with the player whose warned notice has ended THREAT_STAND_DAYS
 * ago, and that have stood off notice every day since: one line each, which does not stop the
 * game, so a player who answered a warning learns that it passed. The line waits as the warning
 * does, so a strength that dips for days says nothing, and a new notice that soon follows is told
 * by its own warning alone. The day the notice ended is kept in the told keys as
 * `threat-off:<power>:<day>`. A notice that ends in a war or a truce is told of by them, and the
 * line waits while the power stands at NOTICE_SHARE again by the day's end.
 */
export function threatFadedNewsOfDay(
  before: State,
  after: State,
  world: World,
  remembered: Set<string>,
): Alert[] {
  const player = after.player;
  const alerts: Alert[] = [];
  for (const power of Object.values(after.factions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (power.id === player || power.kind !== 'greatPower') continue;
    const ended = endedOn(remembered, power.id);
    const off = `${OFF}${power.id}:${ended}`;
    if (
      power.defeatedOn !== null ||
      power.noticeSince !== null ||
      areAtWar(after, power.id, player) ||
      truceBetween(after, power.id, player)
    ) {
      remembered.delete(off);
      continue;
    }
    const was = before.factions[power.id]?.noticeSince ?? null;
    const last = warnedOn(remembered, power.id);
    if (ended === undefined) {
      if (was === null || last === undefined || last < was) continue;
      remembered.add(`${OFF}${power.id}:${before.day}`);
    }
    if (before.day - (ended ?? before.day) + 1 < THREAT_STAND_DAYS) continue;
    const threat = readinessOf(after, world, power.id);
    // The notice is reckoned before the day ends, so guards that stop counting at its end can lift the power back.
    if (threat && threat.readiness >= NOTICE_SHARE) continue;
    remembered.delete(`${OFF}${power.id}:${ended ?? before.day}`);
    const name = factionName(after, power.id);
    alerts.push({
      kind: 'warThreatFaded',
      day: before.day,
      tone: 'good',
      text: `${name}'s threat has passed for now: ${whyFaded(after, power.id, threat)}, and must stand at ${Math.round(NOTICE_SHARE * 100)}% for ${NOTICE_DAYS} days before it may.`,
    });
  }
  return alerts;
}

const OFF = 'threat-off:';

/** The day a warned notice of the power ended, kept in the told keys until its line is told. */
function endedOn(remembered: ReadonlySet<string>, faction: string): number | undefined {
  const prefix = `${OFF}${faction}:`;
  for (const key of remembered) if (key.startsWith(prefix)) return Number(key.slice(prefix.length));
  return undefined;
}

/**
 * Why a power no longer stands near war with the player, as a stranger can check it. A power
 * holds back the whole field strength of each enemy it fights within reach, so one whose wars
 * outweigh all its armies stands at 0, and one with no army idle or marching that can fight, or
 * with no city of the player's in reach, weighs no war at all.
 */
function whyFaded(state: State, power: FactionId, threat: Threat | undefined): string {
  if (threat && threat.readiness > 0)
    return `it has fallen to ${percent(threat) === '0%' ? 'under 1%' : percent(threat)} of the strength it needs to declare war on you`;
  if (threat)
    return threat.heldBy.length > 0
      ? `it is at war with ${listed(threat.heldBy.map((enemy) => factionName(state, enemy)))}, which ties down all its armies`
      : 'it has no strength to spare against you';
  const ready = Object.values(state.armies).some(
    (army) =>
      army.owner === power &&
      (army.activity.kind === 'idle' || army.activity.kind === 'marching') &&
      canFight(state, army),
  );
  return ready
    ? 'none of its cities is near enough to yours to weigh a war on you'
    : 'none of its armies stands ready to march';
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
  if (threat.pressed) return 'against all your armies in the field';
  return `against your forces near ${state.cities[threat.front]?.name ?? 'your land'}`;
}

/**
 * What lowers the threat, as the news and the wars panel both say. Weighing a city, the
 * power counts every army of the player's on land within WAR_FRONT_KM of it, so an army
 * marched nearer lowers nothing, the city's garrison, and its guards for their first
 * GUARD_DETER_DAYS, less what the player's treasury takes off. Pressing a rival that
 * has kept to the cities it began with, it counts only the rival's armies, so guards
 * do nothing there and more men under arms, wherever they stand, are what help.
 */
function whatCounts(
  state: State,
  threat: Threat,
  stores: DeepReadonly<Stores> | undefined,
  by: number | undefined,
  where: Where = 'panel',
): string {
  if (threat.pressed)
    return ` ${raiseAdvice(state, stores ?? state.factions[state.player]?.stores, by, where)}. It weighs you so only while you hold no more cities than at the start.`;
  const front = state.cities[threat.front];
  const gold = state.factions[state.player]?.stores.gold ?? 0;
  const hoard =
    threat.hoard > 0
      ? ` Your treasury of ${whole(gold)} gold lowers the strength it needs by ${Math.round(threat.hoard * 100)}%, so more gold brings war nearer.`
      : '';
  return `${hoard}${front ? ` Your armies on land within ${whole(WAR_FRONT_KM)} km count; more men, or guards at ${front.name} for ${GUARD_DETER_DAYS} days, lower it.` : ''}`;
}

/** Where the advice is read: the corner, with room for the warning's 12 lines, or the wars panel. */
type Where = 'corner' | 'panel';

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
        text: `${name} has ${percent(threat)} of the strength it needs to declare war on you, ${weighed(state, threat)}.${whatCounts(state, threat, stores, dayToCome(state, power.noticeSince))}${power.noticeSince === null ? '' : ` It may declare ${mayDeclare(state, power.noticeSince)} if it holds it.`}`,
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
 * waiting, among those that finish training before the day `by` the power may first declare,
 * since it decides before that day's recruits muster, with its quickest training among the
 * cities that may recruit now. With none affordable in time, the cheapest it can afford and the
 * day it would muster, since men who muster on or after that day still lower a notice the power
 * holds. With none affordable, the cheapest troop's price and days and what the player lacks
 * for it. Once that day has passed, `by` is undefined and every troop is in time. The corner
 * names the muster day only, as its warning names the day war may come.
 */
function raiseAdvice(
  state: State,
  stores: DeepReadonly<Stores> | undefined,
  by: number | undefined,
  where: Where,
): string {
  const cities = Object.values(state.cities).filter(
    (city) => city.owner === state.player && city.unrestDays === 0 && !beleaguered(state, city),
  );
  if (cities.length === 0)
    return 'More men lower it, not guards, but no city of yours may recruit now';
  const days = (troop: Troop) =>
    Math.min(...cities.map((city) => trainingDaysAt(city, TROOPS[troop].recruit.days)));
  const gold = stores?.gold ?? 0;
  const manpower = stores?.manpower ?? 0;
  const troops = (Object.keys(TROOPS) as Troop[]).sort(
    (a, b) => TROOPS[a].recruit.gold - TROOPS[b].recruit.gold,
  );
  const affordable = troops.filter(
    (troop) => TROOPS[troop].recruit.gold <= gold && TROOPS[troop].recruit.men <= manpower,
  );
  const inTime = affordable.find((troop) => by === undefined || state.day + days(troop) < by);
  if (inTime)
    return `More men lower it, not guards: ${TROOP_NAMES[inTime]} cost ${whole(TROOPS[inTime].recruit.gold)} gold and train in ${whole(days(inTime))} days`;
  const [late] = affordable;
  if (late && by !== undefined) {
    const musters = state.day + days(late);
    // The corner names the day war may come just before, and has no room to say it twice.
    if (where === 'corner')
      return `More men lower it, not guards: ${TROOP_NAMES[late]} ordered now muster on ${dateText(musters)}`;
    const when =
      musters === by
        ? 'the first day war may come'
        : `${whole(musters - by)} ${musters - by === 1 ? 'day' : 'days'} after war may first come`;
    return `More men lower it, not guards: order ${TROOP_NAMES[late]} now for ${whole(TROOPS[late].recruit.gold)} gold; they muster and lower it from ${dateText(musters)}, ${when}`;
  }
  const [cheapest] = troops;
  if (!cheapest) return 'More men lower it, not guards';
  const { gold: price, men } = TROOPS[cheapest].recruit;
  const name = TROOP_NAMES[cheapest];
  return gold < price
    ? `More men lower it, not guards, but even ${name} cost ${whole(price)} gold, ${whole(days(cheapest))} days; you have ${whole(gold)} gold`
    : `More men lower it, not guards, but even ${name} need ${whole(men)} men, ${whole(days(cheapest))} days; you have ${whole(manpower)} manpower`;
}
