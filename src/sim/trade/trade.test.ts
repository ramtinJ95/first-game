import { describe, expect, test } from 'vitest';
import { bestTrade, trading } from '../ai/trade.ts';
import { changeCityOwner } from '../cities.ts';
import { recordEvents } from '../events.ts';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../fixture.ts';
import { newGame } from '../new-game.ts';
import type { CityId, ProvinceId } from '../ids.ts';
import { executeOrder, type Order } from '../orders/orders.ts';
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
    expect(state.factions[f.carthage]?.stores.gold).toBe(3000);
    expect(tradeIncome(state).size).toBe(0);
    expect(
      acceptTrade(state, { kind: 'acceptTrade', faction: f.carthage, route: route.id }, world),
    ).toBeDefined();
    expect(
      acceptTrade(state, { kind: 'acceptTrade', faction: f.rome, route: route.id }, world),
    ).toBeUndefined();
    expect(state.factions[f.carthage]?.stores.gold).toBe(3000 - route.cost);
    expect(route.status).toBe('running');
    expectConsistent(state);
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
    expect(route.raid).toEqual({ on: state.day, position: army.activity.position });
    expect(loadGame(saveGame(state))).toEqual({ ok: true, state });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'tradeRaided' }));
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

  test('a captured city closes its routes immediately, without transferring their investment', () => {
    const { state } = opened();
    changeCityOwner(state, f.capua, f.carthage);
    expect(state.tradeRoutes).toEqual({});
    expectConsistent(state);
  });

  test('entering and leaving the road cannot loot a fresh cargo more often than a crossing', () => {
    const { state, route } = opened();
    state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
    const army = state.armies[f.punicArmy];
    const faction = state.factions[f.carthage];
    if (!army || !faction) throw new Error('missing raider');
    const gold = faction.stores.gold;
    for (let day = 1; day <= 5; day++) {
      state.day = day as Day;
      army.activity = {
        kind: 'idle',
        position: day % 2 ? routePoint(route, 0.5) : { x: 1000, y: 1000 },
      };
      trade(state);
    }
    expect(faction.stores.gold).toBeCloseTo(gold + route.daily * route.days);
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
});
