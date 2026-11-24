import { warReadiness } from '../sim/ai/war.ts';
import { BUILDINGS } from '../sim/buildings/buildings.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import { worthBuilding } from './building-hint.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { truceBetween } from '../sim/peace/truce.ts';
import { areAtWar } from '../sim/wars.ts';
import { canFight, positionOf, standsWithin, strengthOf } from '../sim/ai/situation.ts';
import { distance } from '../sim/world/find-path.ts';
import { menOf } from '../sim/systems/economy.ts';
import type { Army } from '../sim/state/army.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import type { World } from '../sim/world/world.ts';
import type { Alert } from './alerts.ts';
import { dateText, factionName, TROOP_NAMES, whole } from './names.ts';
import { trainingDaysAt } from '../sim/buildings/buildings.ts';
import { TROOPS, type Troop } from '../sim/troops.ts';
import { beleaguered } from '../sim/systems/sieges.ts';
import type { Stores } from '../sim/state/faction.ts';
import { deterrentUntil, GUARD_BAND, GUARD_DETER_DAYS, GUARD_GOLD } from '../sim/guards.ts';
import type { Day } from '../sim/state/day.ts';
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

/**
 * A warning that stopped the game covers its power this many days: the power's first warning of
 * a later notice runs the game on while any war it could bring would still come within them,
 * unless it weighs another front or stands THREAT_SPARE_RISE points higher. Agreed after the
 * thirteenth play-through, where Carthage stopped the game at Ariminum four times in 100 days at
 * 80 to 85%.
 */
export const THREAT_SPARE_DAYS = 200;

/** A repeat whose shown share stands this many points above the stop's stops the game again. */
export const THREAT_SPARE_RISE = 6;

const prefixOf = (faction: string) => `threat:${faction}:`;
const STOP = 'threat-stop:';

/** The last warning of the power that stopped the game in this peace: its day, shown share and front. */
interface Stop {
  readonly day: number;
  readonly share: number;
  readonly front: string;
}

function stopOf(remembered: ReadonlySet<string>, faction: string): Stop | undefined {
  const prefix = `${STOP}${faction}:`;
  for (const key of remembered) {
    if (!key.startsWith(prefix)) continue;
    const [day = '', share = '', front = ''] = key.slice(prefix.length).split(':');
    return { day: Number(day), share: Number(share), front };
  }
  return undefined;
}

function forgetStop(remembered: Set<string>, faction: string) {
  const prefix = `${STOP}${faction}:`;
  for (const key of remembered) if (key.startsWith(prefix)) remembered.delete(key);
}

/** The share a warning shows, in whole points of at most 100. */
const points = (readiness: number) => Math.round(Math.min(1, readiness) * 100);

const frontOf = (threat: Threat) => (threat.pressed ? 'field' : threat.front);

/**
 * The stop a power's first warning of a notice is spared by, if any: the power's last stop in
 * this peace, at the same front, less than THREAT_SPARE_RISE points under the warning's share,
 * and late enough that the notice's reminder, due on `due`, still falls within THREAT_SPARE_DAYS
 * of it. A reminder always stops the game and no war of the notice comes after it unwarned, so
 * every war on the player comes within THREAT_SPARE_DAYS of a stop for its power.
 */
