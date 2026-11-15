import { describe, expect, test } from 'vitest';
import { recordEvents, type DayEvent } from '../sim/events.ts';
import type { TradeRouteId } from '../sim/ids.ts';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../sim/fixture.ts';
import type { Day } from '../sim/state/day.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { trade } from '../sim/systems/trade.ts';
import { tick } from '../sim/tick.ts';
import { closeTrade, openTrade } from '../sim/trade/orders.ts';
import { routePoint } from '../sim/trade/routes.ts';
import { expectConsistent } from '../sim/references.ts';
import { alertsOfDay, type Alert } from './alerts.ts';
import { whole } from './names.ts';
import { TRADE_QUIET_DAYS, TRADE_TALLY_DAYS, tradeNews, type TradeTrouble } from './trade-news.ts';

const world = fixtureWorld();

/** Rome's road from Roma to Capua at war with Carthage, whose army the test walks on and off it. */
function road() {
  const state = buildFixture();
  const order = {
    kind: 'openTrade',
    faction: f.rome,
    from: f.roma,
    to: f.capua,
    mode: 'land',
  } as const;
  expect(openTrade(state, order, world)).toBeUndefined();
  const route = Object.values(state.tradeRoutes)[0];
  const army = state.armies[f.punicArmy];
  if (!route || !army) throw new Error('missing fixture');
  state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
  const cargo = whole(route.daily * route.days * 2);
  let watched: TradeTrouble[] = [];
  const told: Alert[] = [];
  /** Plays one day of trade with the raider on the road or away, and keeps the news. */
  const day = (onRoad: boolean) => {
    const before = structuredClone(state);
    army.activity = { kind: 'idle', position: onRoad ? routePoint(route, 0.5) : { x: 1, y: 1 } };
    const events = recordEvents(state, () => trade(state));
    const news = tradeNews(before, state, events, watched);
    watched = news.watched;
    told.push(...news.alerts);
    state.day = (state.day + 1) as Day;
  };
  return { state, route, cargo, day, told, watched: () => watched };
}

