import { describe, expect, test } from 'vitest';
import { bestTrade, trading } from '../ai/trade.ts';
import { tradeReserve } from '../ai/budget.ts';
import { decideAll, decideOrders } from '../ai/decide.ts';
import { changeCityOwner } from '../cities.ts';
import { makePeace } from '../peace/make-peace.ts';
import { recordEvents } from '../events.ts';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../fixture.ts';
import { newGame } from '../new-game.ts';
import type { CityId, ProvinceId } from '../ids.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
import { allocateId } from '../ids.ts';
import { expectConsistent } from '../references.ts';
import { loadGame, saveGame } from '../save.ts';
import type { Day } from '../state/day.ts';
import { newWar, warKey } from '../state/war.ts';
import { dailyBalances, economy, limitsOf } from '../systems/economy.ts';
import { trade } from '../systems/trade.ts';
import { tick } from '../tick.ts';
import { openTrade, acceptTrade, closeTrade } from './orders.ts';
import { freeSlots, routePoint, routeSlots, tradeForecast, tradeIncome } from './routes.ts';

const world = fixtureWorld();
const order = {
  kind: 'openTrade',
  faction: f.rome,
  from: f.roma,
  to: f.capua,
  mode: 'land',
} as const;
function opened() {
  const state = buildFixture();
  expect(openTrade(state, order, world)).toBeUndefined();
  const route = Object.values(state.tradeRoutes)[0];
  if (!route) throw new Error('expected a route');
  return { state, route };
}

describe('trade goods and forecasts', () => {
  test('goods are reproducible, vary with seed, and each homeland lacks goods on all twenty seeds', () => {
    const worlds = Array.from({ length: 20 }, (_, i) =>
      newGame(world.map, { seed: i + 1, player: 'rome' }),
    );
    expect(worlds[0]).toEqual(newGame(world.map, { seed: 1, player: 'rome' }));
    expect(Object.values(worlds[0]?.provinces ?? {}).map((p) => p.good)).not.toEqual(
      Object.values(worlds[1]?.provinces ?? {}).map((p) => p.good),
    );
    for (const state of worlds) {
      for (const faction of Object.values(state.factions).filter((r) => r.kind === 'greatPower')) {
        const goods = Object.values(state.cities)
          .filter((c) => c.owner === faction.id)
          .map((c) => state.provinces[c.province]?.good);
        expect(new Set(goods).size).toBeLessThan(5);
      }
      expectConsistent(state);
    }
  });

  test('unlike goods earn more, distance earns more, and suitable domestic and foreign routes repay in one to three years', () => {
    const state = buildFixture();
    const from = state.cities[f.roma];
    const to = state.cities[f.capua];
    if (!from || !to) throw new Error('missing fixture cities');
    const different = tradeForecast(state, world, from, to, 'land');
    if (!different) throw new Error('missing land forecast');
    const province = state.provinces[f.campania];
    if (!province) throw new Error('missing province');
    province.good = 'grain';
    const same = tradeForecast(state, world, from, to, 'land');
    expect(different.daily).toBeCloseTo((same?.daily ?? 0) * 1.8);
    expect(different.paybackDays / 365).toBeGreaterThanOrEqual(1 - 0.1);
    expect(different.paybackDays / 365).toBeLessThan(3);
    expectConsistent(state);
  });

  test('city size, a Forum, and a real port each add a scarce slot', () => {
    const state = buildFixture();
    const city = state.cities[f.roma];
    if (!city) throw new Error('missing city');
    expect(routeSlots(city, world)).toBe(3);
    city.population = 10000;
    expect(routeSlots(city, world)).toBe(2);
    city.buildings.push('forum');
    expect(routeSlots(city, world)).toBe(3);
    expectConsistent(state);
  });
});

