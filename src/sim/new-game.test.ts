import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import type { CityId, FactionId } from './ids.ts';
import { parseMap, POWERS, type PowerId } from './map.ts';
import { newGame } from './new-game.ts';
import { expectConsistent } from './references.ts';
import { seedRng } from './rng.ts';
import { loadGame, saveGame } from './save.ts';
import { GameStateSchema, type GameState } from './state/game-state.ts';
import { tick } from './tick.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../data/map/map.json'), 'utf8')),
);
const start = () => newGame(map, { seed: 7, player: 'rome' });

const ownerOf = (state: GameState, province: string) =>
  Object.values(state.cities).find((city) => city.province === province)?.owner;

describe('newGame on the committed map', () => {
  test('every map province has exactly one state province and one city at the map position', () => {
    const state = start();
    expect(Object.keys(state.provinces).sort()).toEqual(map.provinces.map((p) => p.id).sort());
    for (const province of map.provinces) {
      const cities = Object.values(state.cities).filter((city) => city.province === province.id);
      expect(cities).toHaveLength(1);
      expect(cities[0]).toMatchObject({
        name: province.name,
        position: { x: province.city[0], y: province.city[1] },
      });
      expect(state.provinces[province.id]?.city).toBe(cities[0]?.id);
    }
    expect(Object.keys(state.cities)).toHaveLength(map.provinces.length);
    expectConsistent(state);
  });

  test('each city starts under the owner the map gives its province', () => {
    const state = start();
    for (const province of map.provinces) {
      const owner = ownerOf(state, province.id);
      if (province.owner === 'independent') {
        expect(state.factions[owner as FactionId]).toMatchObject({
          kind: 'minor',
          name: province.name,
        });
      } else {
        expect(owner).toBe(province.owner);
      }
    }
    expectConsistent(state);
  });

  test('there are five great powers and one minor faction for each independent city', () => {
    const state = start();
    const factions = Object.values(state.factions);
    const greatPowers = factions.filter((f) => f.kind === 'greatPower').map((f) => f.id);
    expect(greatPowers.sort()).toEqual([...POWERS].sort());

    const independent = map.provinces.filter((p) => p.owner === 'independent');
    const minors = factions.filter((f) => f.kind === 'minor');
    expect(minors).toHaveLength(independent.length);
    const minorOwners = independent.map((p) => ownerOf(state, p.id));
    expect(new Set(minorOwners).size).toBe(independent.length);
    expectConsistent(state);
  });

  test('each great power has one idle army at its capital and minor factions have none', () => {
    const state = start();
    const armies = Object.values(state.armies);
    expect(armies).toHaveLength(POWERS.length);
    for (const power of POWERS) {
      const capital = map.provinces.find((p) => p.owner === power && p.capital);
      const own = armies.filter((army) => army.owner === power);
      expect(own).toHaveLength(1);
      expect(own[0]?.activity).toEqual({
        kind: 'idle',
        position: { x: capital?.city[0], y: capital?.city[1] },
      });
      expect(own[0]?.formations.length).toBeGreaterThan(0);
    }
    const troopsOf = (power: PowerId) =>
      armies
        .find((army) => army.owner === power)
        ?.formations.map((id) => {
          const { troop, men, morale } = state.formations[id] ?? {};
          return { troop, men, morale };
        });
    for (const power of POWERS) expect(troopsOf(power)).toEqual(troopsOf('rome'));
    expectConsistent(state);
  });

  test('the player is the chosen power and the generator is seeded from the seed', () => {
    const state = newGame(map, { seed: 99, player: 'persia' });
    expect(state.player).toBe('persia');
    expect(state.rng).toBe(seedRng(99));
    expect(state.day).toBe(1);
    expectConsistent(state);
  });

  test('an unknown player is rejected', () => {
    expect(() => newGame(map, { seed: 7, player: 'sparta' as PowerId })).toThrow(
      'unknown player sparta',
    );
    expectConsistent(start());
  });

  test('two calls with the same options give deeply equal states', () => {
    const state = start();
    expect(start()).toStrictEqual(state);
    expectConsistent(state);
  });

  test('the state passes the schema and survives a save and load round trip', () => {
    const state = start();
    expect(v.parse(GameStateSchema, state)).toStrictEqual(state);
    expect(loadGame(saveGame(state))).toEqual({ ok: true, state });
    expectConsistent(state);
  });

  test('365 ticks from the new game run with no broken link', () => {
    let state = start();
    for (let day = 0; day < 365; day++) {
      state = tick(state, []).state;
      expectConsistent(state);
    }
    expect(state.day).toBe(366);
    expect(state.cities['roma' as CityId]?.owner).toBe('rome');
    expectConsistent(state);
  });
});
