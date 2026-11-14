import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import { allocateId } from '../sim/ids.ts';
import { expectConsistent } from '../sim/references.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import { dailyBalances, economy } from '../sim/systems/economy.ts';
import { recruitForecast } from '../ui/recruit-forecast.ts';
import { joinOrderedText } from '../ui/describe.ts';
import { alertsOfDay } from './alerts.ts';
import { desertionLine, desertionNews, type Desertion } from './desertion.ts';
import { ALL_PAUSES, stopsOfDay } from './pauses.ts';
import { cityDanger } from './city-danger.ts';
import { planCommand } from './command.ts';
import { pageData, parsePage } from './page.ts';
import type { Day } from '../sim/state/day.ts';

const world = fixtureWorld();
function underSiege() {
  const state = buildFixture();
  const enemy = required(state.armies[f.punicArmy]);
  const city = required(state.cities[f.capua]);
  state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
  required(state.formations[f.citizenSpears]).men = 2000;
  enemy.activity = { kind: 'idle', position: city.position };
  return state;
}

describe('warnings before a cautious player loses men or cities', () => {
  it('forecasts troop upkeep and final balances including training, waiting orders and their payment', () => {
    const state = buildFixture();
    required(state.factions[f.rome]).stores.gold = 20_000;
    required(state.factions[f.rome]).stores.manpower = 20_000;
    required(state.cities[f.capua]).recruits.push({
      troop: 'spearmen',
      readyOn: (state.day + 10) as Day,
    });
    const balance = required(dailyBalances(state).get(f.rome));
    const forecast = recruitForecast(
      state,
      [{ kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' }],
      'spearmen',
    );
    expect(forecast.upkeep).toEqual({ food: 6, gold: 10 });
    expect(forecast.after.food).toBeCloseTo(balance.food - 18);
    expect(forecast.after.gold).toBeCloseTo(balance.gold - 30);
    expect(forecast.warning).toContain('Food shortfall');
    expect(forecast.warning).toContain('Gold shortfall');
    expect(forecast.lasts.gold).toBeGreaterThan(15);
    expect(forecast.warning).toContain(
      `about ${forecast.lasts.gold?.toLocaleString('en-US')} days`,
    );
    let actual = state;
    let ranShortOn = 0;
    for (let day = 1; day <= 365; day++) {
      actual = tick(
        actual,
        day === 1
          ? [
              { kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' },
              { kind: 'recruit', faction: f.rome, city: f.roma, troop: 'spearmen' },
            ]
          : [],
        world,
        [
          economy,
          (state) => {
            state.day = (state.day + 1) as Day;
          },
        ],
      ).state;
      expectConsistent(actual);
      if (required(actual.factions[f.rome]).stores.food < 0) {
        ranShortOn = day;
        break;
      }
    }
    expect(forecast.lasts.food).toBe(ranShortOn);
    expectConsistent(state);
  });

  it('does not warn when both final balances are nonnegative', () => {
    const state = buildFixture();
    for (const city of Object.values(state.cities))
      if (city.owner === f.rome) city.population *= 10;
    expect(recruitForecast(state, [], 'spearmen').warning).toBeUndefined();
    expectConsistent(state);
  });

  it('pauses on an own siege beginning, danger crossing, and city loss; the setting disables each', () => {
    const before = underSiege();
    const begun = tick(before, [], world);
    const news = alertsOfDay(before, begun.state, begun.events);
    expect(
      stopsOfDay(news, ALL_PAUSES, new Set())
        .news.filter((a) => a.paused)
        .map((a) => a.kind),
    ).toEqual(['siegeBegan']);
    required(begun.state.cities[f.capua]).foodDays = 8;
    const danger = tick(begun.state, [], world);
    const warning = alertsOfDay(begun.state, danger.state, danger.events);
    expect(warning.find((a) => a.kind === 'cityInDanger')?.text).toMatch(
      /7 days of food.*Relieve.*sally.*peace/,
    );
    expect(stopsOfDay(warning, ALL_PAUSES, new Set()).stop).toBe(true);
    const later = tick(danger.state, [], world);
    expect(
      alertsOfDay(danger.state, later.state, later.events).filter((a) => a.kind === 'cityInDanger'),
    ).toEqual([]);
    required(danger.state.cities[f.capua]).garrison = 0;
    const fallen = tick(danger.state, [], world);
    const loss = alertsOfDay(danger.state, fallen.state, fallen.events);
    expect(
      stopsOfDay(loss, ALL_PAUSES, new Set()).news.find((a) => a.kind === 'cityChangedOwner')
        ?.paused,
    ).toBe(true);
    for (const alerts of [news, warning, loss])
      expect(stopsOfDay(alerts, { ...ALL_PAUSES, ownCity: false }, new Set()).stop).toBe(false);
    expectConsistent(before);
    expectConsistent(begun.state);
    expectConsistent(later.state);
    expectConsistent(fallen.state);
  });

  it('warns before walls collapse and does not call a non-blockading siege about to fall', () => {
    const state = tick(underSiege(), [], world).state;
    required(state.cities[f.capua]).walls = 29;
    expect(cityDanger(state, f.capua)).toBeUndefined();
    const next = tick(state, [], world);
    expect(cityDanger(next.state, f.capua)).toContain('walls may collapse within 7 days');
    expect(
      alertsOfDay(state, next.state, next.events).find((a) => a.kind === 'cityInDanger')?.pause,
    ).toEqual({ kind: 'ownCity' });
    required(next.state.formations[f.citizenSpears]).men = 100;
    expect(cityDanger(next.state, f.capua)).toBeUndefined();
    expectConsistent(next.state);
  });

  it('keeps a standing hunger line and aggregates start, tenth and end, not daily alerts, across a save', () => {
    let state = buildFixture();
    required(state.factions[f.rome]).stores.food = -100;
    let watched: Desertion | undefined;
    let lost = 0;
    const kinds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const next = tick(state, [], world);
      for (const event of next.events)
        if (event.kind === 'armyDeserted' && event.owner === f.rome) lost += event.men;
      const news = desertionNews(state, next.state, next.events, watched);
      kinds.push(...news.alerts.map((a) => a.kind));
      watched = news.watched;
      expect(desertionLine(next.state)).toContain('hunger');
      expect(watched?.lost).toBe(lost);
      const saved = parsePage(
        pageData({
          desertion: watched,
          chronicle: news.alerts,
          camera: undefined,
          selection: undefined,
          panel: undefined,
          occupied: new Map(),
          told: new Set(),
          weakSieges: new Map(),
        }),
      );
      if (!saved.ok) throw new Error(saved.error);
      watched = saved.page?.desertion;
      state = next.state;
      expectConsistent(state);
    }
    expect(kinds).toEqual(['desertionBegan', 'desertionTenth']);
    required(state.factions[f.rome]).stores.food = 1000;
    const recovered = tick(state, [], world);
    const end = desertionNews(state, recovered.state, recovered.events, watched);
    expect(end.alerts).toMatchObject([
      { kind: 'desertionEnded', text: expect.stringContaining(`${lost} men lost`) },
    ]);
    expect(end.watched).toBeUndefined();
    expect(desertionLine(recovered.state)).toBeUndefined();
    expect(desertionNews(recovered.state, recovered.state, [], end.watched).alerts).toEqual([]);
    expectConsistent(recovered.state);
  });

  it('counts a queued join in the march forecast and acknowledges both sides while paused', () => {
    const state = buildFixture();
    const army = required(state.armies[f.romanArmy]);
    const id = allocateId(state, 'army');
    const fid = allocateId(state, 'formation');
    const donor = { ...army, id, name: 'Second Legion', formations: [fid] };
    state.armies[id] = donor;
    state.formations[fid] = { id: fid, army: id, troop: 'spearmen', men: 1500, morale: 1 };
    const order = { kind: 'joinArmy', faction: f.rome, army: id, into: army.id } as const;
    state.wars[warKey(f.rome, f.syracusaeFaction)] = newWar(f.rome, f.syracusaeFaction, state.day);
    const city = required(state.cities[f.syracusae]);
    city.garrison = 1988;
    const target = { kind: 'city', city } as const;
    const alone = planCommand(state, world, army, target, []);
    expect(alone.notice).toContain('more men would hold the siege');
    const joined = planCommand(state, world, army, target, [order]);
    expect(joined.notice ?? '').not.toContain('more men would hold the siege');
    expect(joinOrderedText(state, [order], donor)).toBe(
      'Join First Legion ordered for the next day',
    );
    expect(joinOrderedText(state, [order], army)).toBe(
      'Second Legion ordered to join this army next day',
    );
    expectConsistent(state);
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Warning fixture record missing');
  return value;
}