describe('trade orders and consent', () => {
  test('opening pays once and consumes a slot at each end; closing gives no refund', () => {
    const { state, route } = opened();
    expect(state.factions[f.rome]?.stores.gold).toBe(5000 - route.cost);
    expect(
      freeSlots(
        state,
        state.cities[f.roma] ??
          (() => {
            throw new Error('missing city');
          })(),
        world,
      ),
    ).toBe(2);
    const gold = state.factions[f.rome]?.stores.gold;
    expect(
      closeTrade(state, { kind: 'closeTrade', faction: f.rome, route: route.id }),
    ).toBeUndefined();
    expect(state.factions[f.rome]?.stores.gold).toBe(gold);
    expectConsistent(state);
  });

  test.each(['ownership', 'self', 'gold', 'war', 'unrest', 'duplicate', 'path', 'slots'] as const)(
    'refuses %s without writing anything',
    (problem) => {
      const state = buildFixture();
      let candidate: Order = { ...order };
      if (problem === 'ownership') candidate = { ...order, faction: f.carthage };
      if (problem === 'self') candidate = { ...order, to: f.roma };
      if (problem === 'gold') {
        const payer = state.factions[f.rome];
        if (payer) payer.stores.gold = 0;
      }
      if (problem === 'war') {
        candidate = { ...order, to: f.carthago, mode: 'sea' };
        state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
      }
      if (problem === 'unrest') {
        const city = state.cities[f.capua];
        if (city) city.unrestDays = 10;
      }
      if (problem === 'duplicate' || problem === 'slots') {
        expect(openTrade(state, order, world)).toBeUndefined();
        if (problem === 'duplicate') {
          const city = state.cities[f.capua];
          if (city) city.population = 40000;
        }
        if (problem === 'slots') {
          const city = state.cities[f.capua];
          if (city) city.population = 1;
          candidate = { ...order, to: f.syracusae, mode: 'sea' };
          candidate = { ...candidate, from: f.capua };
        }
      }
      if (problem === 'path') candidate = { ...order, to: f.carthago };
      const before = structuredClone(state);
      const expected = {
        ownership: 'the starting city is not yours',
        self: 'a route needs two different cities',
        gold: 'opening this route needs',
        war: 'the two ends are at war',
        unrest: 'Capua is in unrest',
        duplicate: 'these cities already trade',
        path: 'no land trade path',
        slots: 'Capua has no free route slot',
      };
      expect(executeOrder(state, candidate, world)?.reason).toContain(expected[problem]);
      expect(state).toEqual(before);
      expectConsistent(state);
    },
  );

  test('AI offers reserve neither gold nor slots and require the player to accept', () => {
    const state = buildFixture();
    const payer = state.factions[f.carthage];
    if (!payer) throw new Error('missing trader');
    payer.stores.gold = 10000;
    const foreign = {
      ...order,
      faction: f.carthage,
      from: f.carthago,
      to: f.roma,
      mode: 'sea',
    } as const;
    expect(openTrade(state, foreign, world)).toBeUndefined();
    const route = Object.values(state.tradeRoutes)[0];
    if (!route) throw new Error('missing invitation');
    expect(route.status).toBe('offered');
    expect(state.factions[f.carthage]?.stores.gold).toBe(10000);
    expect(tradeIncome(state).size).toBe(0);
    expect(
      acceptTrade(state, { kind: 'acceptTrade', faction: f.carthage, route: route.id }, world),
    ).toBeDefined();
    expect(
      acceptTrade(state, { kind: 'acceptTrade', faction: f.rome, route: route.id }, world),
    ).toBeUndefined();
    expect(state.factions[f.carthage]?.stores.gold).toBe(10000 - route.cost);
    expect(route.status).toBe('running');
    expectConsistent(state);
  });

  function invited() {
    const state = buildFixture();
    const payer = state.factions[f.carthage];
    if (!payer) throw new Error('missing trader');
    payer.stores.gold = 10000;
    expect(
      openTrade(
        state,
        {
          kind: 'openTrade',
          faction: f.carthage,
          from: f.carthago,
          to: f.roma,
          mode: 'sea',
        },
        world,
      ),
    ).toBeUndefined();
    const route = Object.values(state.tradeRoutes)[0];
    if (!route) throw new Error('missing invitation');
    return {
      state,
      payer,
      route,
      accept: { kind: 'acceptTrade', faction: f.rome, route: route.id } as const,
    };
  }

  test('refusing an invitation and closing a route each tell both ends who ended it', () => {
    const { state, route } = invited();
    const refusal = { kind: 'closeTrade', faction: f.rome, route: route.id } as const;
    expect(tick(state, [refusal], world).events).toContainEqual(
      expect.objectContaining({ kind: 'tradeClosed', cause: 'refused by Rome', invitation: true }),
    );
    const running = opened();
    const closing = { kind: 'closeTrade', faction: f.rome, route: running.route.id } as const;
    const result = tick(running.state, [closing], world);
    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: 'tradeClosed', cause: 'closed by Rome', invitation: false }),
    );
    expectConsistent(result.state);
  });

  test('an unanswered invitation expires on its ninetieth day and says so', () => {
    const { state, route } = invited();
    state.day = (route.openedOn + 89) as Day;
    expect(recordEvents(state, () => trade(state))).toEqual([]);
    state.day = (route.openedOn + 90) as Day;
    expect(recordEvents(state, () => trade(state))).toContainEqual(
      expect.objectContaining({
        kind: 'tradeClosed',
        cause: 'the invitation expired',
        invitation: true,
      }),
    );
    expect(state.tradeRoutes).toEqual({});
  });

  test('consent lapses visibly without spending if recruitment has consumed the inviter reserve', () => {
    const { state, payer, route, accept } = invited();
    const city = state.cities[f.carthago];
    if (!city) throw new Error('missing city');
    city.recruits.push({ troop: 'swordsmen', readyOn: (state.day + 10) as Day });
    payer.stores.gold = route.cost + tradeReserve(state, f.carthage) - 1;
    const gold = payer.stores.gold;
    const events = recordEvents(state, () =>
      expect(acceptTrade(state, accept, world)).toBeUndefined(),
    );
    expect(payer.stores.gold).toBe(gold);
    expect(state.tradeRoutes[route.id]).toBeUndefined();
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'tradeClosed',
        cause: 'the inviter must keep its military reserve',
      }),
    );
    expectConsistent(state);
  });

  test('AI-controlled player gives explicit consent, but a passive human gives no consent', () => {
    const { state, route, accept } = invited();
    expect(decideAll(state, world).filter((order) => order.kind === 'acceptTrade')).toEqual([]);
    expect(
      decideAll(state, world, []).filter((order) => order.kind === 'acceptTrade'),
    ).toContainEqual(accept);
    expect(state.tradeRoutes[route.id]?.status).toBe('offered');
    expectConsistent(state);
  });

  test('a strong peaceful minor does not acquire a great power war wish at acceptance', () => {
    const state = buildFixture();
    const payer = state.factions[f.syracusaeFaction];
    const army = state.armies[f.punicArmy];
    const formation = state.formations[f.citizenSpears];
    if (!payer || !army || !formation) throw new Error('missing minor fixture');
    payer.stores.gold = 100000;
    army.owner = f.syracusaeFaction;
    formation.men = 10000;
    changeCityOwner(state, f.carthago, f.rome);
    expect(
      openTrade(
        state,
        {
          kind: 'openTrade',
          faction: f.syracusaeFaction,
          from: f.syracusae,
          to: f.roma,
          mode: 'sea',
        },
        world,
      ),
    ).toBeUndefined();
    const route = Object.values(state.tradeRoutes)[0];
    if (!route) throw new Error('missing minor invitation');
    expect(decideOrders(state, world, f.syracusaeFaction)).toEqual([]);
    expect(
      acceptTrade(state, { kind: 'acceptTrade', faction: f.rome, route: route.id }, world),
    ).toBeUndefined();
    expect(state.tradeRoutes[route.id]?.status).toBe('running');
    expect(payer.stores.gold).toBe(100000 - route.cost);
    expectConsistent(state);
  });

  test.each([false, true])(
    'same-day recruitment keeps its reserve even if consent is first: %s',
    (acceptFirst) => {
      const { state, payer, route, accept } = invited();
      payer.stores.gold = route.cost + tradeReserve(state, f.carthage);
      const gold = payer.stores.gold;
      const recruit = {
        kind: 'recruit',
        faction: f.carthage,
        city: f.carthago,
        troop: 'skirmishers',
      } as const;
      const result = tick(state, acceptFirst ? [accept, recruit] : [recruit, accept], world, []);
      expect(result.state.tradeRoutes[route.id]).toBeUndefined();
      expect(result.state.factions[f.carthage]?.stores.gold).toBe(gold - 900);
      expect(result.state.cities[f.carthago]?.recruits).toHaveLength(1);
      expect(result.events).toContainEqual(
        expect.objectContaining({
          kind: 'tradeClosed',
          cause: 'the inviter must keep its military reserve',
        }),
      );
      expectConsistent(result.state);
    },
  );

  test.each([false, true])(
    'a decided war lapses consent before spending, war first: %s',
    (warFirst) => {
      const { state, payer, route, accept } = invited();
      const war = { kind: 'declareWar', faction: f.carthage, against: f.rome } as const;
      const result = tick(state, warFirst ? [war, accept] : [accept, war], world, []);
      expect(result.state.factions[f.carthage]?.stores.gold).toBe(payer.stores.gold);
      expect(result.state.tradeRoutes[route.id]).toBeUndefined();
      expect(result.events.map((e) => e.kind)).toEqual(['tradeClosed', 'warDeclared']);
      expect(result.rejected).toHaveLength(1);
      expectConsistent(result.state);
    },
  );

  test('an invalid declaration does not cancel a peaceful invitation', () => {
    const { state, route, accept } = invited();
    state.truces[warKey(f.carthage, f.rome)] = {
      since: state.day,
      endsOn: (state.day + 30) as Day,
    };
    const result = tick(
      state,
      [accept, { kind: 'declareWar', faction: f.carthage, against: f.rome }],
      world,
      [],
    );
    expect(result.state.tradeRoutes[route.id]?.status).toBe('running');
    expect(result.events.map((e) => e.kind)).toEqual(['tradeOpened']);
    expectConsistent(result.state);
  });

  test('consent does not buy a one-day route when a known truce expiry enables the inviter attack', () => {
    const { state, payer, route, accept } = invited();
    const formation = state.formations[f.citizenSpears];
    if (!formation) throw new Error('missing formation');
    formation.men = 10000;
    const minor = state.cities[f.syracusae];
    if (!minor) throw new Error('missing minor city');
    minor.owner = f.carthage;
    state.truces[warKey(f.carthage, f.rome)] = { since: state.day, endsOn: (state.day + 1) as Day };
    payer.stores.gold = 100000;
    const events = recordEvents(state, () =>
      expect(acceptTrade(state, accept, world)).toBeUndefined(),
    );
    expect(state.tradeRoutes[route.id]).toBeUndefined();
    expect(payer.stores.gold).toBe(100000);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'tradeClosed',
        cause: 'the inviter intends war when the truce ends tomorrow',
      }),
    );
    expectConsistent(state);
  });

  test('consent does not buy a one-day route when already trained reinforcements enable tomorrow attack', () => {
    const { state, payer, route, accept } = invited();
    const minor = state.cities[f.syracusae];
    const home = state.cities[f.carthago];
    if (!minor || !home) throw new Error('missing cities');
    minor.owner = f.carthage;
    payer.stores.gold = 100000;
    home.recruits.push(
      { troop: 'swordsmen', readyOn: state.day },
      { troop: 'swordsmen', readyOn: state.day },
    );
    expect(
      decideOrders(state, world, f.carthage).filter((order) => order.kind === 'declareWar'),
    ).toEqual([]);
    const result = tick(state, [accept], world);
    expect(decideOrders(result.state, world, f.carthage)).toContainEqual({
      kind: 'declareWar',
      faction: f.carthage,
      against: f.rome,
    });
    expect(result.state.tradeRoutes[route.id]).toBeUndefined();
    expect(result.events).not.toContainEqual(expect.objectContaining({ kind: 'tradeOpened' }));
    expectConsistent(result.state);
  });
});