describe('trade news', () => {
  test('one enemy raiding one road again and again is one line, then a tally of what it took since', () => {
    const { state, route, cargo, day, told } = road();
    for (const onRoad of [true, false, true, false]) day(onRoad);
    for (let i = 0; i < route.days; i++) day(false);
    day(true);
    expect(told.map((a) => a.text)).toEqual([
      `Carthage raided the road Roma to Capua and took a cargo worth about ${cargo} gold to you. Deliveries stop while its armies stay within reach.`,
    ]);
    for (let i = 0; i < TRADE_QUIET_DAYS; i++) day(false);
    expect(told.map((a) => a.text)).toEqual([
      expect.stringContaining('Carthage raided the road Roma to Capua'),
      `Carthage's raids on Roma to Capua took another cargo worth about ${cargo} gold to you since Year 1, day 1.`,
    ]);
    expect(told[1]?.day).toBe(1 + TRADE_TALLY_DAYS);
    expectConsistent(state);
  });

  test('raids that go on for a year tell their new losses at most a month after the last line', () => {
    const { state, route, day, told } = road();
    const carthage = state.factions[f.carthage];
    if (!carthage) throw new Error('missing Carthage');
    const thefts: number[] = [];
    while (state.day < 365) {
      const gold = carthage.stores.gold;
      const on = state.day;
      day(state.day >= route.departsOn);
      if (carthage.stores.gold > gold) thefts.push(on);
    }
    const lines = told.map((a) => ({
      day: a.day,
      cargoes: /took (a|another) cargo/.test(a.text)
        ? 1
        : Number(/took (\d+) (more )?cargoes/.exec(a.text)?.[1]),
    }));
    expect(thefts.length).toBeGreaterThan(12);
    expect(told[0]?.text).toContain('Carthage raided the road Roma to Capua and took a cargo');
    expect(told.slice(1).map((a) => a.text)).toEqual(
      Array.from({ length: told.length - 1 }, () =>
        expect.stringMatching(
          /^Carthage's raids on Roma to Capua took (another cargo|\d+ more cargoes) worth about [\d,]+ gold to you since Year 1, day \d+\.$/,
        ),
      ),
    );
    for (const theft of thefts.filter((d) => d < 365 - TRADE_TALLY_DAYS))
      expect(lines.some((l) => l.day >= theft && l.day <= theft + TRADE_TALLY_DAYS)).toBe(true);
    const toldCargoes = lines.reduce((sum, l) => sum + l.cargoes, 0);
    const lastLine = lines.at(-1)?.day ?? 0;
    expect(toldCargoes).toBe(thefts.filter((d) => d <= lastLine).length);
    expect(told.length).toBeLessThanOrEqual(1 + Math.ceil(365 / TRADE_TALLY_DAYS));
    expectConsistent(state);
  });

  test("one enemy's raids on two roads are one episode, tallied with both roads", () => {
    const { state, route, cargo } = road();
    const away = route.path.map((p) => ({ x: p.x + 200, y: p.y }));
    const other = {
      ...route,
      id: 'tradeRoute-99' as TradeRouteId,
      from: f.capua,
      to: f.roma,
      path: away,
    };
    state.tradeRoutes[other.id] = other;
    const army = state.armies[f.punicArmy];
    if (!army) throw new Error('missing army');
    let watched: TradeTrouble[] = [];
    const told: string[] = [];
    const play = (at: { x: number; y: number }) => {
      const before = structuredClone(state);
      army.activity = { kind: 'idle', position: at };
      const news = tradeNews(
        before,
        state,
        recordEvents(state, () => trade(state)),
        watched,
      );
      watched = news.watched;
      told.push(...news.alerts.map((a) => a.text));
      state.day = (state.day + 1) as Day;
    };
    play(routePoint(route, 0.5));
    play(routePoint(other, 0.5));
    for (let i = 0; i < TRADE_QUIET_DAYS; i++) play({ x: 1, y: 1 });
    expect(told).toEqual([
      `Carthage raided the road Roma to Capua and took a cargo worth about ${cargo} gold to you. Deliveries stop while its armies stay within reach.`,
      `Carthage's raids on Roma to Capua and Capua to Roma took another cargo worth about ${cargo} gold to you since Year 1, day 1.`,
    ]);
  });

  test('raids that take nothing more need no tally, and a raid after a quiet spell is news again', () => {
    const { day, told } = road();
    for (const onRoad of [true, false, true]) day(onRoad);
    for (let i = 0; i <= TRADE_QUIET_DAYS; i++) day(false);
    expect(told).toHaveLength(1);
    day(true);
    expect(told).toHaveLength(2);
    expect(told[1]?.text).toContain('Carthage raided the road Roma to Capua');
  });

  test('closing a raided route tells what its raids took before it closed', () => {
    const { state, route, day, told, watched } = road();
    day(true);
    for (let i = 0; i < route.days; i++) day(false);
    day(true);
    const before = structuredClone(state);
    closeTrade(state, { kind: 'closeTrade', faction: f.rome, route: route.id });
    const news = tradeNews(before, state, [], watched());
    expect(news.alerts.map((a) => a.text)).toEqual([
      `Carthage's 2 raids on Roma to Capua took 2 cargoes worth about ${whole(route.daily * route.days * 4)} gold to you before the route closed.`,
    ]);
    expect(news.watched).toEqual([]);
    expect(told).toHaveLength(1);
  });

  test("a siege of a partner's city is one line naming the routes it stops, told once", () => {
    const state = buildFixture();
    const punic = state.armies[f.punicArmy];
    const syracusae = state.cities[f.syracusae];
    if (!punic || !syracusae) throw new Error('missing fixture');
    const order = { kind: 'openTrade', faction: f.rome, from: f.roma } as const;
    expect(openTrade(state, { ...order, to: f.syracusae, mode: 'sea' }, world)).toBeUndefined();
    punic.activity = { kind: 'idle', position: { ...syracusae.position } };
    const war = { kind: 'declareWar', faction: f.carthage, against: f.syracusaeFaction } as const;
    const { state: next, events } = tick(state, [war], world);
    const news = tradeNews(state, next, events, []);
    expect(news.alerts.map((a) => a.text)).toEqual([
      'The siege of Syracusae stops trade: Roma to Syracusae. If Syracusae falls, the route closes.',
    ]);
    const second = events.flatMap((e) =>
      e.kind === 'tradeRaided'
        ? [{ ...e, route: 'tradeRoute-9' as TradeRouteId, from: f.capua }]
        : [],
    );
    expect(tradeNews(state, next, [...events, ...second], []).alerts.map((a) => a.text)).toEqual([
      'The siege of Syracusae stops 2 trade routes: Roma to Syracusae and Capua to Syracusae. If Syracusae falls, they close.',
    ]);
    const later = tick(next, [], world);
    expect(tradeNews(next, later.state, later.events, news.watched).alerts).toEqual([]);
    expectConsistent(later.state);
  });

  test("a siege of the player's own city is left to the city's own news, but the cargo its besieger takes is told", () => {
    const state = buildFixture();
    const roman = state.armies[f.romanArmy];
    const punic = state.armies[f.punicArmy];
    const roma = state.cities[f.roma];
    const capua = state.cities[f.capua];
    if (!roman || !punic || !roma || !capua) throw new Error('missing fixture');
    const order = { kind: 'openTrade', faction: f.rome, from: f.roma } as const;
    expect(openTrade(state, { ...order, to: f.capua, mode: 'land' }, world)).toBeUndefined();
    roman.activity = { kind: 'idle', position: { ...capua.position } };
    punic.activity = { kind: 'idle', position: { ...roma.position } };
    const war = { kind: 'declareWar', faction: f.rome, against: f.carthage } as const;
    const { state: next, events } = tick(state, [war], world);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'tradeRaided', cause: 'siege' }));
    const route = Object.values(state.tradeRoutes)[0];
    if (!route) throw new Error('expected a route');
    expect(tradeNews(state, next, events, []).alerts.map((a) => a.text)).toEqual([
      `Carthage raided the road Roma to Capua and took a cargo worth about ${whole(route.daily * route.days * 2)} gold to you. Deliveries stop while its armies stay within reach.`,
    ]);
    expect(alertsOfDay(state, next, events)).toContainEqual(
      expect.objectContaining({ kind: 'siegeBegan', text: 'Carthage besieges Roma' }),
    );
  });

  test('opening, an invitation with its terms, and its refusal are each a line that selects the city', () => {
    const state = buildFixture();
    const carthage = state.factions[f.carthage];
    if (!carthage) throw new Error('missing Carthage');
    carthage.stores.gold = 10000;
    const invite = {
      kind: 'openTrade',
      faction: f.carthage,
      from: f.carthago,
      to: f.roma,
      mode: 'sea',
    } as const;
    const offered = tick(state, [invite], world);
    const route = Object.values(offered.state.tradeRoutes)[0];
    if (!route) throw new Error('expected an invitation');
    expect(tradeNews(state, offered.state, offered.events, []).alerts).toEqual([
      expect.objectContaining({
        kind: 'tradeOffered',
        text: `Carthago invites Roma to trade by sea, ${route.days} days a crossing, until Year 1, day 91. Select Roma to accept or refuse.`,
        focus: expect.objectContaining({ select: { kind: 'province', province: f.latium } }),
      }),
    ]);
    expect(alertsOfDay(state, offered.state, offered.events)).toEqual([]);
    const refusal = { kind: 'closeTrade', faction: f.rome, route: route.id } as const;
    const refused = tick(offered.state, [refusal], world);
    expect(tradeNews(offered.state, refused.state, refused.events, []).alerts).toEqual([
      expect.objectContaining({
        kind: 'tradeClosed',
        tone: 'neutral',
        text: 'Invitation to trade ended: Carthago to Roma, refused by Rome.',
      }),
    ]);
    const opening = {
      kind: 'openTrade',
      faction: f.rome,
      from: f.roma,
      to: f.capua,
      mode: 'land',
    } as const;
    const opened = tick(state, [opening], world);
    expect(tradeNews(state, opened.state, opened.events, []).alerts.map((a) => a.text)).toEqual([
      'Trade opened: Roma to Capua.',
    ]);
  });

  test("routes closed for one cause on one day are one line, and others' trade is not news", () => {
    const state = buildFixture();
    const closing = (route: string, from: typeof f.roma, to: typeof f.roma): DayEvent => ({
      kind: 'tradeClosed',
      route: route as TradeRouteId,
      from,
      to,
      owners: [f.rome, f.carthage],
      position: { x: 0, y: 0 },
      cause: 'war between the partners',
      invitation: false,
    });
    const events = [
      closing('tradeRoute-1', f.roma, f.carthago),
      closing('tradeRoute-2', f.capua, f.carthago),
    ];
    expect(tradeNews(state, state, events, []).alerts.map((a) => a.text)).toEqual([
      '2 trade routes closed, war between the partners: Roma to Carthago and Capua to Carthago.',
    ]);
    const others = events.map((e) => ({ ...e, owners: [f.carthage, f.syracusaeFaction] as const }));
    expect(tradeNews(state, state, others, []).alerts).toEqual([]);
  });
});
