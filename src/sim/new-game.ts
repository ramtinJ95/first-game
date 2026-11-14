import { nameNewArmy } from './army-names.ts';
import { allocateId, type CityId, type FactionId } from './ids.ts';
import { POWERS, type GameMap, type PowerId, type Province } from './map.ts';
import { serialOf } from './references.ts';
import { nextRandom, seedRng } from './rng.ts';
import type { CityRank } from './state/city.ts';
import type { Day } from './state/day.ts';
import type { FactionKind, Stores } from './state/faction.ts';
import type { GameState } from './state/game-state.ts';
import type { MapPoint } from './state/map-point.ts';
import { fullDefences } from './systems/sieges.ts';
import type { Troop } from './troops.ts';
import { goodAt } from './trade/goods.ts';

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

/** Starting population of a city by its rank. Its walls, garrison, and food are its `fullDefences`. */
export const STARTING_POPULATION: Readonly<Record<CityRank, number>> = {
  capital: 40_000,
  greatPowerCity: 15_000,
  minorCity: 12_000,
};

/**
 * The stores each faction starts with, by its kind. A minor starts able to raise its
 * cheapest troop and keep it for a year of war.
 */
export const STARTING_STORES: Readonly<Record<FactionKind, Readonly<Stores>>> = {
  greatPower: { gold: 1500, food: 600, manpower: 1000 },
  minor: { gold: 1200, food: 300, manpower: 500 },
};

/**
 * What sets a minor city apart, drawn for each from the seed with the chance `share`, so
 * a power's first conquest differs from game to game. A standing army fields a real army
 * from the first day, with stores to keep it two years. A rich and walled city has more
 * people, stronger walls, a larger granary, and gold to raise troops. A poor and open
 * one has few people, weak walls, and little food, so hunger takes it soon. A leagued city joins every war on its partner, the nearest
 * other leagued minor within LEAGUE_KM, and marches to lift its siege. A leagued city
 * left without a partner is a plain one.
 */
export const MINOR_KINDS: Readonly<
  Record<
    'standingArmy' | 'richAndWalled' | 'poorAndOpen' | 'leagued',
    {
      share: number;
      population: number;
      fortified: number;
      stores: Readonly<Stores>;
      army: readonly { troop: Troop; men: number }[];
    }
  >
> = {
  standingArmy: {
    share: 0.25,
    population: 12_000,
    fortified: 1,
    stores: { gold: 5000, food: 3600, manpower: 500 },
    army: [
      { troop: 'spearmen', men: 800 },
      { troop: 'skirmishers', men: 400 },
    ],
  },
  richAndWalled: {
    share: 0.2,
    population: 18_000,
    fortified: 1.5,
    stores: { gold: 3600, food: 600, manpower: 1000 },
    army: [],
  },
  poorAndOpen: {
    share: 0.25,
    population: 10_000,
    fortified: 0.5,
    stores: { gold: 600, food: 200, manpower: 300 },
    army: [],
  },
  leagued: {
    share: 0.3,
    population: STARTING_POPULATION.minorCity,
    fortified: 1,
    stores: STARTING_STORES.minor,
    army: [],
  },
};
export type MinorKind = keyof typeof MINOR_KINDS;
/**
 * A minor city farther than FRONTIER_KM from every great power's capital has guarded
 * itself, so it is drawn with FRONTIER_SHARES instead: more often a standing army or rich
 * and walled. A power whose hinterland lies far from its rivals, as Persia's does, then
 * meets more of its strength in its first conquests than in its later ones.
 */