function sparedBy(
  remembered: ReadonlySet<string>,
  power: FactionId,
  threat: Threat,
  due: number,
): Stop | undefined {
  const stop = stopOf(remembered, power);
  if (!stop) return undefined;
  if (stop.front !== frontOf(threat)) return undefined;
  if (points(threat.readiness) - stop.share >= THREAT_SPARE_RISE) return undefined;
  return due - stop.day <= THREAT_SPARE_DAYS ? stop : undefined;
}

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
  training: (state: State, world: World) => ReadonlyMap<FactionId, TrainingMuster> = () =>
    new Map(),
  stopping = true,
  climbs = true,
): Alert[] {
  const player = after.player;
  const warned: {
    power: FactionId;
    name: string;
    threat: Threat;
    from: string;
    by: number | undefined;
    /** For a reminder, the day the player was last warned of this notice. */
    told: number | undefined;
    spared: Stop | undefined;
    /** For a climb, the stop it stands THREAT_SPARE_RISE points or more above. */
    climb: Stop | undefined;
  }[] = [];
  const bands: { power: FactionId; city: CityId; men: number; threat: Threat; from: string }[] = [];
  for (const power of Object.values(after.factions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (power.id === player || power.kind !== 'greatPower' || power.defeatedOn !== null) continue;
    if (areAtWar(after, power.id, player) || truceBetween(after, power.id, player)) {
      forget(remembered, power.id);
      forgetStop(remembered, power.id);
      continue;
    }
    const last = warnedOn(remembered, power.id);
    if (power.noticeSince === null) continue;
    const lapsed = bandsStoppedCounting(before, after, world, power.id);
    if (lapsed)
      bands.push({ power: power.id, ...lapsed, from: mayDeclare(before, power.noticeSince) });
    if (before.day - power.noticeSince + 1 < THREAT_STAND_DAYS) continue;
    const told = last !== undefined && last >= power.noticeSince;
    const stop = stopOf(remembered, power.id);
    const climbing = (threat: Threat | undefined) =>
      climbs && told && stopping && stop !== undefined && threat !== undefined
        ? points(threat.readiness) - stop.share >= THREAT_SPARE_RISE
        : false;
    const due =
      told && before.day - Math.max(last, power.noticeSince + NOTICE_DAYS) >= THREAT_REMIND_DAYS;
    if (told && !due && !climbing(readinessOf(after, world, power.id))) continue;
    const threat = readinessOf(after, world, power.id);
    if (!threat) continue;
    const reminder = told;
    const climb = !due && climbing(threat) ? stop : undefined;
    forget(remembered, power.id);
    remembered.add(`${prefixOf(power.id)}${before.day}`);
    warned.push({
      power: power.id,
      name: factionName(after, power.id),
      threat,
      from: mayDeclare(before, power.noticeSince),
      by: dayToCome(before, power.noticeSince),
      told: reminder ? last : undefined,
      climb,
      // A reminder says war may now come any day, so it stops the game as its warning did.
      spared: reminder
        ? undefined
        : sparedBy(
            remembered,
            power.id,
            threat,
            Math.max(before.day, power.noticeSince + NOTICE_DAYS) + THREAT_REMIND_DAYS,
          ),
    });
  }
  const [first, ...others] = warned;
  const bandLines = (skip: FactionId | undefined) =>
    bands.filter((b) => b.power !== skip).map((b) => bandAlert(after, b));
  if (!first) return bandLines(undefined);
  // One line tells the day's powers, so it stops for all of them or for none.
  const stops = warned.some((w) => w.spared === undefined);
  // A stop the Game menu turned off is no stop the player answered, so it spares nothing later.
  if (stops && stopping)
    for (const w of warned) {
      forgetStop(remembered, w.power);
      remembered.add(
        `${STOP}${w.power}:${before.day}:${points(w.threat.readiness)}:${frontOf(w.threat)}`,
      );
    }
  const front = after.cities[first.threat.front];
  // A band that stopped counting on the day of a stop is told in it, so the player reads one stop whole.
  const foldedBand =
    stops && others.length === 0 ? bands.find((b) => b.power === first.power) : undefined;
  const folded = foldedBand
    ? `The ${whole(foldedBand.men)} guards at ${after.cities[foldedBand.city]?.name ?? foldedBand.city} no longer count against ${first.name}'s war. `
    : '';
  // Two warnings at once would not both fit the corner, so one line names every power and the Wars panel what lowers each.
  const text = stops
    ? others.length === 0
      ? `${folded}${first.climb ? `${first.name} stands higher than when the game last stopped for it, on ${dateText(first.climb.day)} at ${first.climb.share}%:` : first.told === undefined ? `${first.name} could soon declare war on you:` : `${first.name} still stands near war with you, as warned on ${dateText(first.told)}:`} it has ${share(first.threat.readiness)} of the strength it needs ${weighed(after, first.threat)}, and may declare ${first.from} if it holds it.${whatCounts(after, first.power, first.threat, after, first.by, 'corner', first.threat.pressed ? training(after, world).get(first.power) : undefined, treasuryAdvice(after, world, first.power, first.threat), guardsHold(after, world, first.power, first.threat))} See At peace in Wars.`
      : `${listed(warned.map((w) => w.name))} could soon declare war on you, with ${listed(warned.map((w) => share(w.threat.readiness)))} of the strength each needs. If they hold it, ${listed(warned.map((w) => `${w.name}${w.told === undefined ? '' : `, as warned on ${dateText(w.told)},`} may declare ${w.from}`))}. What lowers each is under At peace in Wars.`
    : ranOnText(
        after,
        warned.flatMap((w) => (w.spared ? [{ ...w, stop: w.spared }] : [])),
      );
  return [
    {
      kind: 'warThreat',
      day: before.day,
      tone: 'bad',
      ...(stops ? { pause: { kind: 'warThreat' } as const } : {}),
      text,
      ...(front ? { focus: { at: front.position } } : {}),
    },
    ...bandLines(foldedBand?.power),
  ];
}

/**
 * The bands of guards at the city a power on notice weighs that it counted yesterday and no
 * longer counts today, GUARD_DETER_DAYS after their hire, with the power's share now.
 */
function bandsStoppedCounting(
  before: State,
  after: State,
  world: World,
  power: FactionId,
): { city: CityId; men: number; threat: Threat } | undefined {
  const threat = readinessOf(after, world, power);
  // A power that presses the player's field armies weighs no guards, so none stopped counting for it.
  const city = threat && !threat.pressed ? after.cities[threat.front] : undefined;
  if (!threat || !city || city.owner !== after.player) return undefined;
  const ended = city.guards.filter((band) => {
    const until = deterrentUntil(band);
    return until > before.day && until <= after.day;
  }).length;
  return ended > 0 ? { city: city.id, men: ended * GUARD_BAND, threat } : undefined;
}

/** The line of a day on which guards a power on notice counted stopped counting. It does not stop the game. */
function bandAlert(
  state: State,
  band: { power: FactionId; city: CityId; men: number; threat: Threat; from: string },
): Alert {
  const city = state.cities[band.city];
  return {
    kind: 'guardsUncounted',
    day: (state.day - 1) as Day,
    tone: 'bad',
    text: `The ${whole(band.men)} guards at ${city?.name ?? band.city} no longer count against ${factionName(state, band.power)}'s war: it stands at ${share(band.threat.readiness)} of the strength it needs, and may declare ${band.from}. A new band counts ${GUARD_DETER_DAYS} days, for ${whole(GUARD_GOLD)} gold.`,
    ...(city ? { focus: { at: city.position } } : {}),
  };
}

/**
 * When guards the power counts at the city it weighs hold its share down, the days they stop
 * counting and the share it would stand at without them, reckoned on a copy of the day with
 * those bands gone; nothing when it counts none.
 */
function guardsHold(state: State, world: World, power: FactionId, threat: Threat): string {
  if (threat.pressed) return '';
  const city = state.cities[threat.front];
  if (!city || city.owner !== state.player) return '';
  const counted = city.guards.filter((band) => deterrentUntil(band) > state.day);
  if (counted.length === 0) return '';
  const without = structuredClone(state) as GameState;
  const walls = without.cities[city.id];
  if (!walls) return '';
  walls.guards = walls.guards.filter((band) => deterrentUntil(band) <= state.day);
  walls.garrison = Math.max(0, walls.garrison - counted.length * GUARD_BAND);
  const bare = warReadiness(without, world, power, state.player)?.readiness;
  const days = counted.map((band) => deterrentUntil(band)).sort((a, b) => a - b);
  const first = days[0] ?? state.day;
  const last = days.at(-1) ?? first;
  // Up to six bands each with its own day would not fit the corner, so the first and last stand for them.
  const when =
    first === last
      ? `stop counting on ${dateText(first)}`
      : `stop counting from ${dateText(first)} to ${dateText(last)}`;
  return ` Guards at ${city.name} ${when}${bare === undefined ? '' : `; without them it would stand at ${share(bare)}`}.`;
}

/**
 * A warning that runs the game on, told short, since only news that stops the game gets the
 * corner's larger room: each power's share, the front it weighs, when it may declare, and the
 * stop it repeats, standing no higher or only a few points higher. What lowers each threat is
 * left to the At peace list.
 */
function ranOnText(
  state: State,
  spared: readonly {
    name: string;
    threat: Threat;
    from: string;
    stop: Stop;
  }[],
): string {
  const [one, ...others] = spared;
  if (!one) return '';
  const near = (threat: Threat) =>
    threat.pressed
      ? 'against your field armies'
      : `near ${state.cities[threat.front]?.name ?? 'your land'}`;
  // Each power's day of war and stop would not fit the corner, so the At peace rows give them.
  if (others.length > 0)
    return `${listed(spared.map((w) => w.name))} could soon declare war on you, with ${listed(spared.map((w) => share(w.threat.readiness)))} of the strength each needs. The game ran on: none stands ${THREAT_SPARE_RISE} points above its last stop. See At peace in Wars.`;
  const rise = points(one.threat.readiness) - one.stop.share;
  const higher = rise > 0 ? `only ${rise} ${rise === 1 ? 'point' : 'points'} higher` : 'no higher';
  return `${one.name} could soon declare war on you: ${share(one.threat.readiness)} of the strength it needs ${near(one.threat)}, ${one.from}. The game ran on: its stop on ${dateText(one.stop.day)} was at ${one.stop.share}%, and it stands ${higher}. See At peace in Wars.`;
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
      text: `${name}'s threat has passed for now: ${whyFaded(after, power.id, threat)}.`,
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
    return `it has fallen to ${percent(threat.readiness) === '0%' ? 'under 1%' : share(threat.readiness)} of the strength it needs to declare war on you, and must stand at ${percent(NOTICE_SHARE)} for ${NOTICE_DAYS} days before it may`;
  const name = factionName(state, power);
  const notice = `${name} must stand at ${percent(NOTICE_SHARE)} for ${NOTICE_DAYS} days before it may declare`;
  if (threat)
    return threat.heldBy.length > 0
      ? `it is at war with ${listed(threat.heldBy.map((enemy) => factionName(state, enemy)))}, which ties down all its armies, and ${notice}`
      : `it has no strength to spare against you, and must stand at ${percent(NOTICE_SHARE)} for ${NOTICE_DAYS} days before it may`;
  const ready = Object.values(state.armies).some(
    (army) =>
      army.owner === power &&
      (army.activity.kind === 'idle' || army.activity.kind === 'marching') &&
      canFight(state, army),
  );
  return `${ready ? 'none of its cities is near enough to yours to weigh a war on you' : 'none of its armies stands ready to march'}, and ${notice}`;
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

const percent = (n: number) => `${Math.round(Math.min(1, n) * 100)}%`;

/** A share of the strength a power needs, where one below NOTICE_SHARE that rounds up to it reads "just under", not as the notice. */
export function share(n: number): string {
  return n < NOTICE_SHARE && percent(n) === percent(NOTICE_SHARE)
    ? `just under ${percent(NOTICE_SHARE)}`
    : percent(n);
}

/**
 * Whether a share leaves the power free to declare: still at NOTICE_SHARE or more, so from its
 * named day, or below, so not until it has stood at NOTICE_SHARE for NOTICE_DAYS.
 */
export function verdictText(state: State, power: FactionId, readiness: number): string {
  return readiness >= NOTICE_SHARE
    ? `still at ${percent(NOTICE_SHARE)} or more, so it may still declare ${mayDeclareWhen(state, power)}`
    : `${share(readiness).startsWith('just under') ? '' : `below ${percent(NOTICE_SHARE)}, `}so it may not declare until it has stood at ${percent(NOTICE_SHARE)} for ${NOTICE_DAYS} days`;
}

/** What men in training do to one power's threat by the day the last of them musters, as `recruitThreats` plays the days. */
export interface Muster {
  /** Its share the day after they muster. */
  readonly mustered: number;
  /** The day the last of them musters. */
  readonly musters: number;
  /** The day the rules end its notice, before it may first declare and by the muster; undefined if they do not. */
  readonly ended: number | undefined;
}

/** What the men in training do to a power's threat, with the day each kind at each city musters as the days played it (`trainingKey`). */
export interface TrainingMuster extends Muster {
  readonly musteredOn: ReadonlyMap<string, number>;
}

/**
 * Said of men who muster on the first day the power may declare: the power decides that day on
 * the state the day begins with, and the day's recruits muster after its orders.
 */
const SAME_DAY = 'it may declare that same day, before they muster';

/** The first day the power may declare; one not yet on notice that stays at it comes on notice today. */
export const firstDay = (state: State, power: FactionId) =>
  (state.factions[power]?.noticeSince ?? state.day) + NOTICE_DAYS;

/**
 * `men`, the men and the share they muster to, with what that does to the power's notice: the day
 * the rules end it, at the muster or before, or, with none, still free to declare from its day,
 * or the men too late when they muster on or after it.
 */
export function musterVerdict(state: State, power: FactionId, muster: Muster, men: string): string {
  const { mustered, musters, ended } = muster;
  const first = firstDay(state, power);
  if (ended === musters)
    return `${men}, ${verdictText(state, power, Math.min(mustered, NOTICE_SHARE - 1e-9))}`;
  if (ended !== undefined)
    return `${men}; it falls below ${share(NOTICE_SHARE)} on ${dateText(ended)}, so it may not declare until it has stood at ${share(NOTICE_SHARE)} for ${NOTICE_DAYS} days`;
  if (musters >= first && mustered < NOTICE_SHARE)
    return `${men}, ${share(mustered).startsWith('just under') ? '' : `below ${share(NOTICE_SHARE)}, `}but ${first <= state.day ? 'it may declare any day now, before they muster' : musters === first ? SAME_DAY : `it may declare from ${dateText(first)}, before they muster`}`;
  return `${men}, ${verdictText(state, power, mustered)}`;
}

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
  power: FactionId,
  threat: Threat,
  waiting: State,
  by: number | undefined,
  where: Where = 'panel',
  muster?: TrainingMuster,
  treasury?: string,
  guards = '',
): string {
  if (threat.pressed)
    return ` ${raiseAdvice(state, power, waiting, by, where, muster)}. It weighs you so only while you hold no more cities than at the start.`;
  const front = state.cities[threat.front];
  const gold = state.factions[state.player]?.stores.gold ?? 0;
  const hoard =
    treasury ??
    (threat.hoard > 0
      ? ` Your treasury of ${whole(gold)} gold lowers the strength it needs by ${Math.round(threat.hoard * 100)}%, so more gold brings war nearer.`
      : '');
  return `${hoard}${front ? ` Your armies on land within ${whole(WAR_FRONT_KM)} km count; more men, or guards at ${front.name} for ${GUARD_DETER_DAYS} days, lower it.` : ''}${guards}`;
}

/** A share of the strength a power needs that the player's treasury takes off, below which the warning does not name a purchase. */
export const CLEAR_HOARD = 0.1;

/**
 * What the player's treasury does to the warning, said plainly for a stranger who sits on gold,
 * with what spending it would do: the building that repays soonest in a city that builds nothing
 * (`worthBuilding`, as the building hint names it), ordered on a copy of the day through the
 * rules' own handler, and the share the power would stand at with that gold spent. Said when the
 * treasury is what takes the power to NOTICE_SHARE, or takes CLEAR_HOARD or more off the
 * strength it needs, and nothing when no building is worth buying or the purchase leaves the
 * share as it reads now. The wars panel keeps the plain hoard sentence, which it reckons on every
 * refresh without a copy of the day.
 */
export function treasuryAdvice(
  state: State,
  world: World,
  power: FactionId,
  threat: Threat,
): string | undefined {
  if (threat.pressed || threat.hoard <= 0) return undefined;
  const empty = structuredClone(state) as GameState;
  const stores = empty.factions[state.player]?.stores;
  if (stores) stores.gold = 0;
  // Reckoned again, not scaled: with the treasury empty the power may weigh the player another way.
  const without = warReadiness(empty, world, power, state.player)?.readiness ?? 0;
  const decides = threat.readiness >= NOTICE_SHARE && without < NOTICE_SHARE;
  if (!decides && threat.hoard < CLEAR_HOARD) return undefined;
  const found = worthBuilding(state);
  if (!found) return undefined;
  const spent = structuredClone(state) as GameState;
  const order: Order = {
    kind: 'build',
    faction: state.player,
    city: found.city.id,
    building: found.kind,
  };
  if (executeOrder(spent, order, world)) return undefined;
  const after = warReadiness(spent, world, power, state.player)?.readiness;
  if (after === undefined || share(after) === share(threat.readiness)) return undefined;
  const gold = state.factions[state.player]?.stores.gold ?? 0;
  const { name, gold: price } = BUILDINGS[found.kind];
  const why = decides
    ? `is what brings it this near: without that gold it would stand at ${share(without)}`
    : `takes ${Math.round(threat.hoard * 100)}% off the strength it needs`;
  return ` Your treasury of ${whole(gold)} gold ${why}. Building ${name} at ${found.city.name} for ${whole(price)} gold would take it to ${share(after)}.`;
}

/** Where the advice is read: the corner, with room for the warning's 12 lines, or the wars panel. */
type Where = 'corner' | 'panel';

/** How near one great power at peace with the player stands to declaring war on it today, as the wars panel lists it. */
export interface StandingThreat {
  readonly power: FactionId;
  readonly name: string;
  /** Its share of the strength it needs, 0 to 1, or undefined when it weighs no war on the player. */
  readonly readiness: number | undefined;
  /** The player's city whose forces it weighs, or every army in the field; undefined when it weighs no war. */
  readonly weighs: CityId | 'field' | undefined;
  /** The share by which the player's treasury lowers the strength it needs, 0 when it does not. */
  readonly hoard: number;
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
  waiting: State = state,
  training?: ReadonlyMap<FactionId, TrainingMuster>,
  told: ReadonlySet<string> = new Set(),
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
          weighs: undefined,
          hoard: 0,
          text: `${name} is not weighing a war on you now: none of its cities is near enough to yours, or none of its armies stands ready to march.`,
        };
      // What counts at a city and what the treasury takes off are the same for every power, so the notes say them once.
      const advice = threat.pressed
        ? whatCounts(
            state,
            power.id,
            threat,
            waiting,
            dayToCome(state, power.noticeSince),
            'panel',
            training?.get(power.id),
          )
        : '';
      return {
        power: power.id,
        name,
        readiness: Math.min(1, threat.readiness),
        weighs: threat.pressed ? 'field' : threat.front,
        hoard: threat.hoard,
        text: `${name} has ${share(threat.readiness)} of the strength it needs to declare war on you, ${weighed(state, threat)}.${advice}${power.noticeSince === null ? '' : ` It may declare ${mayDeclare(state, power.noticeSince)} if it holds it.${ranOnRow(told, power.id, power.noticeSince)}`}`,
      };
    });
}

