import type { DeepReadonly } from '../deep-readonly.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { Army } from '../state/army.ts';
import type { City } from '../state/city.ts';
import type { Formation } from '../state/formation.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { warSides } from '../state/war.ts';
import { GENERAL_EFFECT } from '../systems/battles.ts';
import { WALL_DEFENCE, STORM_KILL, STORM_LUCK } from '../systems/sieges.ts';
import { dailyBalances, UPKEEP_PER_MAN } from '../systems/economy.ts';
import type { Stores } from '../state/faction.ts';
import { TROOPS } from '../troops.ts';
import { connected, distance } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import { RESERVE_DAYS } from './thresholds.ts';

export type State = DeepReadonly<GameState>;
export type ArmyView = DeepReadonly<Army>;
export type CityView = DeepReadonly<City>;
type FormationView = DeepReadonly<Formation>;

const sortings = new WeakMap<object, readonly unknown[]>();

/**
 * The records of a collection in id order. Every faction reads the same collections each
 * day, so this order, each faction's enemies, and each army's strength are kept per
 * record object. That is sound because the AI only reads states, and a state is frozen
 * once a tick returns it.
 */
export function sorted<V extends { readonly id: string }>(
  records: Readonly<Record<string, V>>,
): readonly V[] {
  let order = sortings.get(records) as readonly V[] | undefined;
  if (!order) {
    order = Object.values(records).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    sortings.set(records, order);
  }
  return order;
}

export function formationsOf(state: State, army: ArmyView): FormationView[] {
  return army.formations.flatMap((id) => state.formations[id] ?? []);
}

export function isFighting(formation: FormationView): boolean {
  return formation.men > 0 && formation.morale > 0;
}

export function canFight(state: State, army: ArmyView): boolean {
  return formationsOf(state, army).some(isFighting);
}

export function meanMorale(state: State, army: ArmyView): number {
  const formations = formationsOf(state, army);
  const men = formations.reduce((sum, f) => sum + f.men, 0);
  return men === 0 ? 0 : formations.reduce((sum, f) => sum + f.men * f.morale, 0) / men;
}

/**
 * What an army weighs in a battle: each unbroken formation's men, times the mean of
 * its attack and defence, times its morale, raised by the general.
 */
const strengths = new WeakMap<object, WeakMap<ArmyView, number>>();

export function strengthOf(state: State, army: ArmyView): number {
  let ofState = strengths.get(state.formations);
  if (!ofState) {
    ofState = new WeakMap();
    strengths.set(state.formations, ofState);
  }
  let strength = ofState.get(army);
  if (strength === undefined) {
    const body = formationsOf(state, army)
      .filter(isFighting)
      .reduce((sum, f) => {
        const troop = TROOPS[f.troop];
        return sum + f.men * Math.sqrt(troop.attack * troop.defence) * f.morale;
      }, 0);
    strength = body * (1 + GENERAL_EFFECT * army.generalSkill);
    ofState.set(army, strength);
  }
  return strength;
}

export function menUnderArms(state: State, faction: FactionId): number {
  let men = 0;
  for (const army of Object.values(state.armies)) {
    if (army.owner !== faction) continue;
    for (const formation of formationsOf(state, army)) men += formation.men;
  }
  return men;
}

export function menInTraining(state: State, faction: FactionId): number {
  let men = 0;
  for (const city of Object.values(state.cities)) {
    if (city.owner !== faction) continue;
    for (const recruit of city.recruits) men += TROOPS[recruit.troop].recruit.men;
  }
  return men;
}

/** The gold and food a faction keeps back: RESERVE_DAYS of the upkeep of its men and recruits. */
export function reserveOf(state: State, faction: FactionId, extraMen = 0): number {
  const men = menUnderArms(state, faction) + menInTraining(state, faction) + extraMen;
  return RESERVE_DAYS * men * UPKEEP_PER_MAN.gold;
}

