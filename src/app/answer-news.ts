import { decideAll } from '../sim/ai/decide.ts';
import { NOTICE_DAYS, WAR_FRONT_KM } from '../sim/ai/thresholds.ts';
import { warReadiness } from '../sim/ai/war.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { DayEvent } from '../sim/events.ts';
import type { ArmyId, CityId, FactionId, TradeRouteId } from '../sim/ids.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { tick } from '../sim/tick.ts';
import type { Troop } from '../sim/troops.ts';
import { areAtWar } from '../sim/wars.ts';
import { distance } from '../sim/world/find-path.ts';
import type { World } from '../sim/world/world.ts';
import type { Alert } from './alerts.ts';
import { dateText, factionName, TROOP_NAMES, whole } from './names.ts';
import { share, THREAT_STAND_DAYS } from './threat-news.ts';

type State = DeepReadonly<GameState>;

/** What the player did about a warning, as the news names it. */
export type Answer =
  | { readonly kind: 'raised'; readonly troop: Troop }
  | { readonly kind: 'guards'; readonly city: CityId }
  | { readonly kind: 'march'; readonly army: string; readonly city: CityId };

/** One great power the player was warned of, and how far its war has come in the game and without the answer. */
interface Warned {
  readonly power: FactionId;
  readonly front: CityId;
  /** The first day it could declare, as the warning named it. */
  readonly firstWar: number;
  /** The day it declared without the answer, and with it, once each has. */
  without?: number;
  with?: number;
  /** Its share that day without the answer, and with it. */
  shares?: { readonly without: number; readonly with: number };
  /** The day the front fell without the answer while it held in the game. */
  fellWithout?: number;
  /** Nothing more to tell of it. */
  done: boolean;
}

/**
 * The game without the answer: a copy of the day before the first answer, played on each day
 * after with the same orders of every power the AI runs, as it decides them on the copy, and
 * the player's orders less every answer.
 */
interface Watch {
  without: GameState;
  readonly answers: Answer[];
  readonly warned: Map<FactionId, Warned>;
  readonly until: number;
}

/** The kinds of order that may answer a warning (`answerOf`). */
const ANSWERS = new Set<Order['kind']>(['recruit', 'hireGuards', 'moveArmy']);

/** How long the game is played without an answer, after the first day of war it was given to: a war on a warning seldom outlasts it. */
export const ANSWER_WATCH_DAYS = 2 * 365;