/** An At peace row's word that the power's warning on this notice did not stop the game, and the stop that spared it. */
function ranOnRow(told: ReadonlySet<string>, power: FactionId, since: number): string {
  const last = warnedOn(told, power);
  const stop = stopOf(told, power);
  if (last === undefined || !stop || last < since || last <= stop.day) return '';
  return ` It warned again on ${dateText(last)} and the game ran on: its stop on ${dateText(stop.day)} was at ${stop.share}%.`;
}

/** How many great powers at peace with the player stand at THREAT_WARN or nearer today, as the top bar counts them. */
export function powersNearWar(state: State, world: World): number {
  return standingThreats(state, world).filter((threat) => (threat.readiness ?? 0) >= THREAT_WARN)
    .length;
}

/** Armies named one by one in a note; the rest are counted together, so a large realm's note still fits the panel. */
export const NAMED_ARMIES = 3;

/**
 * What the powers of the At peace list weigh, said once for all of them, in the order of
 * `threats`: for each of the player's cities a power weighs, the player's armies that count
 * there by the rule, every army on land within WAR_FRONT_KM of it, each by its name and its
 * men, and those that do not, at sea or so far away; for powers that weigh the field armies,
 * every army that can fight, wherever it stands; and once, what the treasury takes off each
 * power that weighs a city.
 */
