import { describe, expect, test } from 'vitest';
import { recordEvents } from '../sim/events.ts';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../sim/fixture.ts';
import type { Day } from '../sim/state/day.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { trade } from '../sim/systems/trade.ts';
import { tick } from '../sim/tick.ts';
import { closeTrade, openTrade } from '../sim/trade/orders.ts';
import { routePoint } from '../sim/trade/routes.ts';
import { expectConsistent } from '../sim/references.ts';
import type { Alert } from './alerts.ts';
import { whole } from './names.ts';
import { TRADE_QUIET_DAYS, tradeNews, type TradeTrouble } from './trade-news.ts';

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
  test('one enemy raiding one road again and again is one line, then its tally once the road is quiet', () => {
    const { state, cargo, day, told } = road();
    for (const onRoad of [true, false, true, false, true]) day(onRoad);
    expect(told.map((a) => a.text)).toEqual([
      `Carthage raided the road Roma to Capua and took a cargo worth about ${cargo} gold to you. Deliveries stop while its armies stay within reach.`,
    ]);
    for (let i = 0; i < TRADE_QUIET_DAYS; i++) day(false);
    expect(told.map((a) => a.text)).toEqual([
      expect.stringContaining('Carthage raided the road Roma to Capua'),
      `Carthage's raids on Roma to Capua have stopped: 3 raids since Year 1, day 1 took a cargo worth about ${cargo} gold to you.`,
    ]);
    expectConsistent(state);
  });

  test('a lone raid needs no tally, and a raid after a quiet spell is news again', () => {
    const { day, told } = road();
    day(true);
    for (let i = 0; i <= TRADE_QUIET_DAYS; i++) day(false);
    expect(told).toHaveLength(1);
    day(true);
    expect(told).toHaveLength(2);
    expect(told[1]?.text).toContain('Carthage raided the road Roma to Capua');
  });

  test('closing a raided route tells what its raids took before it closed', () => {
    const { state, route, cargo, day, told, watched } = road();
    day(true);
    day(false);
    day(true);
    const before = structuredClone(state);
    closeTrade(state, { kind: 'closeTrade', faction: f.rome, route: route.id });
    const news = tradeNews(before, state, [], watched());
    expect(news.alerts.map((a) => a.text)).toEqual([
      `Carthage's 2 raids on Roma to Capua took a cargo worth about ${cargo} gold to you before the route closed.`,
    ]);
    expect(news.watched).toEqual([]);
    expect(told).toHaveLength(1);
  });

  test('a siege that stops several of the player routes is one line naming them', () => {
    const state = buildFixture();
    const roman = state.armies[f.romanArmy];
    const punic = state.armies[f.punicArmy];
    const roma = state.cities[f.roma];
    const capua = state.cities[f.capua];
    if (!roman || !punic || !roma || !capua) throw new Error('missing fixture');
    const order = { kind: 'openTrade', faction: f.rome, from: f.roma } as const;
    expect(openTrade(state, { ...order, to: f.capua, mode: 'land' }, world)).toBeUndefined();
    expect(openTrade(state, { ...order, to: f.syracusae, mode: 'sea' }, world)).toBeUndefined();
    roman.activity = { kind: 'idle', position: { ...capua.position } };
    punic.activity = { kind: 'idle', position: { ...roma.position } };
    const war = { kind: 'declareWar', faction: f.rome, against: f.carthage } as const;
    const { state: next, events } = tick(state, [war], world);
    const news = tradeNews(state, next, events, []);
    expect(news.alerts.map((a) => a.text)).toEqual([
      'The siege of Roma stops 2 trade routes: Roma to Capua and Roma to Syracusae. If Roma falls, they close.',
    ]);
    const later = tick(next, [], world);
    expect(tradeNews(next, later.state, later.events, news.watched).alerts).toEqual([]);
    expectConsistent(later.state);
  });
});
