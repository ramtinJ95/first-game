import { extraFoodOf, goldShareOf, levyShareOf } from '../buildings/buildings.ts';
import { nameNewArmy } from '../army-names.ts';
import { SACK, UNREST_DAYS } from '../cities.ts';
import type { DeepReadonly } from '../deep-readonly.ts';
import { emit } from '../events.ts';
import { allocateId, type FactionId } from '../ids.ts';
import { STARTING_GENERAL_SKILL } from '../new-game.ts';
import type { Army } from '../state/army.ts';
import type { City } from '../state/city.ts';
import type { Stores } from '../state/faction.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { removeRecord } from '../records.ts';
import { TROOPS } from '../troops.ts';

/** What one person of a calm city adds to the owner's stores each day. */
export const OUTPUT_PER_PERSON: Readonly<Stores> = {
  gold: 0.00042,
  food: 0.0006,
  manpower: 0.0001,
};
/** The food one person of a city eats each day, in unrest or not. */
export const FOOD_PER_PERSON = 0.0004;
/** What one man under arms costs his owner each day. */
export const UPKEEP_PER_MAN = { gold: 0.01, food: 0.006 } as const;
/**
 * A faction's treasury holds this many days of the gold its people pay at full. More is
 * spent by the court, so an idle realm does not pile gold up without end.
 */
export const TREASURY_DAYS = 240;
/** A faction's granaries hold this many days of what its people and its men eat. More spoils. */
export const GRANARY_DAYS = 90;
/**
 * A faction can call up at most this share of its people, counting the men already under
 * arms and in training. The rest stay on the land.
 */
export const MANPOWER_SHARE = 0.05;
/**
 * The share of its gold and manpower that a city yields while more than UNREST_DAYS of unrest
 * are left. It rises evenly to 1 over the last UNREST_DAYS.
 */
export const UNREST_OUTPUT = 0.25;
/**
 * The share of its men that each formation loses each day for each store, gold or
 * food, that its owner is short of. It rounds up, but the last man stays, so no
 * formation deserts to nothing.
 */
export const DESERTION = 0.01;
/**
 * A realm of more than ADMIN_CITIES cities governs each less well: each of its cities
 * yields (ADMIN_CITIES / cities) ** ADMIN_EXPONENT of its gold and manpower, so a
 * realm's income grows ever more slowly with its size.
 */
export const ADMIN_CITIES = 8;
export const ADMIN_EXPONENT = 0.75;
/** A recruit joins an idle army of its owner this close to the city, in kilometres. */
export const RALLY_DISTANCE = 10;

/**
 * Gathers the idle armies that stand together at a city of their owner into one, musters the formations whose training ends today, adds each city's output to its
 * owner less the food its people eat, takes each army's upkeep, and makes armies desert
 * while their owner is in debt. Food and manpower grow only up to the faction's limits.
 */
export function economy(state: GameState): void {
  gather(state);
  muster(state);
  const limits = limitsOf(state);
  for (const [id, balance] of dailyBalances(state)) {
    const stores = state.factions[id]?.stores;
    const limit = limits.get(id);
    if (!stores || !limit) continue;
    stores.gold = fill(stores.gold, balance.gold, limit.gold);
    stores.food = fill(stores.food, balance.food, limit.food);
    stores.manpower = fill(stores.manpower, balance.manpower, limit.manpower);
  }
  desert(state);
}

/** A gain stops at the limit, and a store already above it keeps what it has. */
function fill(store: number, change: number, limit: number): number {
  if (change <= 0) return store + change;
  return Math.max(store, Math.min(limit, store + change));
}

/**
 * The most gold, food, and manpower each faction can hold: TREASURY_DAYS of the gold its
 * people pay at full, GRANARY_DAYS of what its people and its men eat, and MANPOWER_SHARE of its people less its men under arms and in
 * training, so a large army leaves few men to call up.
 */
export function limitsOf(state: DeepReadonly<GameState>): Map<FactionId, Stores> {
  const limits = new Map<FactionId, Stores>();
  const of = (faction: FactionId) => {
    let limit = limits.get(faction);
    if (!limit) {
      limit = { gold: 0, food: 0, manpower: 0 };
      limits.set(faction, limit);
    }
    return limit;
  };
  for (const faction of Object.keys(state.factions) as FactionId[]) of(faction);
  for (const city of Object.values(state.cities)) {
    const limit = of(city.owner);
    limit.gold += TREASURY_DAYS * city.population * OUTPUT_PER_PERSON.gold;
    limit.food += GRANARY_DAYS * city.population * FOOD_PER_PERSON;
    limit.manpower += MANPOWER_SHARE * city.population * levyShareOf(city);
    for (const recruit of city.recruits) limit.manpower -= TROOPS[recruit.troop].recruit.men;
  }
  for (const army of Object.values(state.armies)) {
    const men = menOf(state, army);
    const limit = of(army.owner);
    limit.food += GRANARY_DAYS * men * UPKEEP_PER_MAN.food;
    limit.manpower -= men;
  }
  return limits;
}

/** Each faction's income less its upkeep for one day, with the state as it stands. */
export function dailyBalances(state: DeepReadonly<GameState>): Map<FactionId, Stores> {
  const balances = new Map<FactionId, Stores>();
  const of = (faction: FactionId) => {
    let balance = balances.get(faction);
    if (!balance) {
      balance = { gold: 0, food: 0, manpower: 0 };
      balances.set(faction, balance);
    }
    return balance;
  };
  for (const faction of Object.keys(state.factions) as FactionId[]) of(faction);
  const governed = adminShares(state);
  for (const city of Object.values(state.cities)) {
    const balance = of(city.owner);
    const people = city.population * outputShare(city);
    const admin = governed.get(city.owner) ?? 1;
    balance.gold += people * OUTPUT_PER_PERSON.gold * goldShare(state, city) * admin;
    balance.food +=
      city.population * (OUTPUT_PER_PERSON.food - FOOD_PER_PERSON) + extraFoodOf(city);
    balance.manpower += people * OUTPUT_PER_PERSON.manpower * levyShareOf(city) * admin;
  }
  for (const army of Object.values(state.armies)) {
    const balance = of(army.owner);
    const men = menOf(state, army);
    balance.gold -= men * UPKEEP_PER_MAN.gold;
    balance.food -= men * UPKEEP_PER_MAN.food;
  }
  return balances;
}