export function weighedNotes(state: State, threats: readonly StandingThreat[]): string[] {
  const player = state.player;
  const armies = Object.values(state.armies)
    .filter((army) => army.owner === player)
    .sort((a, b) => menOf(state, b) - menOf(state, a) || (a.id < b.id ? -1 : 1));
  const notes: string[] = [];
  for (const weighs of new Set(threats.flatMap((threat) => threat.weighs ?? []))) {
    if (weighs === 'field') {
      const fighting = armies.filter((army) => strengthOf(state, army) > 0);
      const broken = armies.filter((army) => strengthOf(state, army) === 0);
      notes.push(
        `In the field, every army of yours counts, wherever it stands, at sea too: ${
          fighting.length === 0 ? 'you have none now' : counted(fighting, state)
        }${broken.length === 0 ? '' : `; ${uncounted(broken.map((army) => `${army.name} (broken)`))}`}.`,
      );
      continue;
    }
    const city = state.cities[weighs];
    if (!city) continue;
    const near = armies.filter(
      (army) => standsWithin(army, city.position, WAR_FRONT_KM) && strengthOf(state, army) > 0,
    );
    const away = armies
      .filter((army) => !near.includes(army))
      .map((army) => ({ army, why: notCounted(army, city.position) }))
      .sort((a, b) => a.why.km - b.why.km || (a.army.id < b.army.id ? -1 : 1));
    const absent =
      away.length === 0
        ? ''
        : ` ${uncounted(away.map(({ army, why }) => `${army.name} (${why.text})`))}.`;
    notes.push(
      `Near ${city.name}, your armies on land within ${whole(WAR_FRONT_KM)} km count: ${
        near.length === 0 ? 'none stands there now' : counted(near, state)
      }.${absent} More men, or guards at ${city.name} for ${GUARD_DETER_DAYS} days, lower it.`,
    );
  }
  const lowered = threats.filter((threat) => threat.weighs !== 'field' && threat.hoard > 0);
  if (lowered.length > 0) {
    const gold = state.factions[player]?.stores.gold ?? 0;
    notes.push(
      `Your treasury of ${whole(gold)} gold lowers the strength ${listed(lowered.map((threat) => `${threat.name} needs by ${Math.round(threat.hoard * 100)}%`))}, so more gold brings war nearer.`,
    );
  }
  return notes;
}

