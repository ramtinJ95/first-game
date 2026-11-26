import { BUILD_PAYBACK_YEARS, buildingWorth } from '../src/sim/ai/build.ts';
import { reserveOf, sorted } from '../src/sim/ai/situation.ts';
import { buildRefusal } from '../src/sim/buildings/build.ts';
import { BUILDING_KINDS, BUILDINGS, type BuildingKind } from '../src/sim/buildings/buildings.ts';
import { readFileSync } from 'node:fs';
import { decideAll } from '../src/sim/ai/decide.ts';
import type { CityId, FactionId, TradeRouteId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import { executeOrder, type Order } from '../src/sim/orders/orders.ts';
import type { DayEvent } from '../src/sim/events.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { adminShareOf } from '../src/sim/systems/economy.ts';
import { tick } from '../src/sim/tick.ts';
import * as routes from '../src/sim/trade/routes.ts';
import { areAtWar } from '../src/sim/wars.ts';
import { distance } from '../src/sim/world/find-path.ts';
import { buildWorld, type World } from '../src/sim/world/world.ts';
import { menDesertIfRaised, threatNewsOfDay } from '../src/app/threat-news.ts';
import { GUARD_GOLD, guardRefusal, hireGuards } from '../src/sim/guards.ts';
import { warReadiness } from '../src/sim/ai/war.ts';
import { THREAT_WARN } from '../src/app/threat-news.ts';

/** The `warned` guards play hires until no great power stands at this share of what it needs. */
const THREAT_CLEAR = 0.6;
import { WAR_REACH_KM } from '../src/sim/ai/thresholds.ts';
import { limitsOf } from '../src/sim/systems/economy.ts';
import { homeCapital } from '../src/sim/ai/situation.ts';
import { NOTICE_DAYS, NOTICE_SHARE } from '../src/sim/ai/thresholds.ts';
import { TROOPS, type Troop } from '../src/sim/troops.ts';
import { peaceAnswer, peaceWish, warDamage } from '../src/sim/ai/peace.ts';
import { GOLD_STEP, OFFER_GAP_DAYS } from '../src/sim/ai/thresholds.ts';
import { standingOffer } from '../src/sim/peace/offer.ts';
import { warStanding } from '../src/sim/peace/standing.ts';
import { AS_THINGS_STAND, GOLD_PER_POINT } from '../src/sim/peace/terms.ts';
import type { PeaceTerms } from '../src/sim/state/peace.ts';
import { warKey } from '../src/sim/state/war.ts';

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
  until: 'calm' | 'full' | 'three' | 'enough';
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
 * it declares, and none at peace. `enough` answers a warning as it advises: the day after it
 * names a city, it hires there until no great power stands at NOTICE_SHARE of what it needs
 * there, with all the gold it has, since war is what it buys off.
 */
export type GuardPlay = 'never' | 'monthly' | 'every' | 'warned' | 'war' | 'enough';

export interface CautiousDay {
  before: GameState;
  after: GameState;
  events: readonly DayEvent[];
  /** Rome's orders the rules took today, its trade and the AI's spending for it alike. */
  accepted: readonly Order[];
  /** Of those, the orders it gave in answer to a warning or a war: the troop and the guards. */
  answered: readonly Order[];
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
  {
    peaceful = false,
    guards = 'never',
    answer = false,
    follows = false,
    climbs = true,
    fights = false,
    builds,
    drops = [],
    forbid = [],
    start,
    orders: rule = (orders) => orders,
  }: {
    peaceful?: boolean;
    guards?: GuardPlay;
    answer?: boolean;
    /**
     * Whether the answer follows the advice it is given: no answer to a line that advises
     * nothing, as a warning that ran the game on; no troop when the line says the men in training
     * will come, or names a band of guards; and no troop that the realm's food cannot feed, as
     * the recruit card reckons it, so the guards alone answer. False answers every line with
     * the cheapest troop it can afford, as the answering Romes did before.
     */
    follows?: boolean;
    /** Whether a power that climbs THREAT_SPARE_RISE points above its last stop stops the game again (`threatNewsOfDay`); false plays the rule before it. */
    climbs?: boolean;
    /**
     * Whether Rome fights back once at war: the answer to a warning no longer holds its
     * armies at the city it named, so the AI's own war moves stand, which meet an enemy army
     * idle in the field at ATTACK_ODDS and relieve a besieged city at RELIEF_ODDS; and in a
     * war it is losing (`warDamage`), it offers peace on the least the enemy would take
     * (`peaceWhenLosing`). False holds its armies through a war as before.
     */
    fights?: boolean;
    /** Rome's building orders for the day, in place of the AI's. */
    builds?: (state: GameState) => Order[];
    /** Kinds of Rome's AI orders it does not give, such as `recruit` for a ruler who raises men only to answer a warning. */
    drops?: readonly Order['kind'][];
    /** Buildings Rome's AI does not order, such as every second level and great work for a ruler who builds first levels only. */
    forbid?: readonly BuildingKind[];
    /** The game to play from, in place of a new game of the seed. */
    start?: GameState;
    /** Rewrites the day's orders before the tick, to try another rule for Rome. */
    orders?: (orders: Order[], state: GameState) => Order[];
  } = {},
): GameState {
  const told = new Set<string>();
  let answering: { city: CityId; until: number; raise: boolean } | undefined;
  let warnedAt: CityId | undefined;
  const named = new Set<CityId>();
  let threatened: Threat[] = [];
  let state: GameState = start ?? newGame(map, { seed, player: 'rome' });
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
        !(o.faction === rome && ((builds && o.kind === 'build') || drops.includes(o.kind))) &&
        !(o.faction === rome && o.kind === 'build' && forbid.includes(o.building)) &&
        (o.faction !== rome ||
          !['openTrade', 'acceptTrade', 'closeTrade', 'improveTrade'].includes(o.kind)),
    );
    const trade = tradeOrders(
      state,
      ai.filter((o) => o.faction === rome && !held(o)),
    );
    if (answering && state.day >= answering.until) answering = undefined;
    const enemies = fights ? enemiesOf(state) : [];
    const fighting = enemies.length > 0;
    const answers = (
      answering ? answerOrders(state, answering.city, answering.raise, follows) : []
    ).filter((order) => !fighting || !MOVES.has(order.kind));
    if (answering) answering.raise = false;
    // The reader plans its hires on the day as the answer and the trade before them leave it.
    const earlier = [...answers, ...trade];
    const hires =
      guards === 'monthly' && trade.length === 0
        ? guardOrders(state, warnedAt)
        : guards === 'every' && state.day % GUARD_CHECK_DAYS === 0
          ? hiresAt(state, [...named].reverse(), guardFloor(state))
          : guards === 'war' || guards === 'enough'
            ? readerHires(state, threatened, earlier)
            : guards === 'warned'
              ? readerHires(
                  state,
                  [...threatened, ...(state.day % GUARD_CHECK_DAYS === 0 ? nearWar(state) : [])],
                  earlier,
                )
              : [];
    threatened = [];
    orders.unshift(...trade, ...hires, ...(builds?.(state) ?? []));
    if (answering && !fighting) {
      // Every army of Rome is held at the warned city, so no order of the AI moves one away.
      for (let i = orders.length - 1; i >= 0; i--) {
        const order = orders[i];
        if (order && order.faction === rome && MOVES.has(order.kind)) orders.splice(i, 1);
      }
    }
    orders.unshift(...answers);
    const offer = enemies.map((enemy) => peaceWhenLosing(state, enemy)).find((o) => o);
    if (offer) {
      // One offer a war a day: Rome's own, in place of any the AI would make for it.
      const ai = orders.findIndex(
        (o) => o.faction === rome && o.kind === 'offerPeace' && o.to === offer.to,
      );
      if (ai >= 0) orders.splice(ai, 1);
      orders.unshift(offer);
    }
    const before = new Set(Object.keys(state.tradeRoutes));
    const played = rule(orders, state);
    const { state: next, rejected, events } = tick(state, played, world);
    const accepted = played.filter(
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
    for (const alert of threatNewsOfDay(state, next, world, told, undefined, true, climbs)) {
      // The end of a war that held a power back advises nothing; a climb it brings stops the game itself.
      if (alert.kind === 'heldWarEnded') continue;
      // A warning that ran the game on names nothing new to do.
      if (follows && alert.kind === 'warThreat' && !alert.pause) continue;
      const at = alert.focus?.at;
      warnedAt = Object.values(next.cities).find(
        (city) => at && city.owner === rome && city.position.x === at.x && city.position.y === at.y,
      )?.id;
      if (answer)
        answering = {
          city: warnedAt ?? homeCapital(next, world, rome)?.id ?? ('roma' as CityId),
          until: next.day + NOTICE_DAYS,
          raise:
            !follows ||
            (alert.kind === 'warThreat' && !/ in training muster (on|by) /.test(alert.text)),
        };
      if (warnedAt) {
        named.delete(warnedAt);
        named.add(warnedAt);
        if (guards === 'warned') threatened.push({ city: warnedAt, until: 'calm' });
        if (guards === 'enough') threatened.push({ city: warnedAt, until: 'enough' });
      }
    }
    for (const event of events) {
      if (event.kind !== 'warDeclared' || event.against !== rome) continue;
      if (next.factions[event.by]?.kind !== 'greatPower') continue;
      const reach = inReach(next, event.by);
      if (guards === 'war' && reach[0]) threatened.push({ city: reach[0], until: 'three' });
      if (guards === 'warned') for (const city of reach) threatened.push({ city, until: 'full' });
    }
    const given = new Set<Order>([...answers, ...hires]);
    onDay({
      before: state,
      after: next,
      events,
      accepted,
      answered: accepted.filter((order) => given.has(order)),
    });
    state = next;
    if (state.factions[rome]?.defeatedOn !== null) break;
  }
  return state;
}

