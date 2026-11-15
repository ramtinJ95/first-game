import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../../src/sim/ai/decide.ts';
import type { CityId, FactionId, TradeRouteId } from '../../src/sim/ids.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import type { TradeRoute } from '../../src/sim/state/trade-route.ts';
import { adminShareOf } from '../../src/sim/systems/economy.ts';
import { warKey } from '../../src/sim/state/war.ts';
import { tick } from '../../src/sim/tick.ts';
import * as routes from '../../src/sim/trade/routes.ts';
import { areAtWar } from '../../src/sim/wars.ts';
import { distance } from '../../src/sim/world/find-path.ts';
import { buildWorld } from '../../src/sim/world/world.ts';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    heed: { type: 'boolean', default: false },
    improve: { type: 'boolean', default: false },
  },
});
const first = Number(values.from);
const last = first + Number(values.seeds) - 1;
const years = Number(values.years);
const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const MODES = ['land', 'sea'] as const;
const IMPROVE_PAYBACK_DAYS = 3 * 365;
/** A player who puts trade first keeps only the AI's own floor of gold back. */
const TRADE_FLOOR = 600;

/** A route's gold a day at each end before administration, on the rules of whichever checkout runs this. */
const rateOf = (route: TradeRoute): number =>
  'routeRate' in routes && typeof routes.routeRate === 'function'
    ? (routes.routeRate as (r: TradeRoute) => number)(route)
    : route.daily;
const improveCost = (route: TradeRoute): number | undefined =>
  'improvementCost' in routes && typeof routes.improvementCost === 'function'
    ? (routes.improvementCost as (r: TradeRoute) => number)(route)
    : undefined;

console.log(
  `Cautious Rome, ${years} years, seeds ${first} to ${last}. Every faction plays the AI, Rome included, except Rome's trade:`,
);
console.log(
  `monthly, before any other spending and keeping ${TRADE_FLOOR} gold, Rome opens its best route by return per gold${values.heed ? ', skipping a partner at war or a besieged end, and declaring no war on a partner whose routes have not repaid' : ''}${values.improve ? `; with no route to open it improves the route whose step repays soonest, if within ${IMPROVE_PAYBACK_DAYS} days` : ''}.`,
);
console.log(
  'Lost gold is what Rome paid to open or improve routes that closed or left its hands before their receipts repaid it, less those receipts, valued at arrival prices: a full treasury may have kept less.\n',
);
console.log(
  '| seed | routes opened | closed early | gold lost | decisions | median days between | day-1 paybacks min / median / max years |',
);
console.log('| ---: | ---: | ---: | ---: | ---: | ---: | --- |');
const totals = { opened: 0, early: 0, lost: 0, decisions: 0 };
const gaps: number[] = [];
const lostBy = new Map<string, number>();
const spreads: number[][] = [];
for (let seed = first; seed <= last; seed++) {
  const row = play(seed);
  totals.opened += row.opened;
  totals.early += row.early;
  totals.lost += row.lost;
  totals.decisions += row.days.length;
  const between = row.days.slice(1).map((day, i) => day - (row.days[i] ?? day));
  gaps.push(...between);
  spreads.push(row.paybacks);
  const [min, mid, max] = summary(row.paybacks);
  console.log(
    `| ${seed} | ${row.opened} | ${row.early} | ${Math.round(row.lost)} | ${row.days.length} | ${median(between)} | ${min} / ${mid} / ${max} |`,
  );
}
const all = summary(spreads.flat());
console.log(
  `| all | ${totals.opened} | ${totals.early} | ${Math.round(totals.lost)} | ${totals.decisions} | ${median(gaps)} | ${all.join(' / ')} |`,
);

