import type { ArmyId, CityId, FactionId, FormationId, ProvinceId } from './ids.ts';
import { seedRng } from './rng.ts';
import type { Day } from './state/day.ts';
import type { GameState } from './state/game-state.ts';

/** The ids in the fixture, so tests can name its records. */
export const FIXTURE = {
  rome: 'rome' as FactionId,
  carthage: 'carthage' as FactionId,
  latium: 'latium' as ProvinceId,
  campania: 'campania' as ProvinceId,
  africa: 'africa' as ProvinceId,
  roma: 'roma' as CityId,
  capua: 'capua' as CityId,
  carthago: 'carthago' as CityId,
  romanArmy: 'army-roman' as ArmyId,
  punicArmy: 'army-punic' as ArmyId,
  hastati: 'formation-hastati' as FormationId,
  equites: 'formation-equites' as FormationId,
  citizenSpears: 'formation-citizen-spears' as FormationId,
} as const;

/**
 * A tiny valid game: Rome holds Latium and Campania, Carthage holds Africa, and each
 * side has one idle army. Every call returns a fresh copy.
 */
export function buildFixture(seed = 1): GameState {
  const f = FIXTURE;
  return {
    day: 1 as Day,
    rng: seedRng(seed),
    nextSerial: 1,
    player: f.rome,
    factions: {
      [f.rome]: { id: f.rome, name: 'Rome' },
      [f.carthage]: { id: f.carthage, name: 'Carthage' },
    },
    provinces: {
      [f.latium]: { id: f.latium, name: 'Latium', city: f.roma },
      [f.campania]: { id: f.campania, name: 'Campania', city: f.capua },
      [f.africa]: { id: f.africa, name: 'Africa', city: f.carthago },
    },
    cities: {
      [f.roma]: {
        id: f.roma,
        name: 'Roma',
        province: f.latium,
        owner: f.rome,
        position: { x: 1240, y: 610 },
        population: 40_000,
      },
      [f.capua]: {
        id: f.capua,
        name: 'Capua',
        province: f.campania,
        owner: f.rome,
        position: { x: 1300, y: 660 },
        population: 18_000,
      },
      [f.carthago]: {
        id: f.carthago,
        name: 'Carthago',
        province: f.africa,
        owner: f.carthage,
        position: { x: 1150, y: 900 },
        population: 50_000,
      },
    },
    armies: {
      [f.romanArmy]: {
        id: f.romanArmy,
        owner: f.rome,
        formations: [f.hastati, f.equites],
        stance: 'holdTheLine',
        activity: { kind: 'idle', position: { x: 1245, y: 615 } },
      },
      [f.punicArmy]: {
        id: f.punicArmy,
        owner: f.carthage,
        formations: [f.citizenSpears],
        stance: 'holdTheLine',
        activity: { kind: 'idle', position: { x: 1155, y: 895 } },
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
  };
}