/**
 * The building that pays back soonest in the city, within BUILD_PAYBACK_YEARS, among those
 * it could start with `gold`: what the panel puts first and the news names.
 */
export function suggested(
  state: GameState,
  city: GameState['cities'][CityId] | undefined,
  gold: number,
) {
  let best: { kind: BuildingKind; payback: number } | undefined;
  if (!city || city.construction) return undefined;
  for (const kind of BUILDING_KINDS) {
    if (BUILDINGS[kind].gold > gold || buildRefusal(state, city, kind)) continue;
    const worth = buildingWorth(state, city, kind);
    const payback = worth > 0 ? BUILDINGS[kind].gold / worth / 365 : Infinity;
    if (payback <= BUILD_PAYBACK_YEARS && (!best || payback < best.payback))
      best = { kind, payback };
  }
  return best;
}

/**
 * The player who builds as the panel suggests: in each of Rome's cities with nothing at
 * work, the building that repays soonest, while the gold after it stays above the AI's
 * reserve for Rome's men.
 */
export function panelBuilds(state: GameState): Order[] {
  let gold = (state.factions[rome]?.stores.gold ?? 0) - reserveOf(state, rome, 'gold');
  const orders: Order[] = [];
  for (const city of sorted(state.cities)) {
    if (city.owner !== rome) continue;
    const best = suggested(state, state.cities[city.id], gold);
    if (!best) continue;
    gold -= BUILDINGS[best.kind].gold;
    orders.push({ kind: 'build', faction: rome, city: city.id, building: best.kind });
  }
  return orders;
}