function play(seed: number) {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const paybacks = quotes(state, false).map((q) => q.paybackDays / 365);
  const ledger = new Map<TradeRouteId, { paid: number; received: number; deliveries: number }>();
  const days: number[] = [];
  let opened = 0;
  let early = 0;
  let lost = 0;
  for (let day = 0; day < years * 365; day++) {
    const ai = decideAll(state, world, []);
    const owing = (faction: FactionId) =>
      [...ledger].some(([id, entry]) => {
        const route = state.tradeRoutes[id];
        const other = route?.owner === rome ? route.partner : route?.owner;
        return other === faction && entry.received < entry.paid;
      });
    const orders: Order[] = ai.filter(
      (o) =>
        o.faction !== rome ||
        (!['openTrade', 'acceptTrade', 'closeTrade', 'improveTrade'].includes(o.kind) &&
          !(values.heed && o.kind === 'declareWar' && owing(o.against))),
    );
    const mine = tradeOrders(
      state,
      ai.filter((o) => o.faction === rome),
    );
    orders.unshift(...mine);
    const before = new Set(Object.keys(state.tradeRoutes));
    const { state: next, rejected, events } = tick(state, orders, world);
    const causes = new Map<string, string>();
    for (const event of events) {
      if (event.kind !== 'tradeClosed') continue;
      const other = event.owners.find((owner) => owner !== rome);
      const war = other && next.wars[warKey(rome, other)];
      const was = state.tradeRoutes[event.route];
      const changedHands =
        was && (was.owner !== event.owners[0] || was.partner !== event.owners[1]);
      causes.set(
        event.route,
        event.cause === 'war between the partners' && changedHands
          ? 'a city fell to an enemy of its partner'
          : event.cause === 'war between the partners' && war
            ? war.declaredBy === rome
              ? 'Rome declared war on the partner'
              : 'the partner declared war on Rome'
            : (event.cause ?? 'closed'),
      );
    }
    const accepted = mine.filter((o) => !rejected.some((r) => r.order === o));
    if (accepted.length) days.push(day);
    for (const order of accepted) {
      if (order.kind === 'acceptTrade' && next.tradeRoutes[order.route]?.status === 'running')
        ledger.set(order.route, { paid: 0, received: 0, deliveries: 0 });
      const entry = order.kind === 'improveTrade' ? ledger.get(order.route) : undefined;
      const route = order.kind === 'improveTrade' ? state.tradeRoutes[order.route] : undefined;
      const cost = route && improveCost(route);
      if (entry && cost) entry.paid += cost;
    }
    for (const route of Object.values(next.tradeRoutes)) {
      if (before.has(route.id) || route.owner !== rome || route.status !== 'running') continue;
      if (accepted.some((o) => o.kind === 'openTrade')) {
        ledger.set(route.id, { paid: route.cost, received: 0, deliveries: 0 });
        opened++;
      }
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
          rateOf(route) *
          route.days *
          adminShareOf(next, rome) *
          ends;
        entry.deliveries = route.deliveries;
      }
      if (!route || (route.owner !== rome && route.partner !== rome)) {
        if (entry.received < entry.paid) {
          early++;
          lost += entry.paid - entry.received;
          const cause = route
            ? 'Rome lost its city'
            : accepted.some((o) => o.kind === 'closeTrade' && o.route === id)
              ? 'Rome replaced it'
              : (causes.get(id) ?? 'closed');
          lostBy.set(cause, (lostBy.get(cause) ?? 0) + entry.paid - entry.received);
        }
        ledger.delete(id);
      }
    }
    state = next;
    if (state.factions[rome]?.defeatedOn !== null) break;
  }
  return { paybacks, days, opened, early, lost };
}

