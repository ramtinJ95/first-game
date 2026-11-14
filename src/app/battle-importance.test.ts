import { expect, it } from 'vitest';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import { allocateId } from '../sim/ids.ts';
import { expectConsistent } from '../sim/references.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import { alertsOfDay, cornerAlerts } from './alerts.ts';
import { ALL_PAUSES, stopsOfDay } from './pauses.ts';
import { pageData, parsePage } from './page.ts';

it.each([50, 100, 150, 499, 500])(
  'a battle involving %i men pauses only at the 500-man line when a large reserve exists',
  (men) => {
    const state = facing(men, 50, men === 50);
    const result = tick(state, [], fixtureWorld());
    const news = alertsOfDay(state, result.state, result.events);
    const began = news.find((a) => a.kind === 'battleBegan');
    expect(began).toBeDefined();
    expect(stopsOfDay(news, ALL_PAUSES, new Set()).stop).toBe(men >= 500);
    if (men < 500)
      expect(cornerAlerts(news, 10).filter((a) => a.kind === 'battleBegan')).toEqual([]);
    if (men === 50) {
      expect(Object.keys(result.state.battles)).toHaveLength(0);
      expect(cornerAlerts(news, 10).filter((a) => a.kind === 'battleEnded')).toHaveLength(1);
      expect(cornerAlerts(news, 10)).toHaveLength(1);
    }
    expectConsistent(result.state);
  },
);

it('keeps a multi-day small battle quiet through save/load, with one neutral result and Chronicle details', () => {
  let state = facing(150, 150);
  let told = new Set<string>();
  const news = [];
  for (let day = 0; day < 20; day++) {
    const result = tick(state, [], fixtureWorld());
    const alerts = alertsOfDay(state, result.state, result.events, undefined, told);
    news.push(...alerts);
    const saved = parsePage(
      pageData({
        chronicle: news,
        camera: undefined,
        selection: undefined,
        panel: undefined,
        occupied: new Map(),
        told,
        weakSieges: new Map(),
      }),
    );
    if (!saved.ok || !saved.page) throw new Error('Page did not round trip');
    told = new Set(saved.page.told);
    expect(stopsOfDay(alerts, ALL_PAUSES, told).stop).toBe(false);
    state = result.state;
    expectConsistent(state);
    if (news.some((a) => a.kind === 'battleEnded')) break;
  }
  expect(news.find((a) => a.kind === 'battleEnded')?.text).toContain('after 5 days');
  const related = news.filter((a) =>
    ['battleBegan', 'battleEnded', 'armyRetreated', 'armyDestroyed'].includes(a.kind),
  );
  expect(cornerAlerts(related, 10)).toMatchObject([{ kind: 'battleEnded', tone: 'neutral' }]);
  expect(related.find((a) => a.kind === 'armyRetreated')?.world).toBe('chronicle');
  expect([...told].filter((key) => key.startsWith('quiet-battle:'))).toEqual([]);
});

it('pauses for a small battle when it involves a tenth of all the men left', () => {
  const state = buildFixture();
  const army = required(state.armies[f.romanArmy]);
  const enemy = required(state.armies[f.punicArmy]);
  for (const id of army.formations) required(state.formations[id]).men = 25;
  enemy.activity = {
    kind: 'idle',
    position: {
      x: required(state.cities[f.roma]).position.x + 3,
      y: required(state.cities[f.roma]).position.y,
    },
  };
  state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
  const result = tick(state, [], fixtureWorld());
  const news = alertsOfDay(state, result.state, result.events);
  expect(news.find((a) => a.kind === 'battleBegan')?.pause).toEqual({ kind: 'battle' });
  expectConsistent(result.state);
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Warning fixture record missing');
  return value;
}

function facing(men: number, enemyMen: number, broken = false) {
  const state = buildFixture();
  const roman = required(state.armies[f.romanArmy]);
  const enemy = required(state.armies[f.punicArmy]);
  const at = required(state.cities[f.roma]).position;
  roman.activity = { kind: 'idle', position: { x: at.x + 70, y: at.y - 30 } };
  enemy.activity = { kind: 'idle', position: { x: at.x + 72, y: at.y - 30 } };
  for (const [index, id] of roman.formations.entries()) {
    const formation = required(state.formations[id]);
    formation.men =
      Math.floor(men / roman.formations.length) + (index === 0 ? men % roman.formations.length : 0);
    if (broken) formation.morale = 0.001;
  }
  required(state.formations[f.citizenSpears]).men = enemyMen;
  const id = allocateId(state, 'army');
  const fid = allocateId(state, 'formation');
  state.armies[id] = {
    ...roman,
    id,
    name: 'Reserve',
    formations: [fid],
    activity: { kind: 'idle', position: required(state.cities[f.capua]).position },
  };
  state.formations[fid] = { id: fid, army: id, troop: 'spearmen', men: 10_000, morale: 1 };
  state.wars[warKey(f.rome, f.carthage)] = newWar(f.rome, f.carthage, state.day);
  return state;
}
