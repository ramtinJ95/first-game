import { leaveSiege, removeArmy } from '../armies.ts';
import { changeCityOwner } from '../cities.ts';
import type { FactionId, SiegeId } from '../ids.ts';
import { allocateId } from '../ids.ts';
import { removeRecord } from '../records.ts';
import { nextRandom } from '../rng.ts';
import type { Army } from '../state/army.ts';
import type { City, CityRank } from '../state/city.ts';
import type { Formation } from '../state/formation.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import type { Siege } from '../state/siege.ts';
import { TROOPS } from '../troops.ts';
import { areAtWar } from '../wars.ts';

/** An idle army this close to a city of a faction it is at war with, in kilometres, besieges it. */
export const SIEGE_DISTANCE = 10;

/** A city's full walls, garrison, and food reserve in days, by its rank. */
export const CITY_DEFENCES: Readonly<
  Record<CityRank, Readonly<Pick<City, 'walls' | 'garrison' | 'foodDays'>>>
> = {
  capital: { walls: 400, garrison: 2500, foodDays: 150 },
  greatPowerCity: { walls: 200, garrison: 1000, foodDays: 60 },
  minorCity: { walls: 100, garrison: 500, foodDays: 30 },
};

/** Points of wall that each thousand besieging men wear down a day. */
export const WALL_WEAR_PER_THOUSAND_MEN = 2;
/** The share of its full garrison that a city without food loses to hunger each day, rounded up. */
export const HUNGER_SHARE = 0.05;
/** The chance each day that the garrison of a city whose walls are down gives up. */
export const GIVE_UP_CHANCE = 0.1;
/** Walls, garrison, and food of a city not under siege regain a share of their full value each day: one over this. */
export const RECOVERY_DAYS = 120;

/** Each point of wall adds this share to the garrison's strength against a storm. */
export const WALL_DEFENCE = 0.01;
/** Each draw scales a storm's attack or its cost by a factor in [1 - STORM_LUCK, 1 + STORM_LUCK). */
export const STORM_LUCK = 0.25;
/** Attackers lost per point of the defence's strength, in any storm. */
export const STORM_KILL = 0.2;
/** Garrison lost per point of the attack's strength, in a storm that fails. */
export const STORM_GARRISON_KILL = 0.1;
/** Morale each storming formation loses when a storm fails. */
export const STORM_MORALE_LOSS = 0.3;

/**
 * Lets besiegers leave whose owner is short of gold or food or no longer at war with
 * the city, starts or joins sieges, plays one day of every siege, and lets the cities
 * that are not besieged recover.
 */
export function sieges(state: GameState): void {
  liftSieges(state);
  beginSieges(state);
  for (const siege of sortedValues(state.sieges)) besiegeOneDay(state, siege.id);
  recover(state);
}

function liftSieges(state: GameState) {
  for (const army of sortedValues(state.armies)) {
    if (army.activity.kind !== 'besieging') continue;
    const siege = state.sieges[army.activity.siege];
    const city = siege && state.cities[siege.city];
    if (!city || !canBesiege(state, army) || !areAtWar(state, army.owner, city.owner)) {
      leaveSiege(state, army);
    }
  }
}

function beginSieges(state: GameState) {
  for (const army of sortedValues(state.armies)) {
    const { activity } = army;
    if (activity.kind !== 'idle' || !canBesiege(state, army)) continue;
    const city = nearestEnemyCity(state, army, activity.position);
    if (!city) continue;
    let siege = siegeAt(state, city);
    if (!siege) {
      const id = allocateId(state, 'siege');
      siege = { id, city: city.id, besiegers: [], startedOn: state.day };
      state.sieges[id] = siege;
    }
    siege.besiegers.push(army.id);
    army.activity = { kind: 'besieging', position: activity.position, siege: siege.id };
  }
}

function nearestEnemyCity(state: GameState, army: Army, from: MapPoint): City | undefined {
  let best: City | undefined;
  for (const city of sortedValues(state.cities)) {
    if (!areAtWar(state, army.owner, city.owner)) continue;
    const d = distance(from, city.position);
    if (d <= SIEGE_DISTANCE && (!best || d < distance(from, best.position))) best = city;
  }
  return best;
}

/**
 * The food goes first, a day at a time. Then hunger takes a share of the full garrison
 * each day. The walls wear down by the besiegers' numbers. The city falls when its
 * garrison is gone, or, once its walls are down, when the garrison gives up.
 */
function besiegeOneDay(state: GameState, id: SiegeId) {
  const siege = state.sieges[id];
  if (!siege) return;
  const city = state.cities[siege.city];
  if (!city || siege.besiegers.length === 0) {
    removeRecord(state.sieges, id);
    return;
  }
  const men = siege.besiegers.reduce((sum, armyId) => {
    const army = state.armies[armyId];
    return sum + (army ? menOf(state, army) : 0);
  }, 0);
  city.walls = Math.max(0, city.walls - (men / 1000) * WALL_WEAR_PER_THOUSAND_MEN);
  if (city.foodDays > 0) {
    city.foodDays = Math.max(0, city.foodDays - 1);
  } else {
    const hunger = Math.ceil(CITY_DEFENCES[city.rank].garrison * HUNGER_SHARE);
    city.garrison = Math.max(0, city.garrison - hunger);
  }
  if (city.garrison === 0 || (city.walls === 0 && nextRandom(state) < GIVE_UP_CHANCE)) {
    cityFalls(state, siege);
  }
}

