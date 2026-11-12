import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import type { CityId, FactionId } from './ids.ts';
import { parseMap, POWERS, type PowerId } from './map.ts';
import { newGame, STARTING_GENERAL_SKILL, STARTING_STORES } from './new-game.ts';
import type { Order } from './orders/orders.ts';
import { expectConsistent } from './references.ts';
import { seedRng } from './rng.ts';
import { loadGame, saveGame } from './save.ts';
import { GameStateSchema, type GameState } from './state/game-state.ts';
import { UNREST_DAYS } from './cities.ts';
import { dailyBalances, menOf, UPKEEP_PER_MAN } from './systems/economy.ts';
import { CITY_DEFENCES } from './systems/sieges.ts';
import { tick } from './tick.ts';
import { TROOPS, type Troop } from './troops.ts';
import { buildWorld } from './world/world.ts';

const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../data/map/map.json'), 'utf8')),
);
const world = buildWorld(map);
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
      expect(own[0]?.generalSkill).toBe(STARTING_GENERAL_SKILL);
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

  test('a map province id shaped like a counter id keeps the counter above it', () => {
    const renamed = structuredClone(map);
    const [first] = renamed.provinces;
    if (!first) throw new Error('the map has no provinces');
    const old = first.id;
    const id = 'city-99' as typeof old;
    first.id = id;
    for (const p of renamed.provinces) p.neighbours = p.neighbours.map((n) => (n === old ? id : n));
    const state = newGame(parseMap(renamed), { seed: 7, player: 'rome' });
    expect(loadGame(saveGame(state)).ok).toBe(true);
    expectConsistent(state);
  });

  test('365 ticks from the new game run with no broken link, through a war, a battle, and a siege', () => {
    let state = start();
    expect(state.wars).toEqual({});
    const declarations: Order[] = POWERS.flatMap((a, i) =>
      POWERS.slice(i + 1).map((b) => ({
        kind: 'declareWar' as const,
        faction: a as FactionId,
        against: b as FactionId,
      })),
    );
    const roman = Object.values(state.armies).find((army) => army.owner === 'rome');
    const punic = Object.values(state.armies).find((army) => army.owner === 'carthage');
    if (!roman || !punic || roman.activity.kind !== 'idle') throw new Error('missing armies');
    punic.activity = { kind: 'idle', position: { ...roman.activity.position } };
    let battleDays = 0;
    let siegeDays = 0;
    for (let day = 0; day < 365; day++) {
      state = tick(state, day === 0 ? declarations : [], world).state;
      if (Object.keys(state.battles).length > 0) battleDays += 1;
      if (Object.keys(state.sieges).length > 0) siegeDays += 1;
      expectConsistent(state);
    }
    expect(Object.keys(state.wars)).toHaveLength((POWERS.length * (POWERS.length - 1)) / 2);
    expect(battleDays).toBeGreaterThan(0);
    expect(siegeDays).toBeGreaterThan(0);
    expect(state.battles).toEqual({});
    expect(state.day).toBe(366);
    expectConsistent(state);
  });
});

describe('the economy of the new game meets its tuning targets', () => {
  const armyOf = (state: GameState, power: PowerId) => {
    const army = Object.values(state.armies).find((a) => a.owner === power);
    if (!army) throw new Error(`${power} has no army`);
    return army;
  };

  test('each faction starts with the stores of its kind and calm cities with no recruits', () => {
    const state = start();
    for (const faction of Object.values(state.factions)) {
      expect(faction.stores).toEqual(STARTING_STORES[faction.kind]);
    }
    for (const city of Object.values(state.cities)) {
      expect(city).toMatchObject({ unrestDays: 0, recruits: [] });
    }
    expectConsistent(state);
  });

  test('every city starts with the full walls, garrison, and food of its rank', () => {
    const state = start();
    const ranks = { capital: 0, greatPowerCity: 0, minorCity: 0 };
    for (const city of Object.values(state.cities)) {
      ranks[city.rank] += 1;
      expect(city).toMatchObject({ ...CITY_DEFENCES[city.rank], fellOn: null });
      expect(city.rank === 'minorCity').toBe(state.factions[city.owner]?.kind === 'minor');
    }
    expect(ranks.capital).toBe(POWERS.length);
    expect(ranks.greatPowerCity).toBeGreaterThan(0);
    expectConsistent(state);
  });

  test('a great power income keeps its starting army and about one more, and no more', () => {
    const state = start();
    for (const power of POWERS) {
      const upkeep = menOf(state, armyOf(state, power)) * UPKEEP_PER_MAN.gold;
      const income = (dailyBalances(state).get(power as FactionId)?.gold ?? 0) + upkeep;
      expect(income / upkeep).toBeGreaterThan(1.8);
      expect(income / upkeep).toBeLessThan(2.1);
    }
    expectConsistent(state);
  });

  test('after a year without recruiting a great power can pay for two to three formations', () => {
    let state = start();
    for (let day = 0; day < 365; day++) state = tick(state, [], world).state;
    for (const power of POWERS) {
      const stores = state.factions[power as FactionId]?.stores;
      if (!stores) throw new Error(`${power} is missing`);
      const { gold, men } = TROOPS.spearmen.recruit;
      const affordable = Math.min(stores.gold / gold, stores.manpower / men);
      expect(affordable).toBeGreaterThanOrEqual(2);
      expect(affordable).toBeLessThan(3);
    }
    const roma = state.cities['roma' as CityId]?.population ?? 0;
    expect(roma / 40_000).toBeCloseTo(1.02, 6);
    expectConsistent(state);
  });

  test('a minor state can keep a small army, a formation takes 10 to 30 days, unrest 60 to 120', () => {
    const state = start();
    for (const faction of Object.values(state.factions)) {
      if (faction.kind !== 'minor') continue;
      const gold = dailyBalances(state).get(faction.id)?.gold ?? 0;
      expect(gold / UPKEEP_PER_MAN.gold).toBeGreaterThanOrEqual(400);
    }
    for (const troop of Object.keys(TROOPS) as Troop[]) {
      expect(TROOPS[troop].recruit.days).toBeGreaterThanOrEqual(10);
      expect(TROOPS[troop].recruit.days).toBeLessThanOrEqual(30);
    }
    expect(UNREST_DAYS).toBeGreaterThanOrEqual(60);
    expect(UNREST_DAYS).toBeLessThanOrEqual(120);
    expectConsistent(state);
  });
});
