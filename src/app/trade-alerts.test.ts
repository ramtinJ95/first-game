import { expect, test } from 'vitest';
import { buildFixture, FIXTURE as f } from '../sim/fixture.ts';
import type { DayEvent } from '../sim/events.ts';
import type { TradeRouteId } from '../sim/ids.ts';
import { alertsOfDay } from './alerts.ts';

test.each(['tradeOpened', 'tradeOffered', 'tradeClosed', 'tradeRaided'] as const)(
  '%s tells the player and selects the city, not a hidden army',
  (kind) => {
    const state = buildFixture();
    const event: DayEvent = {
      kind,
      route: 'tradeRoute-1' as TradeRouteId,
      from: f.roma,
      to: f.carthago,
      owners: [f.rome, f.carthage],
      position: { x: 2000, y: 2000 },
      cause: 'raid',
    };
    const alerts = alertsOfDay(state, state, [event]);
    expect(alerts).toContainEqual(
      expect.objectContaining({
        kind,
        text: expect.stringContaining('Roma'),
        focus: { at: event.position, select: { kind: 'province', province: f.africa } },
      }),
    );
    const other = { ...event, owners: [f.carthage, f.syracusaeFaction] as const };
    expect(alertsOfDay(state, state, [other])).toEqual([]);
  },
);
