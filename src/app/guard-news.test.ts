import { describe, expect, test } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import { executeOrder } from '../sim/orders/orders.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { tick } from '../sim/tick.ts';
import { expectConsistent } from '../sim/references.ts';
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
      'The 1,000 guards hired at Roma have served their year and left. A great power counts fresh guards against a war for 90 days: hire them when the news warns of one.',
      'The 500 guards hired at Capua have served their year and left. A great power counts fresh guards against a war for 90 days: hire them when the news warns of one.',
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

  test('tells of the bands that left on a day the city hires another', () => {
    const before = leavingToday();
    const rome = before.factions[FIXTURE.rome];
    if (rome) rome.stores.gold = 5000;
    const after = tick(
      before,
      [{ kind: 'hireGuards', faction: FIXTURE.rome, city: FIXTURE.roma }],
      world,
    ).state;
    expect(guardNewsOfDay(before, after).map((alert) => alert.text)).toContain(
      'The 1,000 guards hired at Roma have served their year and left. A great power counts fresh guards against a war for 90 days: hire them when the news warns of one.',
    );
    expectConsistent(after);
  });

  test('tells of a band that left before its day to make room for one hired in its place', () => {
    const state = buildFixture();
    state.day = 200 as Day;
    const capua = state.cities[FIXTURE.capua];
    const rome = state.factions[FIXTURE.rome];
    if (!capua || !rome) throw new Error('no Capua or Rome');
    rome.stores.gold = 5000;
    capua.guards = [{ until: 400 as Day }, { until: 480 as Day }, { until: 560 as Day }];
    const after = tick(
      state,
      [{ kind: 'hireGuards', faction: FIXTURE.rome, city: FIXTURE.capua }],
      world,
    ).state;
    expect(after.cities[FIXTURE.capua]?.guards).toHaveLength(3);
    expect(guardNewsOfDay(state, after)).toMatchObject([
      {
        kind: 'guardsLeft',
        day: 200,
        text: 'The 500 guards hired at Capua on Year 1, day 35, whom no great power still counted, left today to make room for the band you hired in their place, counted against a war until Year 1, day 290.',
        focus: { at: capua.position },
      },
    ]);
    expectConsistent(after);
  });
});
