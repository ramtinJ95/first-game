import mapData from '../../data/map/map.json' with { type: 'json' };
import type { ArmyId, CityId, FactionId, FormationId, ProvinceId } from './ids.ts';
import { parseMap } from './map.ts';
import { seedRng } from './rng.ts';
import type { Day } from './state/day.ts';
import type { GameState } from './state/game-state.ts';
import { buildWorld, type World } from './world/world.ts';

let world: World | undefined;

/** The world built from the committed map, built once per test file. */
export function fixtureWorld(): World {
  world ??= buildWorld(parseMap(mapData));
  return world;
}
import { CITY_DEFENCES } from './systems/sieges.ts';

/** The ids in the fixture, so tests can name its records. */
export const FIXTURE = {
  rome: 'rome' as FactionId,
  carthage: 'carthage' as FactionId,
  latium: 'latium' as ProvinceId,
  campania: 'campania' as ProvinceId,
  africa: 'africa' as ProvinceId,
  sicilia: 'sicilia' as ProvinceId,
  syracusaeFaction: 'syracusae' as FactionId,
  roma: 'roma' as CityId,
  capua: 'capua' as CityId,
  carthago: 'carthago' as CityId,
  syracusae: 'syracusae' as CityId,
  romanArmy: 'army-roman' as ArmyId,
  punicArmy: 'army-punic' as ArmyId,
  hastati: 'formation-hastati' as FormationId,
  equites: 'formation-equites' as FormationId,
  citizenSpears: 'formation-citizen-spears' as FormationId,
} as const;

/**
 * A tiny valid game on the committed map: Rome holds Latium and Campania, Carthage
 * holds Africa, the minor Syracusae holds Sicily, and Rome and Carthage each have one
 * idle army beside their capital. The cities stand where the map puts them, each
 * with its rank's full defences. Nobody is at war. Every call returns a fresh copy.
 */
export function buildFixture(seed = 1): GameState {
  const f = FIXTURE;
  return {
    day: 1 as Day,
    rng: seedRng(seed),
    nextSerial: 1,
    player: f.rome,
    factions: {
      [f.rome]: {
        id: f.rome,
        name: 'Rome',
        kind: 'greatPower',
        stores: { gold: 5000, food: 1000, manpower: 2000 },
        defeatedOn: null,
      },
      [f.carthage]: {
        id: f.carthage,
        name: 'Carthage',
        kind: 'greatPower',
        stores: { gold: 3000, food: 1000, manpower: 1000 },
        defeatedOn: null,
      },
      [f.syracusaeFaction]: {
        id: f.syracusaeFaction,
        name: 'Syracusae',
        kind: 'minor',
        stores: { gold: 100, food: 100, manpower: 100 },
        defeatedOn: null,
      },
    },
    provinces: {
      [f.latium]: { id: f.latium, name: 'Latium', city: f.roma },
      [f.campania]: { id: f.campania, name: 'Campania', city: f.capua },
      [f.africa]: { id: f.africa, name: 'Africa', city: f.carthago },
      [f.sicilia]: { id: f.sicilia, name: 'Sicilia', city: f.syracusae },
    },
    cities: {
      [f.roma]: {
        id: f.roma,
        name: 'Roma',
        province: f.latium,
        rank: 'capital',
        owner: f.rome,
        position: { x: 2511.3, y: 2335.8 },
        population: 40_000,
        unrestDays: 0,
        recruits: [],
        ...CITY_DEFENCES.capital,
        fellOn: null,
        sackedOn: null,
      },
      [f.capua]: {
        id: f.capua,
        name: 'Capua',
        province: f.campania,
        rank: 'greatPowerCity',
        owner: f.rome,
        position: { x: 2638.8, y: 2448.3 },
        population: 18_000,
        unrestDays: 0,
        recruits: [],
        ...CITY_DEFENCES.greatPowerCity,
        fellOn: null,
        sackedOn: null,
      },
      [f.carthago]: {
        id: f.carthago,
        name: 'Carthago',
        province: f.africa,
        rank: 'capital',
        owner: f.carthage,
        position: { x: 2229.9, y: 2865.1 },
        population: 50_000,
        unrestDays: 0,
        recruits: [],
        ...CITY_DEFENCES.capital,
        fellOn: null,
        sackedOn: null,
      },
      [f.syracusae]: {
        id: f.syracusae,
        name: 'Syracusae',
        province: f.sicilia,
        rank: 'minorCity',
        owner: f.syracusaeFaction,
        position: { x: 2661.2, y: 2911.3 },
        population: 8_000,
        unrestDays: 0,
        recruits: [],
        ...CITY_DEFENCES.minorCity,
        fellOn: null,
        sackedOn: null,
      },
    },
    armies: {
      [f.romanArmy]: {
        id: f.romanArmy,
        owner: f.rome,
        formations: [f.hastati, f.equites],
        stance: 'holdTheLine',
        generalSkill: 3,
        activity: { kind: 'idle', position: { x: 2516.3, y: 2340.8 } },
      },
      [f.punicArmy]: {
        id: f.punicArmy,
        owner: f.carthage,
        formations: [f.citizenSpears],
        stance: 'holdTheLine',
        generalSkill: 3,
        activity: { kind: 'idle', position: { x: 2224.9, y: 2870.1 } },
      },
    },
    formations: {
      [f.hastati]: { id: f.hastati, army: f.romanArmy, troop: 'spearmen', men: 1200, morale: 1 },
      [f.equites]: { id: f.equites, army: f.romanArmy, troop: 'lightCavalry', men: 300, morale: 1 },
      [f.citizenSpears]: {
        id: f.citizenSpears,
        army: f.punicArmy,
        troop: 'spearmen',
        men: 1500,
        morale: 0.9,
      },
    },
    convoys: {},
    refugeeColumns: {},
    battles: {},
    sieges: {},
    wars: {},
  };
}