describe('caravans, interruption, and saves', () => {
  test('a tick never changes its previous caravan, even with its immutable road frozen', () => {
    const { state, route } = opened();
    for (const point of route.path) Object.freeze(point);
    Object.freeze(route.path);
    Object.freeze(route);
    const before = saveGame(state);
    const result = tick(state, [], world);
    expect(saveGame(state)).toBe(before);
    expect(result.state.tradeRoutes[route.id]?.progress).toBeGreaterThan(0);
    expectConsistent(result.state);
  });

  test('moves along the path and pays BOTH ends only on arrival, then returns', () => {
    const { state, route } = opened();
    const gold = state.factions[f.rome]?.stores.gold ?? 0;
    const start = routePoint(route);
    for (let i = 1; i < route.days; i++) trade(state);
    expect(routePoint(route)).not.toEqual(start);
    expect(state.factions[f.rome]?.stores.gold).toBe(gold);
    trade(state);
    expect(state.factions[f.rome]?.stores.gold).toBeCloseTo(gold + 2 * route.daily * route.days);
    expect(route.returning).toBe(true);
    expect(route.deliveries).toBe(1);
    expectConsistent(state);
  });

  test('forecast counts toward income and treasury but economy does not pay it a second time', () => {
    const { state, route } = opened();
    expect(dailyBalances(state).get(f.rome)?.gold).toBeCloseTo(
      (dailyBalances(state, false).get(f.rome)?.gold ?? 0) + route.daily * 2,
    );
    const without = structuredClone(state);
    without.tradeRoutes = {};
    expect(
      (limitsOf(state).get(f.rome)?.gold ?? 0) - (limitsOf(without).get(f.rome)?.gold ?? 0),
    ).toBeCloseTo(route.daily * 2 * 240);
    economy(state);
    economy(without);
    expect(state.factions[f.rome]?.stores.gold).toBe(without.factions[f.rome]?.stores.gold);
    expectConsistent(state);
  });

  test('war closes a route without payment and tells both partners', () => {
    const state = buildFixture();
    expect(openTrade(state, { ...order, to: f.carthago, mode: 'sea' }, world)).toBeUndefined();
    const result = tick(
      state,
      [{ kind: 'declareWar', faction: f.rome, against: f.carthage }],
      world,
    );
    expect(result.state.tradeRoutes).toEqual({});
    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: 'tradeClosed', cause: 'war between the partners' }),
    );
    expectConsistent(result.state);
  });

  test('an enemy army on a road takes its cargo once, stops it, and leaving restores deliveries', () => {
    const { state, route } = opened();
    state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
    const army = state.armies[f.punicArmy];
    if (!army) throw new Error('missing army');
    army.activity = { kind: 'idle', position: routePoint(route, 0.5) };
    const gold = state.factions[f.carthage]?.stores.gold ?? 0;
    const events = recordEvents(state, () => trade(state));
    expect(route.blocked).toBe('raid');
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'tradeRaided',
        cause: 'raid',
        raider: f.carthage,
        looted: route.daily * route.days,
      }),
    );
    expect(state.factions[f.carthage]?.stores.gold).toBeCloseTo(gold + route.daily * route.days);
    expect(recordEvents(state, () => trade(state))).toEqual([]);
    army.activity.position = { x: 1000, y: 1000 };
    trade(state);
    expect(route.blocked).toBeNull();
    expect(route.progress).toBe(0);
    state.day = route.departsOn;
    trade(state);
    expect(route.progress).toBeGreaterThan(0);
    expectConsistent(state);
  });

  test('a raider beside a siege still takes the cargo, and its theft is an event of that day', () => {
    const { state, route } = opened();
    state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
    const army = state.armies[f.punicArmy];
    const carthage = state.factions[f.carthage];
    if (!army || !carthage) throw new Error('missing raider');
    const siege = allocateId(state, 'siege');
    state.sieges[siege] = { id: siege, city: f.capua, besiegers: [army.id], startedOn: state.day };
    army.activity = { kind: 'besieging', position: routePoint(route, 0.9), siege };
    const gold = carthage.stores.gold;
    const events = recordEvents(state, () => trade(state));
    expect(route.blocked).toBe('siege');
    expect(carthage.stores.gold).toBeCloseTo(gold + route.daily * route.days);
    expect(events).toEqual([
      expect.objectContaining({ kind: 'tradeRaided', cause: 'siege', route: route.id }),
      expect.objectContaining({
        kind: 'tradeRaided',
        cause: 'raid',
        route: route.id,
        raider: f.carthage,
        looted: route.daily * route.days,
      }),
    ]);
    expectConsistent(state);
  });

  test('a route outlives a change of owner while the new ends stay at peace, under its new owner', () => {
    const { state, route } = opened();
    const events = recordEvents(state, () => changeCityOwner(state, f.capua, f.carthage));
    expect(state.tradeRoutes[route.id]).toMatchObject({ owner: f.rome, partner: f.carthage });
    expect(events.filter((e) => e.kind === 'tradeClosed')).toEqual([]);
    expectConsistent(state);
  });

  test('a route at a city taken by an enemy of the other end closes that day as a war between the partners', () => {
    const { state, route } = opened();
    state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
    const events = recordEvents(state, () => {
      changeCityOwner(state, f.capua, f.carthage);
      trade(state);
    });
    expect(state.tradeRoutes[route.id]).toBeUndefined();
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'tradeClosed',
        route: route.id,
        cause: 'war between the partners',
      }),
    );
    expectConsistent(state);
  });

  test('a route at a city ceded in a peace survives under the new owner', () => {
    const { state, route } = opened();
    state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
    makePeace(state, f.rome, f.carthage, {
      kind: 'payment',
      payer: f.rome,
      gold: 0,
      cities: [f.capua],
    });
    trade(state);
    expect(state.cities[f.capua]?.owner).toBe(f.carthage);
    expect(state.tradeRoutes[route.id]).toMatchObject({ owner: f.rome, partner: f.carthage });
    expectConsistent(state);
  });

  test('an improvement in a tick leaves the day before unchanged', () => {
    const { state, route } = opened();
    need(state.factions[f.rome]).stores.gold = 10_000;
    const before = structuredClone(state);
    const next = tick(state, [{ kind: 'improveTrade', faction: f.rome, route: route.id }], world);
    expect(next.rejected).toEqual([]);
    expect(next.state.tradeRoutes[route.id]?.improvedBy).toEqual([f.rome]);
    expect(state).toEqual(before);
    expectConsistent(next.state);
  });

  test('an improvement costs half the opening price and raises both ends a quarter, twice at most', () => {
    const { state, route } = opened();
    const rome = need(state.factions[f.rome]);
    rome.stores.gold = 10_000;
    const before = tradeIncome(state).get(f.rome) ?? 0;
    const improve = { kind: 'improveTrade', faction: f.rome, route: route.id } as const;
    expect(executeOrder(state, improve, world)).toBeUndefined();
    expect(rome.stores.gold).toBe(10_000 - Math.ceil(route.cost / 2));
    expect(tradeIncome(state).get(f.rome)).toBeCloseTo(before * 1.25);
    expect(executeOrder(state, improve, world)).toBeUndefined();
    expect(executeOrder(state, improve, world)?.reason).toBe(
      'this route is improved 2 times already',
    );
    expect(tradeIncome(state).get(f.rome)).toBeCloseTo(before * 1.5);
    expectConsistent(state);
  });

  test('entering and leaving the road cannot loot a fresh cargo more often than a crossing', () => {
    const { state, route } = opened();
    state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
    const army = state.armies[f.punicArmy];
    const faction = state.factions[f.carthage];
    if (!army || !faction) throw new Error('missing raider');
    const gold = faction.stores.gold;
    const looted: number[] = [];
    for (let day = 1; day <= 5; day++) {
      state.day = day as Day;
      army.activity = {
        kind: 'idle',
        position: day % 2 ? routePoint(route, 0.5) : { x: 1000, y: 1000 },
      };
      for (const event of recordEvents(state, () => trade(state)))
        if (event.kind === 'tradeRaided' && event.cause === 'raid') looted.push(event.looted);
    }
    expect(faction.stores.gold).toBeCloseTo(gold + route.daily * route.days);
    expect(looted).toEqual([route.daily * route.days, 0, 0]);
    expect(route.progress).toBe(0);
    expect(route.deliveries).toBe(0);
    expectConsistent(state);
  });

  test('a siege stops ships at an end even though no fleet can blockade offshore yet', () => {
    const state = buildFixture();
    expect(openTrade(state, { ...order, to: f.syracusae, mode: 'sea' }, world)).toBeUndefined();
    const roman = state.armies[f.romanArmy];
    const punic = state.armies[f.punicArmy];
    const roma = state.cities[f.roma];
    const capua = state.cities[f.capua];
    if (!roman || !punic || !roma || !capua) throw new Error('missing fixture');
    roman.activity = { kind: 'idle', position: { ...capua.position } };
    punic.activity = { kind: 'idle', position: { ...roma.position } };
    const result = tick(
      state,
      [{ kind: 'declareWar', faction: f.rome, against: f.carthage }],
      world,
    );
    expect(Object.values(result.state.tradeRoutes)[0]).toMatchObject({
      blocked: 'siege',
      progress: 0,
      deliveries: 0,
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: 'tradeRaided', cause: 'siege' }),
    );
    expectConsistent(result.state);
  });

  test('trade shares the administrative penalty of a large realm, in forecasts and actual receipts', () => {
    const { state, route } = opened();
    const city = state.cities[f.capua];
    if (!city) throw new Error('missing city');
    for (let i = 0; i < 8; i++) {
      const id = `test-city-${i}` as CityId;
      const province = `test-province-${i}` as ProvinceId;
      state.cities[id] = { ...city, id, province };
      state.provinces[province] = { id: province, city: id, name: 'Test', good: 'grain' };
    }
    const income = tradeIncome(state).get(f.rome) ?? 0;
    expect(income).toBeLessThan(route.daily * 2);
    const gold = state.factions[f.rome]?.stores.gold ?? 0;
    for (let i = 0; i < route.days; i++) trade(state);
    expect(state.factions[f.rome]?.stores.gold).toBeCloseTo(gold + income * route.days);
    expectConsistent(state);
  });

  test('saves preserve goods, invitation consent and the caravan position', () => {
    const { state, route } = opened();
    trade(state);
    expect(loadGame(saveGame(state))).toEqual({ ok: true, state });
    const broken = structuredClone(state);
    const r = broken.tradeRoutes[route.id];
    if (r) r.km += 100;
    expect(loadGame(saveGame(broken))).toMatchObject({ ok: false });
    expectConsistent(state);
  });

  test.each(['openedBy', 'improvedBy', 'receipts'] as const)(
    'loading refuses a route whose %s names a faction that does not exist',
    (field) => {
      const { state, route } = opened();
      const broken = structuredClone(state);
      const r = broken.tradeRoutes[route.id];
      if (!r) throw new Error('missing route');
      const ghost = 'ghost' as typeof f.rome;
      if (field === 'openedBy') r.openedBy = ghost;
      if (field === 'improvedBy') r.improvedBy = [ghost];
      if (field === 'receipts') r.receipts = { [ghost]: 10 };
      expect(loadGame(saveGame(broken))).toMatchObject({ ok: false });
      expectConsistent(state);
    },
  );

  test.each([f.carthage, f.syracusaeFaction])(
    '%s trades deterministically without a random draw',
    (faction) => {
      const state = buildFixture();
      const trader = state.factions[faction];
      if (!trader) throw new Error('missing trader');
      trader.stores.gold = 10000;
      expect(bestTrade(state, world, f.rome)).toEqual(
        bestTrade(structuredClone(state), world, f.rome),
      );
      const before = structuredClone(state);
      state.day = (30 + Object.keys(state.factions).sort().indexOf(faction)) as Day;
      const orders = trading(state, world, faction);
      expect(orders).toHaveLength(1);
      for (const o of orders) expect(executeOrder(state, o, world)).toBeUndefined();
      expect(state.rng).toEqual(before.rng);
      expectConsistent(state);
    },
  );

  test('AI keeps its reserve and still buys the best route at the exact affordable boundary', () => {
    const state = buildFixture();
    const payer = state.factions[f.rome];
    if (!payer) throw new Error('missing trader');
    const reserve = 1500;
    payer.stores.gold = 10000;
    const choice = bestTrade(state, world, f.rome, reserve);
    if (!choice || choice.kind !== 'openTrade') throw new Error('missing affordable route');
    const from = state.cities[choice.from];
    const to = state.cities[choice.to];
    if (!from || !to) throw new Error('missing route ends');
    const forecast = tradeForecast(state, world, from, to, choice.mode);
    if (!forecast) throw new Error('missing forecast');
    payer.stores.gold = reserve + forecast.cost;
    expect(bestTrade(state, world, f.rome, reserve)).toEqual(choice);
    payer.stores.gold = reserve;
    expect(bestTrade(state, world, f.rome, reserve)).toBeUndefined();
    expectConsistent(state);
  });
});

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing trade fixture record');
  return value;
}