/** The share of its gold and manpower each city of a faction yields for the realm's size. */
function adminShares(state: DeepReadonly<GameState>): Map<FactionId, number> {
  const cities = new Map<FactionId, number>();
  for (const city of Object.values(state.cities)) {
    cities.set(city.owner, (cities.get(city.owner) ?? 0) + 1);
  }
  const shares = new Map<FactionId, number>();
  for (const [faction, count] of cities) shares.set(faction, adminShare(count));
  return shares;
}

/** The share of its gold and manpower each city yields in a realm of this many cities. */
function adminShare(cities: number): number {
  return Math.min(1, ADMIN_CITIES / cities) ** ADMIN_EXPONENT;
}

/**
 * The share of its gold and manpower each city of the faction yields for the size of its
 * realm, for a panel that shows one city's output.
 */
export function adminShareOf(state: DeepReadonly<GameState>, faction: FactionId): number {
  return adminShare(Object.values(state.cities).filter((city) => city.owner === faction).length);
}

function goldShare(state: DeepReadonly<GameState>, city: DeepReadonly<City>): number {
  const poor = city.sackedOn !== null && state.day - city.sackedOn < SACK.poorDays;
  return (poor ? SACK.poorOutput : 1) * goldShareOf(city);
}

function outputShare(city: DeepReadonly<City>): number {
  return 1 - (1 - UNREST_OUTPUT) * Math.min(1, city.unrestDays / UNREST_DAYS);
}

export function menOf(state: DeepReadonly<GameState>, army: DeepReadonly<Army>): number {
  return army.formations.reduce((sum, id) => sum + (state.formations[id]?.men ?? 0), 0);
}

/**
 * Idle armies of one owner that stand within RALLY_DISTANCE of one of its cities form one
 * army, the one with the lowest id, under the best of their generals. So a power that
 * gathers at its muster city marches and sails as one army, and a remnant that comes home
 * joins the army there.
 */
function gather(state: GameState) {
  for (const city of Object.values(state.cities)) {
    const [base, ...rest] = Object.values(state.armies)
      .filter(
        (army) =>
          army.owner === city.owner &&
          army.activity.kind === 'idle' &&
          distance(army.activity.position, city.position) <= RALLY_DISTANCE,
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!base) continue;
    for (const army of rest) {
      for (const id of army.formations) {
        const formation = state.formations[id];
        if (formation) formation.army = base.id;
      }
      base.formations.push(...army.formations);
      base.generalSkill = Math.max(base.generalSkill, army.generalSkill);
      removeRecord(state.armies, army.id);
    }
  }
}

function muster(state: GameState) {
  for (const city of Object.values(state.cities)) musterReady(state, city, state.day);
}

/**
 * Musters at once every recruit the city trains, at full strength, as the besieged
 * city's defence. They join the idle army of its owner at the city, or a new one there.
 */
export function musterEarly(state: GameState, city: City): void {
  musterReady(state, city, Number.POSITIVE_INFINITY);
}

function musterReady(state: GameState, city: City, until: number) {
  const ready = city.recruits.filter(({ readyOn }) => readyOn <= until);
  if (ready.length === 0) return;
  city.recruits = city.recruits.filter(({ readyOn }) => readyOn > until);
  for (const { troop } of ready) {
    const army = rallyArmy(state, city);
    const id = allocateId(state, 'formation');
    state.formations[id] = { id, army: army.id, troop, men: TROOPS[troop].recruit.men, morale: 1 };
    army.formations.push(id);
  }
}

/** The idle army of the city's owner at the city with the lowest id, or a new one there. */
function rallyArmy(state: GameState, city: City): Army {
  const [present] = Object.values(state.armies)
    .filter(
      (army) =>
        army.owner === city.owner &&
        army.activity.kind === 'idle' &&
        distance(army.activity.position, city.position) <= RALLY_DISTANCE,
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (present) return present;
  const id = allocateId(state, 'army');
  const army: Army = {
    id,
    owner: city.owner,
    name: nameNewArmy(state, city.owner),
    formations: [],
    stance: 'holdTheLine',
    generalSkill: STARTING_GENERAL_SKILL,
    activity: { kind: 'idle', position: { x: city.position.x, y: city.position.y } },
  };
  state.armies[id] = army;
  return army;
}

function desert(state: GameState) {
  for (const army of Object.values(state.armies)) {
    const stores = state.factions[army.owner]?.stores;
    if (!stores) continue;
    const shortages = Number(stores.gold < 0) + Number(stores.food < 0);
    if (shortages === 0) continue;
    let men = 0;
    for (const id of army.formations) {
      const formation = state.formations[id];
      if (!formation) continue;
      const deserters = Math.max(
        0,
        Math.min(Math.ceil(formation.men * DESERTION * shortages), formation.men - 1),
      );
      formation.men -= deserters;
      men += deserters;
    }
    const { activity } = army;
    const position =
      activity.kind === 'embarked' ? state.convoys[activity.convoy]?.position : activity.position;
    if (men > 0 && position) {
      emit(state, { kind: 'armyDeserted', army: army.id, owner: army.owner, position, men });
    }
  }
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