function recover(state: GameState) {
  const besieged = new Set(Object.values(state.sieges).map((siege) => siege.city));
  for (const city of Object.values(state.cities)) {
    if (besieged.has(city.id)) continue;
    const full = CITY_DEFENCES[city.rank];
    city.walls = Math.min(full.walls, city.walls + full.walls / RECOVERY_DAYS);
    city.garrison = Math.min(
      full.garrison,
      city.garrison + Math.ceil(full.garrison / RECOVERY_DAYS),
    );
    city.foodDays = Math.min(full.foodDays, city.foodDays + full.foodDays / RECOVERY_DAYS);
  }
}

/**
 * Ends the siege with the city's fall: the besiegers stand idle where they are, the
 * garrison is gone, and the city goes, with its fate open, to the faction of the
 * besieger that has stood there longest, whoever took the walls.
 */
export function cityFalls(state: GameState, siege: Siege): void {
  const [longest] = siege.besiegers;
  const winner = longest === undefined ? undefined : state.armies[longest]?.owner;
  for (const armyId of siege.besiegers) {
    const army = state.armies[armyId];
    if (army) leaveSiege(state, army);
  }
  removeRecord(state.sieges, siege.id);
  const city = state.cities[siege.city];
  if (!city || winner === undefined) return;
  city.garrison = 0;
  changeCityOwner(state, city.id, winner);
  city.fellOn = state.day;
}

export type StormResult = 'taken' | 'repulsed';

/**
 * Sends the faction's besieging armies at the walls. The attackers lose men in
 * proportion to the strength of the defence, which is the garrison raised by the walls
 * left. The storm takes the city if the attack, with luck, beats that strength.
 * Otherwise the garrison loses men in proportion to the attack, every storming
 * formation loses morale, and the siege goes on. The caller checks that an army of the
 * faction in the siege `canBesiege`.
 */
export function stormCity(state: GameState, siege: Siege, faction: FactionId): StormResult {
  const city = state.cities[siege.city];
  if (!city) throw new Error(`siege ${siege.id} is at unknown city ${siege.city}`);
  const stormers = siege.besiegers.flatMap((id) => {
    const army = state.armies[id];
    return army && army.owner === faction ? [army] : [];
  });
  const fighters = stormers.flatMap((army) => formationsOf(state, army).filter(isFighting));
  const men = fighters.reduce((sum, formation) => sum + formation.men, 0);
  const attack = fighters.reduce((sum, f) => sum + f.men * TROOPS[f.troop].attack, 0) * luck(state);
  const defence = city.garrison * (1 + city.walls * WALL_DEFENCE);
  const lost = Math.min(men, Math.round(defence * STORM_KILL * luck(state)));
  const taken = attack > defence;

  for (const formation of fighters) {
    formation.men -= Math.min(formation.men, Math.round((lost * formation.men) / men));
    if (!taken) formation.morale = Math.max(0, formation.morale - STORM_MORALE_LOSS);
  }
  for (const army of stormers) {
    army.formations = army.formations.filter((id) => {
      const formation = state.formations[id];
      if (formation && formation.men > 0) return true;
      removeRecord(state.formations, id);
      return false;
    });
    if (army.formations.length === 0) removeArmy(state, army, 'storm');
  }
  if (taken) {
    cityFalls(state, siege);
    return 'taken';
  }
  city.garrison -= Math.min(city.garrison, Math.round(attack * STORM_GARRISON_KILL));
  return 'repulsed';
}

/** The siege at the city, if one runs. A city has at most one. */
export function siegeAt(state: GameState, city: City): Siege | undefined {
  return Object.values(state.sieges).find((siege) => siege.city === city.id);
}

/**
 * An army can begin, keep, or storm a siege while it has an unbroken formation and its
 * owner's gold and food are not below zero.
 */
export function canBesiege(state: GameState, army: Army): boolean {
  const stores = state.factions[army.owner]?.stores;
  if (!stores || stores.gold < 0 || stores.food < 0) return false;
  return formationsOf(state, army).some(isFighting);
}

function luck(state: GameState): number {
  return 1 + STORM_LUCK * (2 * nextRandom(state) - 1);
}

export function formationsOf(state: GameState, army: Army): Formation[] {
  return army.formations.flatMap((id) => state.formations[id] ?? []);
}

export function isFighting(formation: Formation): boolean {
  return formation.men > 0 && formation.morale > 0;
}

function menOf(state: GameState, army: Army): number {
  return formationsOf(state, army).reduce((sum, formation) => sum + formation.men, 0);
}

function sortedValues<V extends { id: string }>(records: Record<string, V>): V[] {
  return Object.values(records).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