/** The armies that count, the largest by name and the rest together with their men. */
function counted(armies: readonly DeepReadonly<Army>[], state: State): string {
  const shown = armies
    .slice(0, NAMED_ARMIES)
    .map((army) => `${army.name} (${whole(menOf(state, army))} men)`);
  const rest = armies.slice(NAMED_ARMIES);
  if (rest.length === 0) return listed(shown);
  const men = rest.reduce((sum, army) => sum + menOf(state, army), 0);
  return listed([...shown, `${whole(rest.length)} more with ${whole(men)} men`]);
}

/** The armies that do not count, the first NAMED_ARMIES by name and the rest by their number. */
function uncounted(armies: readonly string[]): string {
  const shown = armies.slice(0, NAMED_ARMIES);
  const more = armies.length - shown.length;
  return `${listed(more > 0 ? [...shown, `${whole(more)} more`] : shown)} ${armies.length === 1 ? 'does' : 'do'} not`;
}

/** Why an army does not count at a city: at sea, broken, or so far from it, in whole km past the reach. */
function notCounted(army: DeepReadonly<Army>, point: MapPoint): { text: string; km: number } {
  const at = positionOf(army);
  if (!at) return { text: 'at sea', km: Number.POSITIVE_INFINITY };
  const km = distance(at, point);
  if (km <= WAR_FRONT_KM) return { text: 'broken', km };
  return { text: `${whole(Math.ceil(km))} km away`, km };
}