/** The powers a warning names: one, or several in a line that folds one day's warnings. */
export function warnedPowers(text: string): string[] {
  const told = text.replace(/^The [\d,]+ guards at .+? no longer count\. /, '');
  return (told.split(/ could soon| still stands near war| has climbed to/)[0] ?? '').split(
    /, | and /,
  );
}

/** The orders that move an army, which an answering Rome gives only its own way. */
const MOVES = new Set<Order['kind']>(['moveArmy', 'halt', 'embark', 'retreat']);

/** The factions at war with Rome, by id. */
function enemiesOf(state: GameState): FactionId[] {
  return Object.keys(state.factions)
    .sort()
    .filter((id) => id !== rome && areAtWar(state, id as FactionId, rome)) as FactionId[];
}

/**
 * Rome's offer of peace in a war it is losing by `warDamage`, as the AI reckons a loss: peace
 * as things stand when the enemy would take it, else the least gold it would take, in steps of
 * GOLD_STEP, up to what Rome has, and never a city. None while an offer waits, within
 * OFFER_GAP_DAYS of the last, or before the enemy talks of peace.
 */
function peaceWhenLosing(
  state: GameState,
  enemy: FactionId,
): Extract<Order, { kind: 'offerPeace' }> | undefined {
  const war = state.wars[warKey(rome, enemy)];
  if (!war || standingOffer(state, rome, enemy)) return undefined;
  if (war.offeredOn !== null && state.day - war.offeredOn < OFFER_GAP_DAYS) return undefined;
  const standing = warStanding(state, rome, enemy);
  if (!standing || !warDamage(state, standing).losing) return undefined;
  const wish = peaceWish(state, enemy, rome);
  if (!wish || wish.talksFrom !== undefined) return undefined;
  const purse = Math.floor((state.factions[rome]?.stores.gold ?? 0) / GOLD_STEP) * GOLD_STEP;
  const least = Math.max(0, Math.ceil((-wish.wish * GOLD_PER_POINT) / GOLD_STEP) * GOLD_STEP);
  // The enemy's wish already prices every reason; the steps above it only meet its rounding.
  for (let gold = least; gold <= Math.min(purse, least + 10 * GOLD_STEP); gold += GOLD_STEP) {
    const terms: PeaceTerms =
      gold === 0 ? AS_THINGS_STAND : { kind: 'payment', payer: rome, gold, cities: [] };
    if (peaceAnswer(state, enemy, rome, terms)?.accepts)
      return { kind: 'offerPeace', faction: rome, to: enemy, terms };
  }
  return undefined;
}

