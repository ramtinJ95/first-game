import * as v from 'valibot';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { DayEvent } from '../sim/events.ts';
import {
  CityIdSchema,
  FactionIdSchema,
  TradeRouteIdSchema,
  type CityId,
  type FactionId,
} from '../sim/ids.ts';
import { DaySchema } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { adminShareOf } from '../sim/systems/economy.ts';
import type { Alert } from './alerts.ts';
import { dateText, whole } from './names.ts';

/** Days without a raid on a road, or a siege of a city, that end an episode of them. */
export const TRADE_QUIET_DAYS = 60;

/**
 * An episode the trade news is telling: one enemy's raids on one route, counted so the
 * player hears of the first and of the whole when the road clears, or a siege of a city
 * that has stopped the player's routes, told once however often it breaks and resumes.
 */
const TradeTroubleSchema = v.variant('kind', [
  v.object({
    kind: v.literal('raids'),
    route: TradeRouteIdSchema,
    raider: FactionIdSchema,
    from: CityIdSchema,
    to: CityIdSchema,
    since: DaySchema,
    last: DaySchema,
    raids: v.number(),
    cargoes: v.number(),
    gold: v.number(),
  }),
  v.object({ kind: v.literal('siege'), city: CityIdSchema, last: DaySchema }),
]);
export const TradeTroublesSchema = v.array(TradeTroubleSchema);
export type TradeTrouble = v.InferOutput<typeof TradeTroubleSchema>;
type Raids = Extract<TradeTrouble, { kind: 'raids' }>;
type State = DeepReadonly<GameState>;
type Interruption = Extract<DeepReadonly<DayEvent>, { kind: 'tradeRaided' }>;

/**
 * The day's news of raids on the player's roads and sieges that stop the player's
 * routes, one line for each episode rather than one for each route and raid. The first
 * raid of an episode is told at once, with what it took; later raids are counted and
 * told together when the episode ends, if there were any.
 */
export function tradeNews(
  before: State,
  after: State,
  events: readonly DeepReadonly<DayEvent>[],
  watched: readonly TradeTrouble[],
): { alerts: Alert[]; watched: TradeTrouble[] } {
  const day = before.day;
  const player = after.player;
  const alerts: Alert[] = [];
  const troubles = watched.map((t) => ({ ...t }));
  const interruptions = events.filter(
    (e): e is Interruption => e.kind === 'tradeRaided' && e.owners.includes(player),
  );
  const name = (city: CityId) => after.cities[city]?.name ?? city;
  const faction = (id: FactionId) => after.factions[id]?.name ?? id;
  const routeName = (t: { from: CityId; to: CityId }) => `${name(t.from)} to ${name(t.to)}`;
  const focus = (city: CityId) => {
    const at = after.cities[city];
    return at && { at: at.position, select: { kind: 'province', province: at.province } as const };
  };

  const stopped = new Map<CityId, Interruption[]>();
  for (const event of interruptions) {
    if (event.cause !== 'siege') continue;
    const city = [event.from, event.to].find((c) =>
      Object.values(after.sieges).some((s) => s.city === c),
    );
    const at = city ?? event.from;
    stopped.set(at, [...(stopped.get(at) ?? []), event]);
  }
  for (const [city, routes] of stopped) {
    if (troubles.some((t) => t.kind === 'siege' && t.city === city)) continue;
    troubles.push({ kind: 'siege', city, last: day });
    const many = routes.length > 1;
    alerts.push({
      kind: 'tradeRaided',
      day,
      tone: 'bad',
      text: `The siege of ${name(city)} stops ${many ? `${routes.length} trade routes` : 'trade'}: ${list(routes.map(routeName))}. If ${name(city)} falls, ${many ? 'they close' : 'the route closes'}.`,
      ...(focus(city) && { focus: focus(city) }),
    });
  }

  const opened = new Map<FactionId, Raids[]>();
  for (const event of interruptions) {
    if (event.cause !== 'raid') continue;
    const route = before.tradeRoutes[event.route] ?? after.tradeRoutes[event.route];
    const ends = route ? Number(route.owner === player) + Number(route.partner === player) : 1;
    const cargo = event.looted > 0 ? 1 : 0;
    const gold = event.looted * adminShareOf(after, player) * ends;
    const open = troubles.find(
      (t): t is Raids => t.kind === 'raids' && t.route === event.route && t.raider === event.raider,
    );
    if (open) {
      open.raids++;
      open.cargoes += cargo;
      open.gold += gold;
      open.last = day;
      continue;
    }
    const raids: Raids = {
      kind: 'raids',
      route: event.route,
      raider: event.raider,
      from: event.from,
      to: event.to,
      since: day,
      last: day,
      raids: 1,
      cargoes: cargo,
      gold,
    };
    troubles.push(raids);
    opened.set(event.raider, [...(opened.get(event.raider) ?? []), raids]);
  }
  for (const [raider, episodes] of opened) {
    const [first] = episodes;
    if (!first) continue;
    const cargoes = episodes.reduce((sum, e) => sum + e.cargoes, 0);
    const gold = episodes.reduce((sum, e) => sum + e.gold, 0);
    const roads = episodes.length > 1 ? `${episodes.length} roads` : 'the road';
    alerts.push({
      kind: 'tradeRaided',
      day,
      tone: 'bad',
      text: `${faction(raider)} raided ${roads} ${list(episodes.map(routeName))} ${
        cargoes
          ? `and took ${cargoText(cargoes)} worth about ${whole(gold)} gold to you`
          : 'but found no cargo to take'
      }. Deliveries stop while its armies stay within reach.`,
      ...(focus(playerEnd(after, first)) && { focus: focus(playerEnd(after, first)) }),
    });
  }

  const kept: TradeTrouble[] = [];
  for (const trouble of troubles) {
    if (trouble.kind === 'siege') {
      if (Object.values(after.sieges).some((s) => s.city === trouble.city)) trouble.last = day;
      if (day - trouble.last < TRADE_QUIET_DAYS) kept.push(trouble);
      continue;
    }
    const route = after.tradeRoutes[trouble.route];
    if (route?.blocked === 'raid') trouble.last = day;
    if (route && day - trouble.last < TRADE_QUIET_DAYS) {
      kept.push(trouble);
      continue;
    }
    if (trouble.raids < 2) continue;
    const took = trouble.cargoes
      ? `took ${cargoText(trouble.cargoes)} worth about ${whole(trouble.gold)} gold to you`
      : 'took no cargo';
    alerts.push({
      kind: 'tradeRaidsEnded',
      day,
      tone: 'neutral',
      text: route
        ? `${faction(trouble.raider)}'s raids on ${routeName(trouble)} have stopped: ${trouble.raids} raids since ${dateText(trouble.since)} ${took}.`
        : `${faction(trouble.raider)}'s ${trouble.raids} raids on ${routeName(trouble)} ${took} before the route closed.`,
      ...(focus(playerEnd(after, trouble)) && { focus: focus(playerEnd(after, trouble)) }),
    });
  }
  return { alerts, watched: kept };
}

function playerEnd(state: State, route: { from: CityId; to: CityId }): CityId {
  return state.cities[route.from]?.owner === state.player ? route.from : route.to;
}

const cargoText = (n: number) => (n === 1 ? 'a cargo' : `${n} cargoes`);

function list(items: readonly string[]): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
    : (items[0] ?? '');
}
