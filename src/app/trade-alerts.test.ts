import { expect, test } from 'vitest';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../sim/fixture.ts';
import type { DayEvent } from '../sim/events.ts';
import type { TradeRouteId } from '../sim/ids.ts';
import { tick } from '../sim/tick.ts';
import { alertsOfDay } from './alerts.ts';

const world = fixtureWorld();
const base = {
  from: f.roma,
  to: f.carthago,
  owners: [f.rome, f.carthage],
  position: { x: 2000, y: 2000 },
} as const;

test.each([
  { kind: 'tradeOpened', text: 'Trade opened: Roma to Carthago.' },
  {
    kind: 'tradeClosed',
    cause: 'war between the partners',
    invitation: false,
    text: 'Trade closed: Roma to Carthago, war between the partners.',
  },
] as const)('$kind tells the player and selects the city, not a hidden army', (fields) => {
  const state = buildFixture();
  const { text, ...rest } = fields;
  const event = { ...base, ...rest, route: 'tradeRoute-1' } as DayEvent;
  expect(alertsOfDay(state, state, [event])).toContainEqual(
    expect.objectContaining({
      kind: fields.kind,
      text,
      focus: { at: base.position, select: { kind: 'province', province: f.africa } },
    }),
  );
  const other = { ...event, owners: [f.carthage, f.syracusaeFaction] } as DayEvent;
  expect(alertsOfDay(state, state, [other])).toEqual([]);
});

test('an invitation names its way, crossing and last day, and its refusal is told', () => {
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
  expect(alertsOfDay(state, offered.state, offered.events)).toContainEqual(
    expect.objectContaining({
      kind: 'tradeOffered',
      text: `Carthago invites Roma to trade by sea, ${route.days} days a crossing, until Year 1, day 91. Select Roma to accept or refuse.`,
    }),
  );
  const refusal = { kind: 'closeTrade', faction: f.rome, route: route.id } as const;
  const refused = tick(offered.state, [refusal], world);
  expect(alertsOfDay(offered.state, refused.state, refused.events)).toContainEqual(
    expect.objectContaining({
      kind: 'tradeClosed',
      tone: 'neutral',
      text: 'Invitation to trade ended: Carthago to Roma, refused by Rome.',
    }),
  );
});

test('raids and sieges are left to the trade news, which tells them by episode', () => {
  const state = buildFixture();
  const raid: DayEvent = {
    ...base,
    kind: 'tradeRaided',
    route: 'tradeRoute-1' as TradeRouteId,
    cause: 'raid',
    raider: f.carthage,
    looted: 40,
  };
  expect(alertsOfDay(state, state, [raid])).toEqual([]);
});
