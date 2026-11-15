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

/** The most days a raid episode that stays open keeps its new losses before telling them. */
export const TRADE_TALLY_DAYS = 30;

/**
 * An episode the trade news is telling: one enemy's raids on the player's roads, counted
 * so the player hears of the first, of new losses at most `TRADE_TALLY_DAYS` later while
 * the raids go on, and of the whole once the roads are quiet, or a siege
 * of a partner's city that has stopped the player's routes, told once however often it
 * breaks and resumes.
 */
const TradeTroubleSchema = v.variant('kind', [
  v.object({
    kind: v.literal('raids'),
    raider: FactionIdSchema,
    roads: v.array(v.object({ route: TradeRouteIdSchema, from: CityIdSchema, to: CityIdSchema })),
    since: DaySchema,
    last: DaySchema,
    raids: v.number(),
    cargoes: v.number(),
    gold: v.number(),
    /** The cargoes and gold the lines so far told of, and the day of the last line. */
    told: v.number(),
    toldGold: v.number(),
    toldOn: DaySchema,
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
 * close for one cause on one day, a siege of a partner's city that stops the player's
 * routes, and an enemy's raids on the player's roads. The first raid of an episode is
 * told at once with what it took; later losses are told at most `TRADE_TALLY_DAYS` after
 * the last line while the raids go on, and the whole episode once the roads have been
 * quiet for `TRADE_QUIET_DAYS` or their routes close, if it took more.
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
    const city = [event.from, event.to].find((c) =>
      Object.values(after.sieges).some((s) => s.city === c),
    );
    // The player's own city under siege is the city's own news, which pauses the game.
    if (!city || after.cities[city]?.owner === player) continue;
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
        text: `The siege of ${name(city)} stops ${many ? `${routes.length} trade routes` : 'trade'}: ${list(routes.map(routeName))}. If ${name(city)} falls to a power at war with the other end, ${many ? 'they close' : 'the route closes'}; to one at peace with it, ${many ? 'they pass' : 'it passes'} to the new owner.`,
      },
      city,
    );
  }

  const opened: Raids[] = [];
  for (const event of interruptions) {
    if (event.cause !== 'raid') continue;
    const route = before.tradeRoutes[event.route] ?? after.tradeRoutes[event.route];
    const ends = route ? Number(route.owner === player) + Number(route.partner === player) : 1;
    const cargo = event.looted > 0 ? 1 : 0;
    const gold = event.looted * adminShareOf(after, player) * ends;
    const road = { route: event.route, from: event.from, to: event.to };
    let raids = troubles.find((t): t is Raids => t.kind === 'raids' && t.raider === event.raider);
    if (!raids) {
      raids = {
        kind: 'raids',
        raider: event.raider,
        roads: [],
        since: day,
        last: day,
        raids: 0,
        cargoes: 0,
        gold: 0,
        told: 0,
        toldGold: 0,
        toldOn: day,
      };
      troubles.push(raids);
      opened.push(raids);
    }
    if (!raids.roads.some((r) => r.route === road.route)) raids.roads.push(road);
    raids.raids++;
    raids.cargoes += cargo;
    raids.gold += gold;
    raids.last = day;
    if (opened.includes(raids)) Object.assign(raids, { told: raids.cargoes, toldGold: raids.gold });
  }
  for (const raids of opened) {
    const [first] = raids.roads;
    if (!first) continue;
    const roads = raids.roads.length > 1 ? `${raids.roads.length} roads` : 'the road';
    tell(
      {
        kind: 'tradeRaided',
        tone: 'bad',
        text: `${faction(raids.raider)} raided ${roads} ${list(raids.roads.map(routeName))} ${
          raids.cargoes
            ? `and took ${cargoText(raids.cargoes)} worth about ${whole(raids.gold)} gold to you`
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
    const open = trouble.roads.filter((r) => after.tradeRoutes[r.route]);
    if (open.some((r) => after.tradeRoutes[r.route]?.blocked === 'raid')) trouble.last = day;
    if (open.length && day - trouble.last < TRADE_QUIET_DAYS) {
      kept.push(trouble);
      const [first] = trouble.roads;
      if (!first || trouble.cargoes <= trouble.told || day - trouble.toldOn < TRADE_TALLY_DAYS)
        continue;
      tell(
        {
          kind: 'tradeRaided',
          tone: 'bad',
          text: `${faction(trouble.raider)}'s raids on ${list(trouble.roads.map(routeName))} took ${moreText(trouble.cargoes - trouble.told)} worth about ${whole(trouble.gold - trouble.toldGold)} gold to you since ${dateText(trouble.toldOn)}.`,
        },
        playerEnd(after, first),
      );
      Object.assign(trouble, { told: trouble.cargoes, toldGold: trouble.gold, toldOn: day });
      continue;
    }
    if (trouble.cargoes <= trouble.told) continue;
    const roads = list(trouble.roads.map(routeName));
    const took = `took ${cargoText(trouble.cargoes)} worth about ${whole(trouble.gold)} gold to you`;
    const [first] = trouble.roads;
    if (!first) continue;
    tell(
      {
        kind: 'tradeRaidsEnded',
        tone: 'neutral',
        text: open.length
          ? `${faction(trouble.raider)}'s raids have stopped: ${trouble.raids} raids on ${roads} since ${dateText(trouble.since)} ${took}.`
          : `${faction(trouble.raider)}'s ${trouble.raids} raids on ${roads} ${took} before ${trouble.roads.length > 1 ? 'the routes' : 'the route'} closed.`,
      },
      playerEnd(after, first),
    );
  }
  return { alerts, watched: kept };
}

function playerEnd(state: State, route: { from: CityId; to: CityId }): CityId {
  return state.cities[route.from]?.owner === state.player ? route.from : route.to;
}

const cargoText = (n: number) => (n === 1 ? 'a cargo' : `${n} cargoes`);
const moreText = (n: number) => (n === 1 ? 'another cargo' : `${n} more cargoes`);

function list(items: readonly string[]): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
    : (items[0] ?? '');
}
