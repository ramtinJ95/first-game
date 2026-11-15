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
import { TRADE_INVITATION_DAYS } from '../sim/trade/routes.ts';
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
    /** The cargoes the first line told of, so the tally speaks only of more. */
    told: v.number(),
  }),
  v.object({ kind: v.literal('siege'), city: CityIdSchema, last: DaySchema }),
]);
export const TradeTroublesSchema = v.array(TradeTroubleSchema);
export type TradeTrouble = v.InferOutput<typeof TradeTroubleSchema>;
type Raids = Extract<TradeTrouble, { kind: 'raids' }>;
type State = DeepReadonly<GameState>;
type Event = DeepReadonly<DayEvent>;
type TradeEvent = Extract<Event, { kind: `trade${string}` }>;
type Interruption = Extract<TradeEvent, { kind: 'tradeRaided' }>;

/**
 * The day's news of the player's trade, one line for each thing that happened rather
 * than one for each route: routes that open, invitations and their end, routes that
 * close for one cause on one day, a siege that stops the player's routes, and an
 * enemy's raids on a road. The first raid of an episode is told at once with what it
 * took; later raids are counted and told when the road has been quiet for
 * `TRADE_QUIET_DAYS` or the route closes, if they took more.
 */
export function tradeNews(
  before: State,
  after: State,
  events: readonly Event[],
  watched: readonly TradeTrouble[],
): { alerts: Alert[]; watched: TradeTrouble[] } {
  const day = before.day;
  const player = after.player;
  const alerts: Alert[] = [];
  const troubles = watched.map((t) => ({ ...t }));
  const own = events.filter(
    (e): e is TradeEvent =>
      e.kind.startsWith('trade') && 'owners' in e && e.owners.includes(player),
  );
  const name = (city: CityId) => after.cities[city]?.name ?? city;
  const faction = (id: FactionId) => after.factions[id]?.name ?? id;
  const routeName = (t: { from: CityId; to: CityId }) => `${name(t.from)} to ${name(t.to)}`;
  const tell = (alert: Omit<Alert, 'day' | 'focus'>, city: CityId) => {
    const at = after.cities[city];
    const select = at && ({ kind: 'province', province: at.province } as const);
    alerts.push({ ...alert, day, ...(at && select && { focus: { at: at.position, select } }) });
  };

  const closed = new Map<string, TradeEvent[]>();
  for (const event of own) {
    if (event.kind === 'tradeOpened') {
      tell(
        { kind: event.kind, tone: 'good', text: `Trade opened: ${routeName(event)}.` },
        event.to,
      );
    } else if (event.kind === 'tradeOffered') {
      const offer = after.tradeRoutes[event.route];
      const terms = offer
        ? ` by ${offer.mode}, ${offer.days} days a crossing, until ${dateText(offer.openedOn + TRADE_INVITATION_DAYS)}`
        : '';
      tell(
        {
          kind: event.kind,
          tone: 'good',
          text: `${name(event.from)} invites ${name(event.to)} to trade${terms}. Select ${name(event.to)} to accept or refuse.`,
        },
        event.to,
      );
    } else if (event.kind === 'tradeClosed' && event.invitation) {
      tell(
        {
          kind: event.kind,
          tone: 'neutral',
          text: `Invitation to trade ended: ${routeName(event)}, ${event.cause}.`,
        },
        event.to,
      );
    } else if (event.kind === 'tradeClosed') {
      closed.set(event.cause, [...(closed.get(event.cause) ?? []), event]);
    }
  }
  for (const [cause, routes] of closed) {
    const [first] = routes;
    if (!first) continue;
    tell(
      {
        kind: 'tradeClosed',
        tone: 'bad',
        text:
          routes.length > 1
            ? `${routes.length} trade routes closed, ${cause}: ${list(routes.map(routeName))}.`
            : `Trade closed: ${routeName(first)}, ${cause}.`,
      },
      first.to,
    );
  }

  const interruptions = own.filter((e): e is Interruption => e.kind === 'tradeRaided');
  const stopped = new Map<CityId, Interruption[]>();
  for (const event of interruptions) {
    if (event.cause !== 'siege') continue;
    const city =
      [event.from, event.to].find((c) => Object.values(after.sieges).some((s) => s.city === c)) ??
      event.from;
    stopped.set(city, [...(stopped.get(city) ?? []), event]);
  }
  for (const [city, routes] of stopped) {
    if (troubles.some((t) => t.kind === 'siege' && t.city === city)) continue;
    troubles.push({ kind: 'siege', city, last: day });
    const many = routes.length > 1;
    tell(
      {
        kind: 'tradeRaided',
        tone: 'bad',
        text: `The siege of ${name(city)} stops ${many ? `${routes.length} trade routes` : 'trade'}: ${list(routes.map(routeName))}. If ${name(city)} falls, ${many ? 'they close' : 'the route closes'}.`,
      },
      city,
    );
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
      told: cargo,
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
    tell(
      {
        kind: 'tradeRaided',
        tone: 'bad',
        text: `${faction(raider)} raided ${roads} ${list(episodes.map(routeName))} ${
          cargoes
            ? `and took ${cargoText(cargoes)} worth about ${whole(gold)} gold to you`
            : 'but found no cargo to take'
        }. Deliveries stop while its armies stay within reach.`,
      },
      playerEnd(after, first),
    );
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
    if (trouble.cargoes <= trouble.told) continue;
    const took = `took ${cargoText(trouble.cargoes)} worth about ${whole(trouble.gold)} gold to you`;
    tell(
      {
        kind: 'tradeRaidsEnded',
        tone: 'neutral',
        text: route
          ? `${faction(trouble.raider)}'s raids on ${routeName(trouble)} have stopped: ${trouble.raids} raids since ${dateText(trouble.since)} ${took}.`
          : `${faction(trouble.raider)}'s ${trouble.raids} raids on ${routeName(trouble)} ${took} before the route closed.`,
      },
      playerEnd(after, trouble),
    );
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
