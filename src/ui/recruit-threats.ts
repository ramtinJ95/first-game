import { dateText, factionName, whole } from '../app/names.ts';
import {
  musterVerdict,
  powersNearWar,
  share,
  standingThreats,
  THREAT_WARN,
  verdictText,
  trainingKey,
  type Muster,
  type TrainingMuster,
} from '../app/threat-news.ts';
import { NOTICE_DAYS, NOTICE_SHARE, WAR_FRONT_KM } from '../sim/ai/thresholds.ts';
import { truceBetween } from '../sim/peace/truce.ts';
import { areAtWar } from '../sim/wars.ts';
import { standsWithin } from '../sim/ai/situation.ts';
import { warReadiness } from '../sim/ai/war.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId } from '../sim/ids.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { RALLY_DISTANCE } from '../sim/systems/economy.ts';
import { SYSTEMS } from '../sim/systems.ts';
import type { Troop } from '../sim/troops.ts';
import type { World } from '../sim/world/world.ts';
import { afterWaiting } from './buildings-text.ts';

type State = DeepReadonly<GameState>;

/** What one troop ordered in a city does to one power's threat, as its card says it. */
export interface RecruitThreat extends Muster {
  readonly power: FactionId;
  /** Its share today, as the waiting orders leave the day. */
  readonly now: number;
  /** Its share the day after the order, once the gold is paid. */
  readonly paid: number;
  /** Whether the power counts the mustered men at all. */
  readonly counted: boolean;
  /** What the same days do with no new order: the share the day after the muster, and the day the rules end the notice. */
  readonly without: { readonly mustered: number; readonly ended: number | undefined };
  readonly text: string;
}

/**
 * For each troop the player can order in the city, what it does to each great power that
 * stands near war with the player, by the rule the power declares by (`warReadiness`): the share
 * now, the day after the order, once its gold is paid, and the day after its men muster, and
 * whether the power's notice holds, as the `notice` system keeps it. The order is paid through
 * the rules' own handler and each day to the muster is played by the rules' own systems, with no
 * order of any power, so no march, battle, or order a power may give is foreseen. Empty while no
 * power stands near war.
 */
export function recruitThreats(
  state: State,
  pending: readonly Order[],
  city: DeepReadonly<City>,
  world: World,
  troops: readonly Troop[],
): ReadonlyMap<Troop, readonly RecruitThreat[]> {
  const threats = new Map<Troop, RecruitThreat[]>();
  // The day's news has reckoned each power's readiness already, so a day with none near war costs nothing here.
  if (powersNearWar(state, world) === 0) return threats;
  const waiting = afterWaiting(state, pending, world);
  const player = state.player;
  const near = Object.values(waiting.factions)
    .filter((power) => power.id !== player && power.kind === 'greatPower')
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .flatMap((power) => {
      const now = warReadiness(waiting, world, power.id, player);
      return now && now.readiness >= THREAT_WARN ? [{ power: power.id, now }] : [];
    });
  if (near.length === 0) return threats;
  const without = baselineOf(state, pending, waiting, world, near);
  for (const troop of troops) {
    const ordered = structuredClone(waiting) as GameState;
    if (executeOrder(ordered, { kind: 'recruit', faction: player, city: city.id, troop }, world))
      continue;
    const recruit = ordered.cities[city.id]?.recruits.at(-1);
    if (!recruit) continue;
    const days = playToMuster(ordered, world, near, recruit.readyOn, (played) =>
      Boolean(played.cities[city.id]?.recruits.includes(recruit)),
    );
    const { musters } = days;
    // The men rally to the army of the player's at the city, which holds a formation new since today.
    const army = Object.values(days.played.armies).find(
      (a) =>
        a.owner === player &&
        standsWithin(a, city.position, RALLY_DISTANCE) &&
        a.formations.some((id) => !waiting.formations[id]),
    );
    const alone = without(musters);
    threats.set(
      troop,
      near.map(({ power, now }) => {
        const front = days.played.cities[now.front];
        const counted =
          now.pressed || !front || !army || standsWithin(army, front.position, WAR_FRONT_KM);
        const forecast = {
          power,
          now: now.readiness,
          paid: days.paid.get(power) ?? 0,
          mustered: days.mustered.get(power) ?? 0,
          musters,
          counted,
          ended: days.ended.get(power),
          without: {
            mustered: alone.mustered.get(power) ?? 0,
            ended: alone.ended(power, musters),
          },
        };
        return { ...forecast, text: threatText(state, forecast, front?.name) };
      }),
    );
  }
  return threats;
}