/** Rome's trade for the day: invitations at once, and one opening or replacement on its monthly day. */
function tradeOrders(state: GameState, ai: readonly Order[]): Order[] {
  const invitation = Object.values(state.tradeRoutes).find(
    (r) => r.status === 'offered' && r.partner === rome,
  );
  if (invitation) {
    const from = state.cities[invitation.from];
    const to = state.cities[invitation.to];
    const accept =
      ai.some((o) => o.kind === 'acceptTrade') &&
      !(from && to && values.heed && risky(state, from.id, to.id));
    return [{ kind: accept ? 'acceptTrade' : 'closeTrade', faction: rome, route: invitation.id }];
  }
  if (state.day % 30 !== 0 || ai.some((o) => o.kind === 'declareWar')) return [];
  const budget = (state.factions[rome]?.stores.gold ?? 0) - TRADE_FLOOR;
  const best = quotes(state, values.heed).filter((q) => q.cost <= budget)[0];
  if (best) return [best.order];
  if (!values.improve) return [];
  return improvement(state, budget);
}

function improvement(state: GameState, budget: number): Order[] {
  const share = adminShareOf(state, rome);
  let pick: { order: Order; days: number } | undefined;
  for (const route of Object.values(state.tradeRoutes)) {
    const cost = improveCost(route);
    if (route.status !== 'running' || cost === undefined || cost > budget) continue;
    if (route.owner !== rome && route.partner !== rome) continue;
    if ('improvedBy' in route && (route.improvedBy as readonly unknown[]).length >= 2) continue;
    const ends = Number(route.owner === rome) + Number(route.partner === rome);
    const days = cost / (route.daily * 0.25 * ends * share);
    if (days <= IMPROVE_PAYBACK_DAYS && (!pick || days < pick.days))
      pick = { order: { kind: 'improveTrade', faction: rome, route: route.id } as Order, days };
  }
  return pick ? [pick.order] : [];
}

/** Every route Rome could open now, best return per gold first, ignoring gold. */
function quotes(state: GameState, heed: boolean, only?: CityId) {
  const found: {
    order: Order & { kind: 'openTrade' };
    to: CityId;
    cost: number;
    income: number;
    paybackDays: number;
  }[] = [];
  for (const from of Object.values(state.cities)) {
    if (from.owner !== rome || (only && from.id !== only)) continue;
    for (const to of Object.values(state.cities)) {
      if (to.id === from.id || distance(from.position, to.position) > routes.TRADE_RANGE.sea)
        continue;
      if (heed && risky(state, from.id, to.id)) continue;
      for (const mode of MODES) {
        if (routes.tradeProblem(state, world, rome, from.id, to.id, mode, false)) continue;
        const f = routes.tradeForecast(state, world, from, to, mode);
        if (!f) continue;
        const income = f.fromDaily + (to.owner === rome ? f.toDaily : 0);
        found.push({
          order: { kind: 'openTrade', faction: rome, from: from.id, to: to.id, mode },
          to: to.id,
          cost: f.cost,
          income,
          paybackDays: f.paybackDays,
        });
      }
    }
  }
  return found.sort((a, b) => b.income / b.cost - a.income / a.cost || b.income - a.income);
}

/** What the quote warns of: the partner's owner at war, or either end besieged. */
function risky(state: GameState, from: CityId, to: CityId): boolean {
  const partner = state.cities[to];
  if (!partner) return true;
  const atWar = Object.values(state.factions).some(
    (f) => f.id !== partner.owner && areAtWar(state, partner.owner, f.id),
  );
  const besieged = Object.values(state.sieges).some((s) => s.city === from || s.city === to);
  return atWar || besieged;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor(sorted.length / 2)] ?? 0) : 0;
}

function summary(paybacks: number[]): string[] {
  const sorted = [...paybacks].sort((a, b) => a - b);
  if (!sorted.length) return ['-', '-', '-'];
  return [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted.at(-1)].map((v) =>
    (v ?? 0).toFixed(2),
  );
}

console.log('\n| gold lost, by what closed the route | gold |');
console.log('| --- | ---: |');
for (const [cause, gold] of [...lostBy].sort((a, b) => b[1] - a[1]))
  console.log(`| ${cause} | ${Math.round(gold)} |`);
