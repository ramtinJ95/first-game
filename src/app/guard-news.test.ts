import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import { executeOrder } from '../sim/orders/orders.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { tick } from '../sim/tick.ts';
import { guardNewsOfDay } from './guard-news.ts';

const world = fixtureWorld();

/** Rome's Roma with two bands and Capua with one, all leaving today. */
function leavingToday(): GameState {
  const state = buildFixture();
  const roma = state.cities[FIXTURE.roma];
  const capua = state.cities[FIXTURE.capua];
  if (!roma || !capua) throw new Error('no Roman cities');
  roma.guards = [{ until: state.day }, { until: state.day }, { until: (state.day + 9) as Day }];
  capua.guards = [{ until: state.day }];
  return state;
}

describe('the news of guards who served their year', () => {
  test("tells once for each of the player's cities how many left, at the city", () => {
    const before = leavingToday();
    const after = tick(before, [], world).state;
    const news = guardNewsOfDay(before, after);
    expect(news.map((alert) => alert.text)).toEqual([
      'The 1,000 guards hired at Roma have served their year and left. Hire more in its city panel.',
      'The 500 guards hired at Capua have served their year and left. Hire more in its city panel.',
    ]);
    expect(news[0]).toMatchObject({
      kind: 'guardsLeft',
      tone: 'neutral',
      day: before.day,
      focus: { at: after.cities[FIXTURE.roma]?.position },
    });
    expect(news[0]?.pause).toBeUndefined();
    expect(guardNewsOfDay(after, tick(after, [], world).state)).toEqual([]);
  });

  test('says nothing of a hire, nor of a city the player lost', () => {
    const before = leavingToday();
    const rome = before.factions[FIXTURE.rome];
    if (rome) rome.stores.gold = 5000;
    const hired = structuredClone(before);
    executeOrder(hired, { kind: 'hireGuards', faction: FIXTURE.rome, city: FIXTURE.capua }, world);
    expect(guardNewsOfDay(before, hired)).toEqual([]);
    const lost = structuredClone(before);
    changeCityOwner(lost, FIXTURE.capua, FIXTURE.carthage);
    expect(guardNewsOfDay(before, lost)).toEqual([]);
  });
});