/**
 * Plays each day from the order's through the muster day with the rules' own systems, as a tick
 * plays it with no orders, and reads each power's share the day after the order and the day after
 * the muster, and the day its notice ends before it may first declare. A power not yet on notice
 * that stays near war comes on notice the day the order is played. A city an enemy besieges
 * musters its recruits at once, so the men muster the first day `training` finds them gone.
 */
function playToMuster(
  ordered: GameState,
  world: World,
  near: readonly { power: FactionId }[],
  readyOn: number,
  training: (played: GameState, day: number) => boolean,
) {
  const from = ordered.day;
  const held = new Map(
    near.map(({ power }) => [power, ordered.factions[power]?.noticeSince ?? from]),
  );
  let played = ordered;
  let paid = new Map<FactionId, number>();
  const ended = new Map<FactionId, number>();
  let musters = readyOn;
  for (let day = from; day <= musters; day++) {
    played = renewed(played);
    for (const system of SYSTEMS) system(played, world);
    if (!training(played, day)) musters = day;
    for (const [power, since] of held)
      if (
        !ended.has(power) &&
        day < since + NOTICE_DAYS &&
        played.factions[power]?.noticeSince !== since
      )
        ended.set(power, day);
    if (day === from) paid = sharesOf(renewed(played), world, near);
  }
  return { played, paid, ended, musters, mustered: sharesOf(renewed(played), world, near) };
}

/** What the days to a muster do with no new order, played once for a state and its waiting orders. */
interface Baseline {
  played: GameState;
  /** Each power's share the day after each day played, by day. */
  readonly shares: Map<number, Map<FactionId, number>>;
  /** The day the rules end each power's notice before it may first declare. */
  readonly ended: Map<FactionId, number>;
  readonly held: ReadonlyMap<FactionId, number>;
}

const baselines = new WeakMap<State, WeakMap<readonly Order[], Baseline>>();

/**
 * The days a card plays, from the order's through a muster day, played with no new order, so a
 * card can say what its troop changes. Each card reads the same play, which goes on only as far
 * as the latest muster asked of it, so six cards add one play of the longest training.
 */
function baselineOf(
  state: State,
  pending: readonly Order[],
  waiting: State,
  world: World,
  near: readonly { power: FactionId }[],
) {
  let byOrders = baselines.get(state);
  if (!byOrders) {
    byOrders = new WeakMap();
    baselines.set(state, byOrders);
  }
  let base = byOrders.get(pending);
  if (!base) {
    const played = structuredClone(waiting) as GameState;
    base = {
      played,
      shares: new Map(),
      ended: new Map(),
      held: new Map(
        near.map(({ power }) => [power, played.factions[power]?.noticeSince ?? played.day]),
      ),
    };
    byOrders.set(pending, base);
  }
  const from = waiting.day;
  const known = base;
  return (musters: number) => {
    for (let day = known.played.day; day <= musters; day++) {
      known.played = renewed(known.played);
      for (const system of SYSTEMS) system(known.played, world);
      for (const [power, since] of known.held)
        if (
          !known.ended.has(power) &&
          day < since + NOTICE_DAYS &&
          known.played.factions[power]?.noticeSince !== since
        )
          known.ended.set(power, day);
      known.shares.set(day, sharesOf(renewed(known.played), world, near));
    }
    return {
      mustered: known.shares.get(Math.max(from, musters)) ?? new Map<FactionId, number>(),
      ended: (power: FactionId, by: number) => {
        const day = known.ended.get(power);
        return day !== undefined && day <= by ? day : undefined;
      },
    };
  };
}

/**
 * What the men the player has in training on `waiting`, the day as the waiting orders leave it,
 * do to each great power at peace with it that weighs its field armies, by the day after the last
 * of them musters: the days a recruit card plays, with no new order. Empty with none in training.
 */
