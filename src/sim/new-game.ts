import { allocateId, type CityId, type FactionId } from './ids.ts';
import { POWERS, type GameMap, type PowerId, type Province } from './map.ts';
import { serialOf } from './references.ts';
import { seedRng } from './rng.ts';
import type { Day } from './state/day.ts';
import type { GameState } from './state/game-state.ts';

export interface NewGameOptions {
  seed: number;
  player: PowerId;
}

const POWER_NAMES: Record<PowerId, string> = {
  rome: 'Rome',
  carthage: 'Carthage',
  macedon: 'Macedon',
  egypt: 'Egypt',
  persia: 'Persia',
};

/** Starting population of a city by its rank. The cities unit tunes these. */
export const STARTING_POPULATION = {
  capital: 40_000,
  greatPowerCity: 15_000,
  minorCity: 8_000,
} as const;

export const STARTING_FORMATIONS = [
  { troop: 'spearmen', men: 1200 },
  { troop: 'lightCavalry', men: 300 },
] as const;

/**
 * Builds the first day of a game from the static map. City ids are their province's
 * id, a minor faction's id is the id of the province of its one city, and armies and
 * formations take ids from the counter. The map stays outside the state.
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
  };

  for (const power of POWERS) {
    const faction = power as FactionId;
    state.factions[faction] = { id: faction, name: POWER_NAMES[power], kind: 'greatPower' };
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
      state.factions[owner] = { id: owner, name: province.name, kind: 'minor' };
    }
    state.provinces[province.id] = { id: province.id, name: province.name, city };
    state.cities[city] = {
      id: city,
      name: province.name,
      province: province.id,
      owner,
      position: { x: province.city[0], y: province.city[1] },
      population: STARTING_POPULATION[rank(province)],
    };
  }

  return state;
}

function rank(province: Province): keyof typeof STARTING_POPULATION {
  if (province.owner === 'independent') return 'minorCity';
  return province.capital ? 'capital' : 'greatPowerCity';
}