/**
 * What raising men takes today, as the field-army threat advises it. First the men already in
 * training, the waiting orders' too, by troop, city and muster day, and, when `muster` gives
 * the days played to the last muster, what they do to the share; then what more the player can
 * order with the stores the waiting orders leave: the cheapest troop it can afford among those
 * that finish training before the day `by` the power may first declare, since it decides before
 * that day's recruits muster, with its quickest training among the cities that may recruit now.
 * With none affordable in time, the cheapest it can afford and the day it would muster, since men
 * who muster on or after that day still lower a notice the power holds. With none affordable,
 * the cheapest troop's price and days and what the player lacks for it. Once that day has passed,
 * `by` is undefined and every troop is in time. The corner names the men in training, or else
 * the muster day only, as its warning names the day war may come.
 */
function raiseAdvice(
  state: State,
  power: FactionId,
  waiting: State,
  by: number | undefined,
  where: Where,
  muster: TrainingMuster | undefined,
): string {
  const training = inTraining(waiting);
  const stores = waiting.factions[state.player]?.stores;
  if (training.length > 0) {
    if (where === 'corner')
      return `More men lower it, not guards: ${trainingText(training, true)}${muster ? enoughText(state, power, muster) : ''}`;
    // A siege musters a city's men the day it begins, so a forecast that played one names that day.
    const men = trainingText(
      muster
        ? training
            .map((t) => ({ ...t, musters: muster.musteredOn.get(t.key) ?? t.musters }))
            .sort(byMuster)
        : training,
      false,
    );
    const told = muster
      ? musterVerdict(
          state,
          power,
          muster,
          `${men}${training.length === 1 ? ' and take' : ', which take'} it to ${share(muster.mustered)}`,
        )
      : men;
    const more = orderAdvice(state, stores, by);
    const then =
      more.kind === 'none'
        ? `You can raise no more now${more.text === '' ? '' : `: even ${more.text}`}`
        : `Besides them, ${more.text}`;
    return `More men lower it, not guards. ${told}. ${then}`;
  }
  const advice = orderAdvice(state, stores, by);
  if (advice.kind === 'none')
    return advice.text === ''
      ? 'More men lower it, not guards, but no city of yours may recruit now'
      : `More men lower it, not guards, but even ${advice.text}`;
  if (advice.kind === 'late' && where === 'corner')
    // The corner names the day war may come just before, and has no room to say it twice.
    return `More men lower it, not guards: ${TROOP_NAMES[advice.troop]} ordered now muster on ${dateText(advice.musters)}`;
  return `More men lower it, not guards: ${advice.text}`;
}