export function trainingThreats(
  waiting: State,
  world: World,
): ReadonlyMap<FactionId, TrainingMuster> {
  const player = waiting.player;
  const own = Object.values(waiting.cities).filter((city) => city.owner === player);
  if (own.every((city) => city.recruits.length === 0)) return new Map();
  const pressed = Object.values(waiting.factions)
    .filter(
      (power) =>
        power.id !== player &&
        power.kind === 'greatPower' &&
        !areAtWar(waiting, power.id, player) &&
        !truceBetween(waiting, power.id, player) &&
        warReadiness(waiting, world, power.id, player)?.pressed === true,
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((power) => ({ power: power.id }));
  if (pressed.length === 0) return new Map();
  const readyOn = Math.max(...own.flatMap((city) => city.recruits.map((r) => r.readyOn)));
  const ordered = structuredClone(waiting) as GameState;
  const left = new Map(
    own.flatMap((city) =>
      (ordered.cities[city.id]?.recruits ?? []).map(
        (recruit) =>
          [
            recruit,
            { city: city.id, key: trainingKey(recruit.troop, city.id, recruit.readyOn) },
          ] as const,
      ),
    ),
  );
  const musteredOn = new Map<string, number>();
  // Each kind at each city musters on the day its last man leaves training, early under a siege.
  const training = (played: State, day: number) => {
    for (const [recruit, { city, key }] of left)
      if (!played.cities[city]?.recruits.includes(recruit)) {
        musteredOn.set(key, day);
        left.delete(recruit);
      }
    return left.size > 0;
  };
  const days = playToMuster(ordered, world, pressed, readyOn, training);
  return new Map(
    pressed.map(({ power }) => [
      power,
      {
        mustered: days.mustered.get(power) ?? 0,
        musters: days.musters,
        ended: days.ended.get(power),
        musteredOn,
      },
    ]),
  );
}

/**
 * The state with fresh collections, as a tick's own copy gives each day: the AI caches by the
 * state and its collections, so a day must not read what an earlier day cached.
 */
function renewed(state: GameState): GameState {
  return {
    ...state,
    armies: { ...state.armies },
    formations: { ...state.formations },
    cities: { ...state.cities },
    factions: { ...state.factions },
    wars: { ...state.wars },
    sieges: { ...state.sieges },
    battles: { ...state.battles },
  };
}

/** Each power's share of the strength it needs against the player on the state. */
function sharesOf(
  state: State,
  world: World,
  near: readonly { power: FactionId }[],
): Map<FactionId, number> {
  return new Map(
    near.map(({ power }) => [
      power,
      warReadiness(state, world, power, state.player)?.readiness ?? 0,
    ]),
  );
}

/**
 * "Carthage 81% now, 74% once paid, 65% once they muster on Year 1, day 140, against 78% without
 * them, below 80%, so it may not declare until it has stood at 80% for 30 days": the verdict comes
 * from the day the rules end the notice, the order's day, the muster's, or a day between, and with
 * none it is still free to declare from its day, or the men come too late when they muster on or
 * after it. Men who muster beyond its reach are said not to count. A notice the same days end with
 * no new order is not the troop's doing, and the card says it ends with or without them.
 */
function threatText(
  state: State,
  forecast: Omit<RecruitThreat, 'text'>,
  front: string | undefined,
): string {
  const { power, now, paid, mustered, musters, counted, ended, without } = forecast;
  const name = factionName(state, power);
  const opening = `${name} ${share(now)} now, ${share(paid)} once paid`;
  const alone =
    share(without.mustered) === share(mustered)
      ? ''
      : `, against ${share(without.mustered)} without them`;
  const men = `${share(mustered)} once they muster on ${dateText(musters)}${counted ? '' : `, beyond ${whole(WAR_FRONT_KM)} km of ${front ?? 'the city it weighs'}, where they do not count`}${alone}`;
  const notice = `so it may not declare until it has stood at ${share(NOTICE_SHARE)} for ${NOTICE_DAYS} days`;
  if (without.ended !== undefined && ended !== undefined) {
    const falls =
      ended >= without.ended
        ? `it falls below ${share(NOTICE_SHARE)} on ${dateText(without.ended)} with or without them`
        : `it falls below ${share(NOTICE_SHARE)} on ${dateText(ended)}, not until ${dateText(without.ended)} without them`;
    return `${opening}, ${men}; ${falls}, ${notice}`;
  }
  // A notice the rules end reads as below the line, whatever the next day's share rounds to.
  if (ended === state.day)
    return `${opening}, ${verdictText(state, power, Math.min(paid, NOTICE_SHARE - 1e-9))}; ${men}`;
  return `${opening}, ${musterVerdict(state, power, forecast, men)}`;
}

/** While the clock runs, the cards say to pause instead of reckoning every troop each day: the names of the powers near war. */
export function nearWarNames(state: State, world: World): string[] {
  return standingThreats(state, world)
    .filter((threat) => (threat.readiness ?? 0) >= THREAT_WARN)
    .map((threat) => threat.name);
}