export function positionOf(army: ArmyView): MapPoint | undefined {
  return army.activity.kind === 'embarked' ? undefined : army.activity.position;
}

/** The faction's capital from the map while it holds it. */
export function homeCapital(state: State, world: World, faction: FactionId): CityView | undefined {
  const home = world.map.provinces.find(
    (province) => (province.owner as string) === faction && province.capital,
  );
  const city = home && state.cities[home.id as string as CityId];
  return city?.owner === faction ? city : undefined;
}

/** Armies on land of factions at war with this one. */
export function enemyArmies(state: State, faction: FactionId, enemies: ReadonlySet<FactionId>) {
  return sorted(state.armies).filter(
    (army) => army.owner !== faction && enemies.has(army.owner) && positionOf(army),
  );
}

const warLists = new WeakMap<object, Map<FactionId, Set<FactionId>>>();

export function enemiesOf(state: State, faction: FactionId): ReadonlySet<FactionId> {
  let byFaction = warLists.get(state.wars);
  if (!byFaction) {
    byFaction = new Map();
    for (const key of Object.keys(state.wars)) {
      const sides = warSides(key);
      if (!sides) continue;
      const [a, b] = sides;
      byFaction.set(a, (byFaction.get(a) ?? new Set()).add(b));
      byFaction.set(b, (byFaction.get(b) ?? new Set()).add(a));
    }
    warLists.set(state.wars, byFaction);
  }
  return byFaction.get(faction) ?? new Set();
}

export function strengthNear(
  state: State,
  armies: readonly ArmyView[],
  point: MapPoint,
  km: number,
): number {
  let total = 0;
  for (const army of armies) {
    const at = positionOf(army);
    if (at && distance(at, point) <= km) total += strengthOf(state, army);
  }
  return total;
}

/** The chance that a storm takes the city and the men it is expected to cost, by the storm rules. */
export function stormOdds(
  state: State,
  city: CityView,
  stormers: readonly ArmyView[],
): { chance: number; loss: number; men: number } {
  const fighters = stormers.flatMap((army) => formationsOf(state, army).filter(isFighting));
  const men = fighters.reduce((sum, f) => sum + f.men, 0);
  const attack = fighters.reduce((sum, f) => sum + f.men * TROOPS[f.troop].attack, 0);
  const defence = city.garrison * (1 + city.walls * WALL_DEFENCE);
  if (attack === 0) return { chance: 0, loss: men, men };
  // The storm takes the city when attack times a luck draw in [1 - L, 1 + L) beats the defence.
  const chance = Math.min(1, Math.max(0, (1 + STORM_LUCK - defence / attack) / (2 * STORM_LUCK)));
  return { chance, loss: Math.min(men, defence * STORM_KILL), men };
}

/** Whether an army can walk from the point to the city. */
export function byLand(world: World, from: MapPoint, to: MapPoint): boolean {
  return connected(world.mesh, from, to, 'land');
}

/** Whether another faction leads the siege of the city, so that it would take the city, whoever storms. */
export function ledByOther(state: State, city: CityView, faction: FactionId): boolean {
  const siege = Object.values(state.sieges).find((s) => s.city === city.id);
  const leader = siege?.besiegers[0];
  return leader !== undefined && state.armies[leader]?.owner !== faction;
}

/** The cities of the faction's enemies that it could take: those no other faction leads the siege of. */
export function targetsOf(state: State, faction: FactionId, enemies: ReadonlySet<FactionId>) {
  return sorted(state.cities).filter(
    (city) => enemies.has(city.owner) && !ledByOther(state, city, faction),
  );
}

const balances = new WeakMap<State, ReadonlyMap<FactionId, Stores>>();

/** The faction's income less its upkeep for one day, worked out once a day for every faction. */
export function balanceOf(state: State, faction: FactionId): Stores | undefined {
  let all = balances.get(state);
  if (!all) {
    all = dailyBalances(state);
    balances.set(state, all);
  }
  return all.get(faction);
}