export const FRONTIER_KM = 800;
export const FRONTIER_SHARES: Readonly<Record<MinorKind, number>> = {
  standingArmy: 0.45,
  richAndWalled: 0.35,
  poorAndOpen: 0.05,
  leagued: 0.15,
};
export const LEAGUE_KM = 600;

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
    peaceOffers: {},
    truces: {},
    tradeRoutes: {},
  };

  for (const power of POWERS) {
    const faction = power as FactionId;
    state.factions[faction] = {
      id: faction,
      name: POWER_NAMES[power],
      kind: 'greatPower',
      stores: { ...STARTING_STORES.greatPower },
      league: null,
      defeatedOn: null,
    };
    const capitals = map.provinces.filter((p) => p.owner === power && p.capital);
    const [capital] = capitals;
    if (!capital || capitals.length > 1) {
      throw new Error(`${power} needs exactly one capital on the map, found ${capitals.length}`);
    }
    addArmy(state, faction, STARTING_FORMATIONS, { x: capital.city[0], y: capital.city[1] });
  }

  const leagued: { faction: FactionId; position: MapPoint }[] = [];
  for (const province of map.provinces) {
    const city = province.id as string as CityId;
    let owner = province.owner as FactionId;
    const cityRank = rank(province);
    const position = { x: province.city[0], y: province.city[1] };
    let population = STARTING_POPULATION[cityRank];
    let fortified = 1;
    if (province.owner === 'independent') {
      owner = province.id as string as FactionId;
      if (Object.hasOwn(state.factions, owner)) {
        throw new Error(`independent province ${province.id} shares its id with a great power`);
      }
      const kind = drawMinorKind(state, remoteness(map, position));
      const traits = MINOR_KINDS[kind];
      ({ population, fortified } = traits);
      state.factions[owner] = {
        id: owner,
        name: province.name,
        kind: 'minor',
        stores: { ...traits.stores },
        league: null,
        defeatedOn: null,
      };
      if (traits.army.length > 0) addArmy(state, owner, traits.army, position);
      if (kind === 'leagued') leagued.push({ faction: owner, position });
    }
    state.provinces[province.id] = {
      id: province.id,
      name: province.name,
      city,
      good: goodAt(seed, province.owner, position),
    };
    state.cities[city] = {
      id: city,
      name: province.name,
      province: province.id,
      rank: cityRank,
      owner,
      position,
      population,
      unrestDays: 0,
      recruits: [],
      ...fullDefences({ rank: cityRank, fortified }),
      fortified,
      fellOn: null,
      sackedOn: null,
      buildings: [],
      construction: null,
    };
  }
  pairLeagues(state, leagued);

  return state;
}

function addArmy(
  state: GameState,
  owner: FactionId,
  troops: readonly { troop: Troop; men: number }[],
  position: MapPoint,
) {
  const army = allocateId(state, 'army');
  const formations = troops.map(({ troop, men }) => {
    const id = allocateId(state, 'formation');
    state.formations[id] = { id, army, troop, men, morale: 1 };
    return id;
  });
  state.armies[army] = {
    id: army,
    owner,
    name: nameNewArmy(state, owner),
    formations,
    stance: 'holdTheLine',
    generalSkill: STARTING_GENERAL_SKILL,
    activity: { kind: 'idle', position },
  };
}

/** The km from a point to the nearest great power's capital on the map. */
function remoteness(map: GameMap, at: MapPoint): number {
  let best = Number.POSITIVE_INFINITY;
  for (const province of map.provinces) {
    if (province.owner === 'independent' || !province.capital) continue;
    best = Math.min(best, Math.hypot(province.city[0] - at.x, province.city[1] - at.y));
  }
  return best;
}

function drawMinorKind(state: GameState, km: number): MinorKind {
  let roll = nextRandom(state);
  const far = km > FRONTIER_KM;
  const kinds = Object.keys(MINOR_KINDS) as MinorKind[];
  for (const kind of kinds) {
    roll -= far ? (FRONTIER_SHARES[kind] ?? 0) : MINOR_KINDS[kind].share;
    if (roll < 0) return kind;
  }
  return kinds[kinds.length - 1] as MinorKind;
}

/** Pairs each leagued minor, in map order, with the nearest one left unpaired within LEAGUE_KM. */
function pairLeagues(state: GameState, leagued: { faction: FactionId; position: MapPoint }[]) {
  const free = [...leagued];
  while (free.length > 0) {
    const first = free.shift() as (typeof free)[number];
    let best = -1;
    let bestKm = LEAGUE_KM;
    free.forEach((other, i) => {
      const km = Math.hypot(
        other.position.x - first.position.x,
        other.position.y - first.position.y,
      );
      if (km <= bestKm) {
        best = i;
        bestKm = km;
      }
    });
    if (best < 0) continue;
    const [partner] = free.splice(best, 1);
    const a = state.factions[first.faction];
    const b = partner && state.factions[partner.faction];
    if (a && b) {
      a.league = b.id;
      b.league = a.id;
    }
  }
}

function rank(province: Province): CityRank {
  if (province.owner === 'independent') return 'minorCity';
  return province.capital ? 'capital' : 'greatPowerCity';
}