/**
 * A Rome that answers a warning as it advises: on the day it comes, it raises the cheapest
 * troop it can afford at its capital, and for the notice's days it holds every army of its
 * own that is not in a battle or a siege at the city the warning names.
 */
function answerOrders(state: GameState, city: CityId, raise: boolean, fed = false): Order[] {
  const orders: Order[] = [];
  const at = state.cities[city];
  if (!at || at.owner !== rome) return orders;
  const stores = state.factions[rome]?.stores;
  const capital = homeCapital(state, world, rome);
  if (raise && stores && capital) {
    const troop = (Object.keys(TROOPS) as Troop[])
      .sort((a, b) => TROOPS[a].recruit.gold - TROOPS[b].recruit.gold)
      .find(
        (t) => TROOPS[t].recruit.gold <= stores.gold && TROOPS[t].recruit.men <= stores.manpower,
      );
    if (troop && !(fed && menDesertIfRaised(state, world, troop, capital.id)))
      orders.push({ kind: 'recruit', faction: rome, city: capital.id, troop });
  }
  for (const army of Object.values(state.armies)) {
    if (army.owner !== rome) continue;
    const { activity } = army;
    if (activity.kind !== 'idle' && activity.kind !== 'marching') continue;
    const here = activity.kind === 'idle' ? activity.position : undefined;
    if (here && distance(here, at.position) <= 5) continue;
    const bound = activity.kind === 'marching' ? activity.waypoints.at(-1) : undefined;
    if (bound && distance(bound, at.position) <= 5) continue;
    orders.push({ kind: 'moveArmy', faction: rome, army: army.id, to: { ...at.position } });
  }
  return orders;
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
    if (!city || !stores || stores.gold - GUARD_GOLD < floor || hireGuards(hired, order)) continue;
    orders.push(order);
  }
  return orders;
}

/** The gold Rome keeps back from guards at peace, so its army is still paid for: a quarter of its limit. */
function guardFloor(state: GameState): number {
  return (limitsOf(state).get(rome)?.gold ?? 0) / 4;
}

/** The reader's hires, each band weighed on a copy of the day as the warning would weigh it. */
function readerHires(
  state: GameState,
  threats: readonly Threat[],
  earlier: readonly Order[] = [],
): Order[] {
  if (threats.length === 0) return [];
  const hired = structuredClone(state);
  for (const order of earlier) executeOrder(hired, order, world);
  const orders: Order[] = [];
  const powers = Object.values(hired.factions).filter(
    (f) => f.kind === 'greatPower' && f.id !== rome && f.defeatedOn === null,
  );
  // A power that weighs only field armies is not held back by guards, as its warning says.
  const calm = (id: CityId, below: number, passPressed: boolean) =>
    powers.every((p) => {
      const threat = warReadiness(hired, world, p.id, rome);
      return (
        !threat ||
        threat.front !== id ||
        threat.readiness < below ||
        (passPressed && threat.pressed)
      );
    });
  const floor = guardFloor(state);
  for (const { city: id, until } of threats) {
    for (;;) {
      const city = hired.cities[id];
      const stores = hired.factions[rome]?.stores;
      if (!city || !stores || guardRefusal(hired, city, rome)) break;
      if (until === 'calm' && stores.gold - GUARD_GOLD < floor) break;
      if (until === 'calm' && calm(id, THREAT_CLEAR, false)) break;
      if (until === 'enough' && calm(id, NOTICE_SHARE, true)) break;
      if (
        until === 'three' &&
        orders.filter((o) => o.kind === 'hireGuards' && o.city === id).length >= 3
      )
        break;
      const order: Order = { kind: 'hireGuards', faction: rome, city: id };
      // The rules' own handler, so a band that takes the place of one no longer counted is weighed as the rules weigh it.
      if (hireGuards(hired, order)) break;
      orders.push(order);
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