/**
 * Whether the men in training are enough, in the corner's few words, as the At peace line says it
 * at length: their muster takes the power below NOTICE_SHARE, or the rules end its notice, before
 * the first day it may declare; or they leave it at NOTICE_SHARE or more; or they muster too late.
 */
function enoughText(state: State, power: FactionId, muster: Muster): string {
  if (muster.ended !== undefined) return ', which is enough';
  if (muster.mustered >= NOTICE_SHARE) return ', not enough';
  return muster.musters >= firstDay(state, power) ? ', too late' : ', which is enough';
}

/** What more the player can order: a troop in time, one that musters late, or none, with what it lacks; '' with no city that may recruit. */
type OrderAdvice =
  | { readonly kind: 'inTime'; readonly text: string }
  | {
      readonly kind: 'late';
      readonly text: string;
      readonly troop: Troop;
      readonly musters: number;
    }
  | { readonly kind: 'none'; readonly text: string };

function orderAdvice(
  state: State,
  stores: DeepReadonly<Stores> | undefined,
  by: number | undefined,
): OrderAdvice {
  const cities = Object.values(state.cities).filter(
    (city) => city.owner === state.player && city.unrestDays === 0 && !beleaguered(state, city),
  );
  if (cities.length === 0) return { kind: 'none', text: '' };
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
    return {
      kind: 'inTime',
      text: `${TROOP_NAMES[inTime]} cost ${whole(TROOPS[inTime].recruit.gold)} gold and train in ${whole(days(inTime))} days`,
    };
  const [late] = affordable;
  if (late && by !== undefined) {
    const musters = state.day + days(late);
    const when =
      musters === by
        ? `but ${SAME_DAY}`
        : `${whole(musters - by)} ${musters - by === 1 ? 'day' : 'days'} after war may first come`;
    return {
      kind: 'late',
      troop: late,
      musters,
      text: `order ${TROOP_NAMES[late]} now for ${whole(TROOPS[late].recruit.gold)} gold; they muster and lower it from ${dateText(musters)}, ${when}`,
    };
  }
  const [cheapest] = troops;
  if (!cheapest) return { kind: 'none', text: '' };
  const { gold: price, men } = TROOPS[cheapest].recruit;
  const name = TROOP_NAMES[cheapest];
  return {
    kind: 'none',
    text:
      gold < price
        ? `${name} cost ${whole(price)} gold, ${whole(days(cheapest))} days; you have ${whole(gold)} gold`
        : `${name} need ${whole(men)} men, ${whole(days(cheapest))} days; you have ${whole(manpower)} manpower`,
  };
}