/** The powers whose warning stands today: on notice for its week, at peace with the player, and with a first day of war to come or come. */
function warnedOf(state: State, world: World): Warned[] {
  const found: Warned[] = [];
  for (const power of Object.values(state.factions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const since = power.noticeSince;
    if (power.kind !== 'greatPower' || power.id === state.player || since === null) continue;
    if (state.day - since + 1 < THREAT_STAND_DAYS || areAtWar(state, power.id, state.player))
      continue;
    const threat = warReadiness(state, world, power.id, state.player);
    if (!threat) continue;
    found.push({
      power: power.id,
      front: threat.front,
      firstWar: since + NOTICE_DAYS,
      done: false,
    });
  }
  return found;
}

/**
 * The answer an order of the player's gives to the warned powers: a troop raised, guards hired
 * at a front a warning named, or an army marched to within WAR_FRONT_KM of one from beyond it.
 */
function answerOf(state: State, order: Order, warned: readonly Warned[]): Answer | undefined {
  if (order.faction !== state.player) return undefined;
  if (order.kind === 'recruit') return { kind: 'raised', troop: order.troop };
  if (order.kind === 'hireGuards' && warned.some((w) => w.front === order.city))
    return { kind: 'guards', city: order.city };
  if (order.kind !== 'moveArmy') return undefined;
  const army = state.armies[order.army];
  const at = army?.activity.kind === 'embarked' ? undefined : army?.activity.position;
  for (const w of warned) {
    const front = state.cities[w.front];
    if (!front || !army || distance(order.to, front.position) > WAR_FRONT_KM) continue;
    if (at && distance(at, front.position) <= WAR_FRONT_KM) continue;
    return { kind: 'march', army: army.name, city: w.front };
  }
  return undefined;
}

/** "the 2 bands of guards you hired at Capua and the Skirmishers you raised", each kind once. */
function answerText(state: State, answers: readonly Answer[]): string {
  const parts: string[] = [];
  const guards = new Map<CityId, number>();
  for (const a of answers)
    if (a.kind === 'guards') guards.set(a.city, (guards.get(a.city) ?? 0) + 1);
  for (const [city, bands] of guards)
    parts.push(
      `the ${bands === 1 ? 'band' : `${whole(bands)} bands`} of guards you hired at ${state.cities[city]?.name ?? city}`,
    );
  const troops = [...new Set(answers.flatMap((a) => (a.kind === 'raised' ? [a.troop] : [])))];
  if (troops.length > 0) parts.push(`the ${listed(troops.map((t) => TROOP_NAMES[t]))} you raised`);
  for (const a of answers)
    if (a.kind === 'march')
      parts.push(`${a.army}'s march to ${state.cities[a.city]?.name ?? a.city}`);
  return listed(parts);
}

const listed = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * Whether every army and trade route the order names is the same record in the game and in the
 * game without the answer: an army of the same owner and name, a route of the same owner and
 * ends. Where one is not, the player's order would do something else in the copy, or nothing,
 * so the copy no longer plays the game less the answer.
 */
function sameRecords(game: State, copy: State, order: Order): boolean {
  const named = order as { army?: unknown; into?: unknown; route?: unknown };
  for (const id of [named.army, named.into]) {
    if (typeof id !== 'string') continue;
    const real = game.armies[id as ArmyId];
    const other = copy.armies[id as ArmyId];
    if (!real || !other || real.owner !== other.owner || real.name !== other.name) return false;
  }
  if (typeof named.route === 'string') {
    const real = game.tradeRoutes[named.route as TradeRouteId];
    const other = copy.tradeRoutes[named.route as TradeRouteId];
    if (!real || !other) return false;
    if (real.owner !== other.owner || real.from !== other.from || real.to !== other.to)
      return false;
  }
  return true;
}

const declaredBy = (events: readonly DayEvent[], power: FactionId, player: FactionId) =>
  events.some((e) => e.kind === 'warDeclared' && e.by === power && e.against === player);

/**
 * Watches each warning the player answers and tells, in plain words, only what the answer
 * changed, against the game played day by day without it (`Watch`): a power that could have
 * declared on the day its warning named and did not, though without the answer it would have;
 * one that declared later than it would have without the answer; and one that made peace
 * without the city its warning named, which without the answer it would have taken. Where the
 * game without the answer goes the same way, it says nothing. The copy is played only while a
 * warning it was given to may still turn out either way, and at most ANSWER_WATCH_DAYS after
 * the first day of war, so a game with no answer pays for none. A load forgets it.
 */
export function createAnswerNews(world: World, decide = (state: State) => decideAll(state, world)) {
  let watch: Watch | undefined;
  return {
    /** The day's news, given the day before its tick, the day after, its events, and the player's orders it played. */
    onDay(
      before: State,
      after: State,
      events: readonly DayEvent[],
      orders: readonly Order[],
    ): Alert[] {
      const player = after.player;
      // A day with no game played without an answer, and no order that could be one, reckons nothing.
      if (!watch && !orders.some((o) => o.faction === player && ANSWERS.has(o.kind))) return [];
      const warned = warnedOf(before, world);
      const answers = orders.flatMap((order) => {
        const answer = answerOf(before, order, [
          ...warned,
          ...(watch ? [...watch.warned.values()] : []),
        ]);
        return answer ? [{ order, answer }] : [];
      });
      if (!watch && answers.length > 0 && warned.length > 0)
        watch = {
          without: structuredClone(before) as GameState,
          answers: [],
          warned: new Map(warned.map((w) => [w.power, w])),
          until: Math.max(...warned.map((w) => w.firstWar)) + ANSWER_WATCH_DAYS,
        };
      if (!watch) return [];
      for (const w of warned) if (!watch.warned.has(w.power)) watch.warned.set(w.power, w);
      watch.answers.push(...answers.map((a) => a.answer));
      const kept = orders.filter((order) => !answers.some((a) => a.order === order));
      const without = watch.without;
      // Ids are handed out from one counter, so a record made in one game may carry another id in the other.
      if (!kept.every((order) => sameRecords(before, without, order))) {
        watch = undefined;
        return [];
      }
      const played = tick(without, [...kept, ...decide(without)], world);
      watch.without = played.state;
      const news: Alert[] = [];
      const said = answerText(after, watch.answers);
      const peaceWith = (power: FactionId) =>
        events.some(
          (e) => e.kind === 'peaceMade' && e.between.includes(power) && e.between.includes(player),
        );
      for (const w of watch.warned.values()) {
        if (w.done) continue;
        const name = factionName(after, w.power);
        const front = after.cities[w.front];
        const focus = front ? { focus: { at: front.position } } : {};
        if (w.without === undefined && declaredBy(played.events, w.power, player)) {
          w.without = before.day;
          w.shares = {
            without: warReadiness(without, world, w.power, player)?.readiness ?? 0,
            with: warReadiness(before, world, w.power, player)?.readiness ?? 0,
          };
        }
        if (w.with === undefined && declaredBy(events, w.power, player)) w.with = before.day;
        // It declared before it would have without the answer: the answer held nothing off.
        if (w.with !== undefined && w.without === undefined) {
          w.done = true;
          continue;
        }
        if (
          w.fellWithout === undefined &&
          watch.without.cities[w.front]?.owner === w.power &&
          front?.owner === player
        )
          w.fellWithout = before.day;
        if (w.without === before.day && w.with === undefined)
          news.push({
            kind: 'warAnswered',
            day: before.day,
            tone: 'good',
            text: `${name} could have declared war on you today, as warned, and did not. Without ${said} it would have: it stands at ${share(w.shares?.with ?? 0)} of the strength it needs, not ${share(w.shares?.without ?? 0)}.`,
            ...focus,
          });
        if (w.with === before.day && w.without !== undefined && w.without < w.with)
          news.push({
            kind: 'warAnswered',
            day: before.day,
            tone: 'neutral',
            text: `${name} declared war ${whole(w.with - w.without)} days later than it would have without ${said}, which held it off from ${dateText(w.without)}.`,
            ...focus,
          });
        // Once at war in the game, what is left to tell is whether the named city outlives the war.
        if (w.with === undefined) continue;
        if (front?.owner !== player) w.done = true;
        else if (peaceWith(w.power)) {
          w.done = true;
          if (w.fellWithout !== undefined)
            news.push({
              kind: 'warAnswered',
              day: before.day,
              tone: 'good',
              text: `${name} made peace without taking ${front.name}. Without ${said} it would have taken ${front.name} on ${dateText(w.fellWithout)}.`,
              ...focus,
            });
        }
      }
      // A warning may still turn out either way while the power stands on notice or at war in the game without the answer.
      const copy = watch.without;
      const open = [...watch.warned.values()].some(
        (w) =>
          !w.done &&
          (w.without !== undefined ||
            copy.factions[w.power]?.noticeSince != null ||
            areAtWar(copy, w.power, player)),
      );
      if (!open || before.day >= watch.until) watch = undefined;
      return news;
    },
  };
}
