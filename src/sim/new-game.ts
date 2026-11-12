import { allocateId, type CityId, type FactionId } from './ids.ts';
import { POWERS, type GameMap, type PowerId, type Province } from './map.ts';
import { serialOf } from './references.ts';
import { seedRng } from './rng.ts';
import type { CityRank } from './state/city.ts';
import type { Day } from './state/day.ts';
import type { FactionKind, Stores } from './state/faction.ts';
import type { GameState } from './state/game-state.ts';
import { CITY_DEFENCES } from './systems/sieges.ts';

export interface NewGameOptions {
  seed: number;
  player: PowerId;
}

export const POWER_NAMES: Readonly<Record<PowerId, string>> = {
  rome: 'Rome',
  carthage: 'Carthage',
  macedon: 'Macedon',
  egypt: 'Egypt',
  persia: 'Persia',
};

/** Starting population of a city by its rank. Its walls, garrison, and food are its rank's full `CITY_DEFENCES`. */
export const STARTING_POPULATION: Readonly<Record<CityRank, number>> = {
  capital: 40_000,
  greatPowerCity: 15_000,
  minorCity: 12_000,
};

/** The stores each faction starts with, by its kind. */
export const STARTING_STORES: Readonly<Record<FactionKind, Readonly<Stores>>> = {
  greatPower: { gold: 600, food: 600, manpower: 300 },
  minor: { gold: 100, food: 100, manpower: 100 },
};

/** Every power's starting general has this skill, on the 0 to 10 scale. */
export const STARTING_GENERAL_SKILL = 3;

export const STARTING_FORMATIONS = [
  { troop: 'spearmen', men: 1200 },
  { troop: 'lightCavalry', men: 300 },
] as const;

/**
 * Builds the first day of a game from the static map. City ids are their province's
 * id, a minor faction's id is the id of the province of its one city, and armies and
 * formations take ids from the counter. Every faction starts at peace. The map stays
 * outside the state.
 */
export function newGame(map: GameMap, { seed, player }: NewGameOptions): GameState {
  if (!(POWERS as readonly string[]).includes(player)) {
    throw new Error(`unknown player ${player}, expected one of ${POWERS.join(', ')}`);
  }
  const state: GameState = {
    day: 1 as Day,
    rng: seedRng(seed),
    nextSerial: 1 + Math.max(0, ...map.provinces.map(({ id }) => serialOf(id) ?? 0)),
    player: player as FactionId,
    factions: {},
    provinces: {},
    cities: {},
    armies: {},
    formations: {},
    convoys: {},
    refugeeColumns: {},
    battles: {},
    sieges: {},
    wars: {},
  };

  for (const power of POWERS) {
    const faction = power as FactionId;
    state.factions[faction] = {
      id: faction,
      name: POWER_NAMES[power],
      kind: 'greatPower',
      stores: { ...STARTING_STORES.greatPower },
      defeatedOn: null,
    };
    const capitals = map.provinces.filter((p) => p.owner === power && p.capital);
    const [capital] = capitals;
    if (!capital || capitals.length > 1) {
      throw new Error(`${power} needs exactly one capital on the map, found ${capitals.length}`);
    }
    const army = allocateId(state, 'army');
    const formations = STARTING_FORMATIONS.map(({ troop, men }) => {
      const id = allocateId(state, 'formation');
      state.formations[id] = { id, army, troop, men, morale: 1 };
      return id;
    });
    state.armies[army] = {
      id: army,
      owner: faction,
      formations,
      stance: 'holdTheLine',
      generalSkill: STARTING_GENERAL_SKILL,
      activity: { kind: 'idle', position: { x: capital.city[0], y: capital.city[1] } },
    };
  }

  for (const province of map.provinces) {
    const city = province.id as string as CityId;
    let owner = province.owner as FactionId;
    if (province.owner === 'independent') {
      owner = province.id as string as FactionId;
      if (Object.hasOwn(state.factions, owner)) {
        throw new Error(`independent province ${province.id} shares its id with a great power`);
      }
      state.factions[owner] = {
        id: owner,
        name: province.name,
        kind: 'minor',
        stores: { ...STARTING_STORES.minor },
        defeatedOn: null,
      };
    }
    state.provinces[province.id] = { id: province.id, name: province.name, city };
    const cityRank = rank(province);
    state.cities[city] = {
      id: city,
      name: province.name,
      province: province.id,
      rank: cityRank,
      owner,
      position: { x: province.city[0], y: province.city[1] },
      population: STARTING_POPULATION[cityRank],
      unrestDays: 0,
      recruits: [],
      ...CITY_DEFENCES[cityRank],
      fellOn: null,
    };
  }

  return state;
}

function rank(province: Province): CityRank {
  if (province.owner === 'independent') return 'minorCity';
  return province.capital ? 'capital' : 'greatPowerCity';
}