/** One kind of troop in training at one of the player's cities, mustering on one day. */
interface Training {
  readonly key: string;
  readonly troop: Troop;
  readonly city: string;
  readonly musters: number;
}

/** One kind of troop in training at one city, due on one day, as the field-army advice names it. */
export const trainingKey = (troop: Troop, city: CityId, readyOn: number) =>
  `${troop}:${city}:${readyOn}`;

const byMuster = (a: Training, b: Training) =>
  a.musters - b.musters || a.city.localeCompare(b.city);

/** The player's men in training on the state, by muster day, one entry for each troop, city and day. */
function inTraining(state: State): Training[] {
  const found = new Map<string, Training>();
  for (const city of Object.values(state.cities)) {
    if (city.owner !== state.player) continue;
    for (const recruit of city.recruits)
      found.set(trainingKey(recruit.troop, city.id, recruit.readyOn), {
        key: trainingKey(recruit.troop, city.id, recruit.readyOn),
        troop: recruit.troop,
        city: city.name,
        musters: recruit.readyOn,
      });
  }
  return [...found.values()].sort(byMuster);
}

/**
 * "Skirmishers in training at Roma muster on Year 1, day 111 and Spearmen at Capua on Year 1,
 * day 115", the first NAMED_ARMIES and the rest counted, or in the corner, where room is short,
 * "Skirmishers in training muster on Year 1, day 111", or of several troops "men in training
 * muster by Year 1, day 115".
 */
function trainingText(training: readonly Training[], short: boolean): string {
  const last = training.at(-1)?.musters ?? 0;
  if (short) {
    const [troop, ...others] = new Set(training.map((t) => TROOP_NAMES[t.troop]));
    return `${others.length === 0 ? troop : 'men'} in training muster ${training.length === 1 ? 'on' : 'by'} ${dateText(last)}`;
  }
  const [first, ...others] = training;
  if (!first) return '';
  const shown = others
    .slice(0, NAMED_ARMIES - 1)
    .map((t) => `${TROOP_NAMES[t.troop]} at ${t.city} on ${dateText(t.musters)}`);
  const more = others.length - shown.length;
  return listed([
    `${TROOP_NAMES[first.troop]} in training at ${first.city} muster on ${dateText(first.musters)}`,
    ...shown,
    ...(more > 0 ? [`${whole(more)} more by ${dateText(last)}`] : []),
  ]);
}
