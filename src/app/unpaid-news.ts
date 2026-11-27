import { ADVANCES } from '../sim/advances/advances.ts';
import { BUILDINGS } from '../sim/buildings/buildings.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { DayEvent } from '../sim/events.ts';
import type { CityId, TradeRouteId } from '../sim/ids.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import type { Alert } from './alerts.ts';
import { TROOP_NAMES, whole } from './names.ts';

type State = DeepReadonly<GameState>;

/** What an order paid for, in words, and where it stands on the map when it has a place. */
interface Paid {
  readonly name: string;
  /** Whether the words name one thing or many, for "it costs" or "they cost". */
  readonly many: boolean;
  readonly failed: string;
  readonly city?: CityId;
}

function cityName(states: readonly State[], id: CityId): string {
  for (const state of states) {
    const city = state.cities[id];
    if (city) return city.name;
  }
  return id;
}

function routeName(states: readonly State[], id: TradeRouteId): string {
  for (const state of states) {
    const route = state.tradeRoutes[id];
    if (route)
      return `the route from ${cityName(states, route.from)} to ${cityName(states, route.to)}`;
  }
  return 'a trade route';
}

function paidOf(states: readonly State[], order: Order): Paid {
  switch (order.kind) {
    case 'study':
      return { name: ADVANCES[order.advance].name, many: false, failed: 'was not begun' };
    case 'build':
      return {
        name: `${BUILDINGS[order.building].name} at ${cityName(states, order.city)}`,
        many: false,
        failed: 'was not begun',
        city: order.city,
      };
    case 'recruit':
      return {
        name: `${TROOP_NAMES[order.troop]} at ${cityName(states, order.city)}`,
        many: true,
        failed: 'were not raised',
        city: order.city,
      };
    case 'hireGuards':
      return {
        name: `Guards at ${cityName(states, order.city)}`,
        many: true,
        failed: 'were not hired',
        city: order.city,
      };
    case 'improveTrade':
      return { name: routeName(states, order.route), many: false, failed: 'was not improved' };
    case 'openTrade':
      return {
        name: `the route from ${cityName(states, order.from)} to ${cityName(states, order.to)}`,
        many: false,
        failed: 'was not opened',
        city: order.from,
      };
    case 'acceptPeace':
      return {
        name: `the peace with ${states[0]?.factions[order.from]?.name ?? order.from}`,
        many: false,
        failed: 'was not made',
      };
    default:
      return { name: 'An order', many: false, failed: 'was not carried out' };
  }
}

/** "A", "A and B", or "A, B and C". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * One line for each of the player's orders that the treasury could not pay when it came to
 * be paid, from the tick's `orderUnpaid` events: what failed, its price, the gold held, and
 * the orders that spent the gold earlier that day.
 */
export function unpaidNewsOfDay(before: State, later: State, events: readonly DayEvent[]): Alert[] {
  const states = [later, before];
  return events.flatMap((event): Alert[] => {
    if (event.kind !== 'orderUnpaid' || event.faction !== before.player) return [];
    const paid = paidOf(states, event.order);
    const subject = paid.name.replace(/^./, (c) => c.toUpperCase());
    const spent = event.paidBefore.map((order) => paidOf(states, order).name);
    const since = spent.length > 0 ? ` after ${listed(spent)}` : '';
    const city = paid.city && (later.cities[paid.city] ?? before.cities[paid.city]);
    const at: MapPoint | undefined = city?.position;
    return [
      {
        kind: 'orderUnpaid',
        day: before.day,
        tone: 'bad',
        text: `${subject} ${paid.failed}: ${paid.many ? 'they cost' : 'it costs'} ${whole(event.cost)} gold and the treasury held ${whole(Math.floor(event.held))}${since}.`,
        ...(at && city
          ? { focus: { at, select: { kind: 'province', province: city.province } as const } }
          : {}),
        ...(event.order.kind === 'study' ? { opens: 'advances' as const } : {}),
      },
    ];
  });
}
