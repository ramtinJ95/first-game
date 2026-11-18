import { dateText, factionName, whole } from '../app/names.ts';
import { powersNearWar, standingThreats, THREAT_WARN } from '../app/threat-news.ts';
import { NOTICE_DAYS, NOTICE_SHARE, WAR_FRONT_KM } from '../sim/ai/thresholds.ts';
import { standsWithin } from '../sim/ai/situation.ts';
import { warReadiness } from '../sim/ai/war.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { City, Recruit } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { RALLY_DISTANCE } from '../sim/systems/economy.ts';
import { SYSTEMS } from '../sim/systems.ts';
import type { Troop } from '../sim/troops.ts';
import type { World } from '../sim/world/world.ts';
import { afterWaiting } from './buildings-text.ts';
import { share, verdictText } from './guards-text.ts';

type State = DeepReadonly<GameState>;

/** What one troop ordered in a city does to one power's threat, as its card says it. */
export interface RecruitThreat {
  readonly power: FactionId;
  /** Its share today, as the waiting orders leave the day. */
  readonly now: number;
  /** Its share the day after the order, once the gold is paid. */
  readonly paid: number;
  /** Its share the day after the men muster. */
  readonly mustered: number;
  /** The day the men muster. */
  readonly musters: number;
  /** Whether the power counts the mustered men at all. */
  readonly counted: boolean;
  /** The day the rules end its notice, from the order's day through the muster, before it may first declare; undefined if they do not. */
  readonly ended: number | undefined;
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
  for (const troop of troops) {
    const ordered = structuredClone(waiting) as GameState;
    if (executeOrder(ordered, { kind: 'recruit', faction: player, city: city.id, troop }, world))
      continue;
    const recruit = ordered.cities[city.id]?.recruits.at(-1);
    if (!recruit) continue;
    const days = playToMuster(ordered, world, near, city.id, recruit);
    const { musters } = days;
    // The men rally to the army of the player's at the city, which holds a formation new since today.
    const army = Object.values(days.played.armies).find(
      (a) =>
        a.owner === player &&
        standsWithin(a, city.position, RALLY_DISTANCE) &&
        a.formations.some((id) => !waiting.formations[id]),
    );
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
 * that stays near war comes on notice the day the order is played.
 */
function playToMuster(
  ordered: GameState,
  world: World,
  near: readonly { power: FactionId }[],
  city: CityId,
  recruit: DeepReadonly<Recruit>,
) {
  const from = ordered.day;
  const held = new Map(
    near.map(({ power }) => [power, ordered.factions[power]?.noticeSince ?? from]),
  );
  let played = ordered;
  let paid = new Map<FactionId, number>();
  const ended = new Map<FactionId, number>();
  let musters = recruit.readyOn;
  for (let day = from; day <= musters; day++) {
    played = renewed(played);
    for (const system of SYSTEMS) system(played, world);
    // A city an enemy besieges musters its recruits at once, so the men muster the day they leave training.
    if (!played.cities[city]?.recruits.includes(recruit)) musters = day;
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

/** The first day the power may declare; one not yet on notice that stays at it comes on notice the day the order is played. */
const firstDay = (state: State, power: FactionId) =>
  (state.factions[power]?.noticeSince ?? state.day) + NOTICE_DAYS;

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
 * "Carthage 81% now, 74% once paid, 65% once they muster on Year 1, day 140, below 80%, so it may
 * not declare until it has stood at 80% for 30 days": the verdict comes from the day the rules end
 * the notice, the order's day, the muster's, or a day between, and with none it is still free to
 * declare from its day, or the men come too late when they muster on or after it. Men who muster
 * beyond its reach are said not to count.
 */
function threatText(
  state: State,
  forecast: Omit<RecruitThreat, 'text'>,
  front: string | undefined,
): string {
  const { power, now, paid, mustered, musters, counted, ended } = forecast;
  const name = factionName(state, power);
  const first = firstDay(state, power);
  const opening = `${name} ${share(now)} now, ${share(paid)} once paid`;
  const men = `${share(mustered)} once they muster on ${dateText(musters)}${counted ? '' : `, beyond ${whole(WAR_FRONT_KM)} km of ${front ?? 'the city it weighs'}, where they do not count`}`;
  // A notice the rules end reads as below the line, whatever the next day's share rounds to.
  const below = (n: number) => verdictText(state, power, Math.min(n, NOTICE_SHARE - 1e-9));
  if (ended === state.day) return `${opening}, ${below(paid)}; ${men}`;
  if (ended === musters) return `${opening}, ${men}, ${below(mustered)}`;
  if (ended !== undefined)
    return `${opening}, ${men}; it falls below ${share(NOTICE_SHARE)} on ${dateText(ended)}, so it may not declare until it has stood at ${share(NOTICE_SHARE)} for ${NOTICE_DAYS} days`;
  if (musters >= first && mustered < NOTICE_SHARE)
    return `${opening}, ${men}, ${share(mustered).startsWith('just under') ? '' : `below ${share(NOTICE_SHARE)}, `}but it may declare ${first <= state.day ? 'any day now' : `from ${dateText(first)}`}, before they muster`;
  return `${opening}, ${men}, ${verdictText(state, power, mustered)}`;
}
/** While the clock runs, the cards say to pause instead of reckoning every troop each day: the names of the powers near war. */
export function nearWarNames(state: State, world: World): string[] {
  return standingThreats(state, world)
    .filter((threat) => (threat.readiness ?? 0) >= THREAT_WARN)
    .map((threat) => threat.name);
}
