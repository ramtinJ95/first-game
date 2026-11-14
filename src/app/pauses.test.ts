import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE, fixtureWorld } from '../sim/fixture.ts';
import { expectConsistent } from '../sim/references.ts';
import type { Day } from '../sim/state/day.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { tick } from '../sim/tick.ts';
import { alertsOfDay, type Alert } from './alerts.ts';
import { ALL_PAUSES, readPauses, stopsOfDay, writePauses } from './pauses.ts';

const world = fixtureWorld();
const f = FIXTURE;

function battleDay(withPlayer: boolean) {
  const state = buildFixture();
  const a = withPlayer ? f.rome : f.syracusaeFaction;
  state.wars[warKey(a, f.carthage)] = newWar(a, f.carthage, state.day);
  const punic = state.armies[f.punicArmy];
  const roman = state.armies[f.romanArmy];
  if (!punic || !roman || roman.activity.kind !== 'idle') throw new Error('fixture changed');
  punic.activity = {
    kind: 'idle',
    position: { x: roman.activity.position.x - 5, y: roman.activity.position.y },
  };
  if (!withPlayer) roman.owner = f.syracusaeFaction;
  const { state: next, events } = tick(state, [], world);
  expectConsistent(next);
  return alertsOfDay(state, next, events);
}

const sighting = (once: string, day = 3): Alert => ({
  kind: 'enemySighted',
  day: day as Day,
  tone: 'bad',
  text: 'An enemy marches on Roma',
  pause: { kind: 'sighted', once },
});

describe('stopsOfDay', () => {
  it('stops the game on the day a battle of the player begins, and says so on its alert', () => {
    const news = battleDay(true);
    const { news: marked, stop } = stopsOfDay(news, ALL_PAUSES, new Set());
    expect(stop).toBe(true);
    expect(marked.filter((a) => a.paused).map((a) => a.kind)).toEqual(['battleBegan']);
    expect(stopsOfDay(news, { ...ALL_PAUSES, battle: false }, new Set()).stop).toBe(false);
  });

  it('does not stop for a battle of others', () => {
    expect(stopsOfDay(battleDay(false), ALL_PAUSES, new Set()).stop).toBe(false);
  });

  it('stops for the first enemy seen in a war, and not for the next ones of that war', () => {
    const first = stopsOfDay([sighting('war-1')], ALL_PAUSES, new Set());
    expect(first.stop).toBe(true);
    const second = stopsOfDay([sighting('war-1', 4)], ALL_PAUSES, first.told);
    expect(second.stop).toBe(false);
    expect(stopsOfDay([sighting('war-2', 4)], ALL_PAUSES, first.told).stop).toBe(true);
    const off = stopsOfDay([sighting('war-3')], { ...ALL_PAUSES, sighted: false }, new Set());
    expect(off.stop).toBe(false);
    expect(stopsOfDay([sighting('war-3', 4)], ALL_PAUSES, off.told).stop).toBe(false);
  });

  it('keeps the settings across games, each on until turned off', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    } as Storage;
    expect(readPauses(storage)).toEqual(ALL_PAUSES);
    writePauses(storage, { ...ALL_PAUSES, weakSiege: false });
    expect(readPauses(storage)).toEqual({ battle: true, weakSiege: false, sighted: true });
    store.set('pauses', 'not json');
    expect(readPauses(storage)).toEqual(ALL_PAUSES);
  });
});
