import { readFileSync } from 'node:fs';
import { decideAll } from '../src/sim/ai/decide.ts';
import type { CityId, FactionId, TradeRouteId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { DayEvent } from '../src/sim/events.ts';
import type { Day } from '../src/sim/state/day.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { adminShareOf } from '../src/sim/systems/economy.ts';
import { tick } from '../src/sim/tick.ts';
import * as routes from '../src/sim/trade/routes.ts';
import { areAtWar } from '../src/sim/wars.ts';
import { distance } from '../src/sim/world/find-path.ts';
import { buildWorld, type World } from '../src/sim/world/world.ts';
import { threatNewsOfDay } from '../src/app/threat-news.ts';
import { GUARD_BAND, GUARD_GOLD, guardRefusal } from '../src/sim/guards.ts';
import { warReadiness } from '../src/sim/ai/war.ts';
import { THREAT_CLEAR, THREAT_WARN } from '../src/app/threat-news.ts';
import { WAR_REACH_KM } from '../src/sim/ai/thresholds.ts';
import { limitsOf } from '../src/sim/systems/economy.ts';
import { homeCapital } from '../src/sim/ai/situation.ts';

export const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
export const world: World = buildWorld(map);
export const rome = 'rome' as FactionId;
const MODES = ['land', 'sea'] as const;
const IMPROVE_PAYBACK_DAYS = 3 * 365;
const TRADE_FLOOR = 600;
const GUARD_CHECK_DAYS = 45;

/** A city to hire at tomorrow: until no great power stands at THREAT_CLEAR there, or until it is full. */
interface Threat {
  city: CityId;
  until: 'calm' | 'full' | 'three';
}

/**
 * How the cautious Rome hires guards. `monthly` is #80's measure: a band a month at the
 * last warned city or the capital while gold after it stays at half its limit. `every` is
 * the seventh play-through's way: at each 45-day check, a band at every city a warning has
 * named that has room, while the gold after it stays at a quarter of its limit; the tester's
 * gold never ran low. `warned` reads the threat: the day after a warning names a city, and at
 * each check where a great power stands at THREAT_WARN, it hires at that power's front until no
 * great power stands at THREAT_CLEAR there, keeping the same quarter of its limit; the day after a great power declares, it fills
 * each of Rome's cities in that power's reach, nearest first. `war` is the seventh
 * play-through's Ariminum: three bands at Rome's city nearest a great power the day after
 * it declares, and none at peace.
 */
export type GuardPlay = 'never' | 'monthly' | 'every' | 'warned' | 'war';

export interface CautiousDay {
  before: GameState;
  after: GameState;
  events: readonly DayEvent[];
  /** Rome's orders the rules took today, its trade and the AI's spending for it alike. */
  accepted: readonly Order[];
}

/**
 * The cautious Rome of `scripts/sim/trade-judge.ts --heed --improve`: every faction plays
 * the AI, Rome included, except Rome's trade, which accepts every invitation the AI would,
 * opens its best route by return per gold monthly, improves the route that repays soonest
 * with no route to open, skips a partner at war or a besieged end, and declares no war on
 * a partner whose routes have not repaid. With `peaceful`, Rome declares no war at all,
 * as the tester's cautious Rome did. `guards` picks how it hires guards (`GuardPlay`). Unlike trade-judge, a war Rome holds back does not
 * also hold back its trade that month. Plays until the years are out or Rome falls.
 */
export function playCautiousRome(
  seed: number,
  years: number,
  onDay: (day: CautiousDay) => void,
  { peaceful = false, guards = 'never' }: { peaceful?: boolean; guards?: GuardPlay } = {},
): GameState {
  const told = new Set<string>();
  let warnedAt: CityId | undefined;
  const named = new Set<CityId>();
  let threatened: Threat[] = [];
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const ledger = new Map<TradeRouteId, { paid: number; received: number; deliveries: number }>();
  for (let day = 0; day < years * 365; day++) {
    const ai = decideAll(state, world, []);
    const owing = (faction: FactionId) =>
      [...ledger].some(([id, entry]) => {
        const route = state.tradeRoutes[id];
        const other = route?.owner === rome ? route.partner : route?.owner;
        return other === faction && entry.received < entry.paid;
      });
    const held = (o: Order) =>
      o.faction === rome && o.kind === 'declareWar' && (peaceful || owing(o.against));
    const orders: Order[] = ai.filter(
      (o) =>
        !held(o) &&
        (o.faction !== rome ||
          !['openTrade', 'acceptTrade', 'closeTrade', 'improveTrade'].includes(o.kind)),
    );
    const trade = tradeOrders(
      state,
      ai.filter((o) => o.faction === rome && !held(o)),
    );
    const hires =
      guards === 'monthly' && trade.length === 0
        ? guardOrders(state, warnedAt)
        : guards === 'every' && state.day % GUARD_CHECK_DAYS === 0
          ? hiresAt(state, [...named].reverse(), guardFloor(state))
          : guards === 'war'
            ? readerHires(state, threatened)
            : guards === 'warned'
              ? readerHires(state, [
                  ...threatened,
                  ...(state.day % GUARD_CHECK_DAYS === 0 ? nearWar(state) : []),
                ])
              : [];
    threatened = [];
    orders.unshift(...trade, ...hires);
    const before = new Set(Object.keys(state.tradeRoutes));
    const { state: next, rejected, events } = tick(state, orders, world);
    const accepted = orders.filter(
      (o) => o.faction === rome && !rejected.some((r) => r.order === o),
    );
    for (const order of accepted) {
      if (order.kind === 'acceptTrade' && next.tradeRoutes[order.route]?.status === 'running')
        ledger.set(order.route, { paid: 0, received: 0, deliveries: 0 });
      const entry = order.kind === 'improveTrade' ? ledger.get(order.route) : undefined;
      const route = order.kind === 'improveTrade' ? state.tradeRoutes[order.route] : undefined;
      const cost = route && routes.improvementCost(route);
      if (entry && cost) entry.paid += cost;
    }
    for (const route of Object.values(next.tradeRoutes)) {
      if (before.has(route.id) || route.owner !== rome || route.status !== 'running') continue;
      if (accepted.some((o) => o.kind === 'openTrade'))
        ledger.set(route.id, { paid: route.cost, received: 0, deliveries: 0 });
    }
    for (const route of Object.values(next.tradeRoutes))
      if (
        route.status === 'running' &&
        (route.owner === rome || route.partner === rome) &&
        !ledger.has(route.id)
      )
        ledger.set(route.id, { paid: 0, received: 0, deliveries: route.deliveries });
    for (const [id, entry] of ledger) {
      const route = next.tradeRoutes[id];
      if (route && route.deliveries > entry.deliveries) {
        const ends = Number(route.owner === rome) + Number(route.partner === rome);
        entry.received +=
          (route.deliveries - entry.deliveries) *
          routes.routeRate(route) *
          route.days *
          adminShareOf(next, rome) *
          ends;
        entry.deliveries = route.deliveries;
      }
      if (!route || (route.owner !== rome && route.partner !== rome)) ledger.delete(id);
    }
    for (const alert of threatNewsOfDay(state, next, world, told)) {
      const at = alert.focus?.at;
      warnedAt = Object.values(next.cities).find(
        (city) => at && city.owner === rome && city.position.x === at.x && city.position.y === at.y,
      )?.id;
      if (warnedAt) {
        named.delete(warnedAt);
        named.add(warnedAt);
        if (guards === 'warned') threatened.push({ city: warnedAt, until: 'calm' });
      }
    }
    for (const event of events) {
      if (event.kind !== 'warDeclared' || event.against !== rome) continue;
      if (next.factions[event.by]?.kind !== 'greatPower') continue;
      const reach = inReach(next, event.by);
      if (guards === 'war' && reach[0]) threatened.push({ city: reach[0], until: 'three' });
      if (guards === 'warned') for (const city of reach) threatened.push({ city, until: 'full' });
    }
    onDay({ before: state, after: next, events, accepted });
    state = next;
    if (state.factions[rome]?.defeatedOn !== null) break;
  }
  return state;
}

/**
 * On its monthly turn with no trade to buy, Rome hires a band of guards for a year while
 * its gold after the band is at least half its limit: at the city the last warning of a
 * coming war named, else at its capital.
 */
function guardOrders(state: GameState, warnedAt: CityId | undefined): Order[] {
  if (state.day % 30 !== 0) return [];
  const gold = state.factions[rome]?.stores.gold ?? 0;
  const limit = limitsOf(state).get(rome)?.gold ?? Infinity;
  if (gold - GUARD_GOLD < limit / 2) return [];
  const capital = homeCapital(state, world, rome);
  for (const id of [warnedAt, capital?.id]) {
    const city = id && state.cities[id];
    if (city && !guardRefusal(state, city, rome))
      return [{ kind: 'hireGuards', faction: rome, city: city.id }];
  }
  return [];
}

/** One band at each city named, in order, while the rules take it and the gold after it stays at the floor. */
function hiresAt(state: GameState, cities: readonly CityId[], floor: number): Order[] {
  if (cities.length === 0) return [];
  const hired = structuredClone(state);
  const orders: Order[] = [];
  for (const id of cities) {
    const order: Order = { kind: 'hireGuards', faction: rome, city: id };
    const city = hired.cities[id];
    const stores = hired.factions[rome]?.stores;
    if (!city || !stores || guardRefusal(hired, city, rome) || stores.gold - GUARD_GOLD < floor)
      continue;
    stores.gold -= GUARD_GOLD;
    city.guards.push({ until: Infinity as Day });
    orders.push(order);
  }
  return orders;
}

/** The gold Rome keeps back from guards at peace, so its army is still paid for: a quarter of its limit. */
function guardFloor(state: GameState): number {
  return (limitsOf(state).get(rome)?.gold ?? 0) / 4;
}

/** The reader's hires, each band weighed on a copy of the day as the warning would weigh it. */
function readerHires(state: GameState, threats: readonly Threat[]): Order[] {
  if (threats.length === 0) return [];
  const hired = structuredClone(state);
  const orders: Order[] = [];
  const powers = Object.values(hired.factions).filter(
    (f) => f.kind === 'greatPower' && f.id !== rome && f.defeatedOn === null,
  );
  const calm = (id: CityId) =>
    powers.every((p) => {
      const threat = warReadiness(hired, world, p.id, rome);
      return !threat || threat.front !== id || threat.readiness < THREAT_CLEAR;
    });
  const floor = guardFloor(state);
  for (const { city: id, until } of threats) {
    for (;;) {
      const city = hired.cities[id];
      const stores = hired.factions[rome]?.stores;
      if (!city || !stores || guardRefusal(hired, city, rome)) break;
      if (until === 'calm' && stores.gold - GUARD_GOLD < floor) break;
      if (until === 'calm' && calm(id)) break;
      if (
        until === 'three' &&
        orders.filter((o) => o.kind === 'hireGuards' && o.city === id).length >= 3
      )
        break;
      stores.gold -= GUARD_GOLD;
      city.guards.push({ until: Infinity as Day });
      city.garrison += GUARD_BAND;
      orders.push({ kind: 'hireGuards', faction: rome, city: id });
    }
  }
  return orders;
}

/** Rome's cities within WAR_REACH_KM of a city of the power, nearest first. */
function inReach(state: GameState, power: FactionId): CityId[] {
  const theirs = Object.values(state.cities).filter((c) => c.owner === power);
  return Object.values(state.cities)
    .filter((c) => c.owner === rome)
    .map((c) => ({
      id: c.id,
      km: Math.min(...theirs.map((t) => distance(c.position, t.position))),
    }))
    .filter((c) => c.km <= WAR_REACH_KM)
    .sort((a, b) => a.km - b.km)
    .map((c) => c.id);
}

/** The cities where a great power at peace with Rome stands at THREAT_WARN of what it needs, as the panel's standing line shows. */
function nearWar(state: GameState): Threat[] {
  const found: Threat[] = [];
  for (const power of Object.values(state.factions)) {
    if (power.kind !== 'greatPower' || power.id === rome || power.defeatedOn !== null) continue;
    const threat = warReadiness(state, world, power.id, rome);
    if (threat && threat.readiness >= THREAT_WARN)
      found.push({ city: threat.front, until: 'calm' });
  }
  return found;
}

function tradeOrders(state: GameState, ai: readonly Order[]): Order[] {
  const invitation = Object.values(state.tradeRoutes).find(
    (r) => r.status === 'offered' && r.partner === rome,
  );
  if (invitation) {
    const from = state.cities[invitation.from];
    const to = state.cities[invitation.to];
    const accept =
      ai.some((o) => o.kind === 'acceptTrade') && !(from && to && risky(state, from.id, to.id));
    return [{ kind: accept ? 'acceptTrade' : 'closeTrade', faction: rome, route: invitation.id }];
  }
  if (state.day % 30 !== 0 || ai.some((o) => o.kind === 'declareWar')) return [];
  const budget = (state.factions[rome]?.stores.gold ?? 0) - TRADE_FLOOR;
  const best = quotes(state).filter((q) => q.cost <= budget)[0];
  if (best) return [best.order];
  return improvement(state, budget);
}

function improvement(state: GameState, budget: number): Order[] {
  const share = adminShareOf(state, rome);
  let pick: { order: Order; days: number } | undefined;
  for (const route of Object.values(state.tradeRoutes)) {
    const cost = routes.improvementCost(route);
    if (route.status !== 'running' || cost === undefined || cost > budget) continue;
    if (route.owner !== rome && route.partner !== rome) continue;
    if (route.improvedBy.length >= 2) continue;
    const ends = Number(route.owner === rome) + Number(route.partner === rome);
    const days = cost / (route.daily * 0.25 * ends * share);
    if (days <= IMPROVE_PAYBACK_DAYS && (!pick || days < pick.days))
      pick = { order: { kind: 'improveTrade', faction: rome, route: route.id }, days };
  }
  return pick ? [pick.order] : [];
}

function quotes(state: GameState) {
  const found: { order: Order; cost: number; income: number }[] = [];
  for (const from of Object.values(state.cities)) {
    if (from.owner !== rome) continue;
    for (const to of Object.values(state.cities)) {
      if (to.id === from.id || distance(from.position, to.position) > routes.TRADE_RANGE.sea)
        continue;
      if (risky(state, from.id, to.id)) continue;
      for (const mode of MODES) {
        if (routes.tradeProblem(state, world, rome, from.id, to.id, mode, false)) continue;
        const f = routes.tradeForecast(state, world, from, to, mode);
        if (!f) continue;
        const income = f.fromDaily + (to.owner === rome ? f.toDaily : 0);
        found.push({
          order: { kind: 'openTrade', faction: rome, from: from.id, to: to.id, mode },
          cost: f.cost,
          income,
        });
      }
    }
  }
  return found.sort((a, b) => b.income / b.cost - a.income / a.cost || b.income - a.income);
}

function risky(state: GameState, from: CityId, to: CityId): boolean {
  const partner = state.cities[to];
  if (!partner) return true;
  const atWar = Object.values(state.factions).some(
    (f) => f.id !== partner.owner && areAtWar(state, partner.owner, f.id),
  );
  const besieged = Object.values(state.sieges).some((s) => s.city === from || s.city === to);
  return atWar || besieged;
}
