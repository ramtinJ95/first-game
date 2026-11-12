import { UNREST_DAYS } from '../cities.ts';
import type { DeepReadonly } from '../deep-readonly.ts';
import { allocateId, type FactionId } from '../ids.ts';
import type { Army } from '../state/army.ts';
import type { City } from '../state/city.ts';
import type { Stores } from '../state/faction.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { TROOPS } from '../troops.ts';

/** What one person of a calm city adds to the owner's stores each day. */
export const OUTPUT_PER_PERSON: Readonly<Stores> = {
  gold: 0.00035,
  food: 0.00035,
  manpower: 0.00008,
};
/** What one man under arms costs his owner each day. */
export const UPKEEP_PER_MAN = { gold: 0.01, food: 0.01 } as const;
/** The share of its output that a city produces on the first day of unrest. It rises evenly to 1. */
export const UNREST_OUTPUT = 0.25;
/**
 * The share of its men that each formation loses each day for each store, gold or
 * food, that its owner is short of. It rounds up, but the last man stays, so no
 * formation deserts to nothing.
 */
export const DESERTION = 0.01;
/** A recruit joins an idle army of its owner this close to the city, in kilometres. */
export const RALLY_DISTANCE = 10;

/**
 * Musters the formations whose training ends today, adds each city's output to its
 * owner, takes each army's upkeep, and makes armies desert while their owner is in debt.
 */
export function economy(state: GameState): void {
  muster(state);
  for (const [id, balance] of dailyBalances(state)) {
    const stores = state.factions[id]?.stores;
    if (!stores) continue;
    stores.gold += balance.gold;
    stores.food += balance.food;
    stores.manpower += balance.manpower;
  }
  desert(state);
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
  for (const city of Object.values(state.cities)) {
    const balance = of(city.owner);
    const people = city.population * outputShare(city);
    balance.gold += people * OUTPUT_PER_PERSON.gold;
    balance.food += people * OUTPUT_PER_PERSON.food;
    balance.manpower += people * OUTPUT_PER_PERSON.manpower;
  }
  for (const army of Object.values(state.armies)) {
    const balance = of(army.owner);
    const men = menOf(state, army);
    balance.gold -= men * UPKEEP_PER_MAN.gold;
    balance.food -= men * UPKEEP_PER_MAN.food;
  }
  return balances;
}

function outputShare(city: DeepReadonly<City>): number {
  return 1 - (1 - UNREST_OUTPUT) * (city.unrestDays / UNREST_DAYS);
}

export function menOf(state: DeepReadonly<GameState>, army: DeepReadonly<Army>): number {
  return army.formations.reduce((sum, id) => sum + (state.formations[id]?.men ?? 0), 0);
}

function muster(state: GameState) {
  for (const city of Object.values(state.cities)) {
    const ready = city.recruits.filter(({ readyOn }) => readyOn <= state.day);
    if (ready.length === 0) continue;
    city.recruits = city.recruits.filter(({ readyOn }) => readyOn > state.day);
    for (const { troop } of ready) {
      const army = rallyArmy(state, city);
      const id = allocateId(state, 'formation');
      state.formations[id] = {
        id,
        army: army.id,
        troop,
        men: TROOPS[troop].recruit.men,
        morale: 1,
      };
      army.formations.push(id);
    }
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
    formations: [],
    stance: 'holdTheLine',
    generalSkill: 0,
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
    for (const id of army.formations) {
      const formation = state.formations[id];
      if (!formation) continue;
      const deserters = Math.ceil(formation.men * DESERTION * shortages);
      formation.men -= Math.max(0, Math.min(deserters, formation.men - 1));
    }
  }
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
