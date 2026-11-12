import { FATE_DAYS } from '../cities.ts';
import type { ArmyId, CityId, FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import type { MapPoint } from '../state/map-point.ts';
import { RALLY_DISTANCE } from '../systems/economy.ts';
import { SIEGE_DISTANCE } from '../systems/sieges.ts';
import { distance } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import type { Router, Step } from './routes.ts';
import {
  byLand,
  canFight,
  enemyArmies,
  homeCapital,
  meanMorale,
  positionOf,
  reserveOf,
  sorted,
  stormOdds,
  strengthNear,
  strengthOf,
  targetsOf,
  type ArmyView,
  type CityView,
  type State,
} from './situation.ts';
import {
  ATTACK_ODDS,
  CAPITAL_GUARD_KM,
  DEFENDER_KM,
  ENSLAVE_BELOW_MANPOWER,
  MARCH_MORALE,
  RALLY_WAIT_DAYS,
  RELIEF_KM,
  RELIEF_ODDS,
  RETREAT_ODDS,
  STORM_MAX_LOSS,
  STORM_MIN_CHANCE,
} from './thresholds.ts';

/** A march already under way to this point counts as the same order. */
const SAME_POINT_KM = 1;

export interface Context {
  state: State;
  world: World;
  faction: FactionId;
  enemies: ReadonlySet<FactionId>;
  router: Router;
}

/** Retreats every army of the faction whose side in its battle has fallen below RETREAT_ODDS of the enemy. */
export function retreats({ state, faction }: Context): Order[] {
  const orders: Order[] = [];
  for (const army of sorted(state.armies)) {
    if (army.owner !== faction || army.activity.kind !== 'inBattle') continue;
    const battle = state.battles[army.activity.battle];
    if (!battle) continue;
    const ours = battle.attackers.includes(army.id) ? battle.attackers : battle.defenders;
    const theirs = ours === battle.attackers ? battle.defenders : battle.attackers;
    const side = (ids: readonly ArmyId[]) =>
      ids.reduce((sum, id) => {
        const other = state.armies[id];
        return sum + (other ? strengthOf(state, other) : 0);
      }, 0);
    if (side(ours) < RETREAT_ODDS * side(theirs)) {
      orders.push({ kind: 'retreat', faction, army: army.id });
    }
  }
  return orders;
}

/**
 * Decides the fate of each city that fell to the faction while an army of it stands
 * there: sack while gold is below the reserve, else enslave while manpower is below
 * ENSLAVE_BELOW_MANPOWER, else occupy, which needs no order.
 */
export function fates({ state, faction }: Context): Order[] {
  const record = state.factions[faction];
  if (!record) return [];
  const orders: Order[] = [];
  const ownCities = sorted(state.cities).filter((city) => city.owner === faction);
  for (const city of ownCities) {
    if (city.fellOn === null || state.day - city.fellOn > FATE_DAYS) continue;
    const present = Object.values(state.armies).some((army) => {
      const at = army.owner === faction && positionOf(army);
      return at && distance(at, city.position) <= SIEGE_DISTANCE;
    });
    if (!present) continue;
    if (record.stores.gold < reserveOf(state, faction)) {
      orders.push({ kind: 'sack', faction, city: city.id });
    } else if (record.stores.manpower < ENSLAVE_BELOW_MANPOWER && ownCities.length > 1) {
      orders.push({ kind: 'enslave', faction, city: city.id });
    }
  }
  return orders;
}

/**
 * Storms each city the faction leads the siege of when the storm wins with at least
 * STORM_MIN_CHANCE and is expected to cost at most STORM_MAX_LOSS of the stormers. A
 * city falls to the faction that besieged it first, so a faction that came later waits.
 */
export function storms({ state, faction }: Context): Order[] {
  const stores = state.factions[faction]?.stores;
  if (!stores || stores.gold < 0 || stores.food < 0) return [];
  const orders: Order[] = [];
  for (const siege of sorted(state.sieges)) {
    const first = siege.besiegers[0];
    if (first === undefined || state.armies[first]?.owner !== faction) continue;
    const city = state.cities[siege.city];
    const stormers = siege.besiegers.flatMap((id) => {
      const army = state.armies[id];
      return army?.owner === faction ? [army] : [];
    });
    if (!city || !stormers.some((army) => canFight(state, army))) continue;
    const { chance, loss, men } = stormOdds(state, city, stormers);
    if (chance >= STORM_MIN_CHANCE && loss <= STORM_MAX_LOSS * men) {
      orders.push({ kind: 'storm', faction, city: city.id });
    }
  }
  return orders;
}

interface Mover {
  army: ArmyView;
  at: MapPoint;
  strength: number;
}

/**
 * Moves the faction's armies. First its weakest army at the capital stays there, or the
 * nearest army returns to it, while an enemy army that is not standing at one of its own
 * cities is within CAPITAL_GUARD_KM of it. Then armies relieve each besieged city
 * they are strong enough to relieve. The rest go on the offence: an army that marches on
 * a target it is still strong enough for keeps its course, and the others take the
 * cheapest such target by road and sea. Armies too weak alone form groups that can win
 * together: a group that stands assembled marches on its target at once, and the others
 * gather at the muster city first. The rest wait at the muster city.
 */
export function movements(context: Context, muster: CityView | undefined): Order[] {
  const { state, world, faction, enemies } = context;
  const orders: Order[] = [];
  const used = new Set<ArmyId>();
  const hostile = enemyArmies(state, faction, enemies);
  const own = sorted(state.armies).filter((army) => army.owner === faction);
  const movers: Mover[] = own.flatMap((army) => {
    const { activity } = army;
    if (activity.kind !== 'idle' && activity.kind !== 'marching') return [];
    if (!canFight(state, army)) return [];
    return [{ army, at: activity.position, strength: strengthOf(state, army) }];
  });

  const send = (mover: Mover, step: Step) => {
    used.add(mover.army.id);
    if (step.kind === 'embark') {
      orders.push({ kind: 'embark', faction, army: mover.army.id, to: step.to });
    } else if (!marchingTo(mover.army, step.to)) {
      orders.push({ kind: 'moveArmy', faction, army: mover.army.id, to: step.to });
    }
  };

  const capital = homeCapital(state, world, faction);
  const raiders = hostile.filter((army) => !atOwnCity(state, army));
  if (capital && strengthNear(state, raiders, capital.position, CAPITAL_GUARD_KM) > 0) {
    const [atCapital] = own
      .filter((army) => {
        const at = positionOf(army);
        return (
          at &&
          army.activity.kind !== 'marching' &&
          distance(at, capital.position) <= RALLY_DISTANCE
        );
      })
      .sort((a, b) => strengthOf(state, a) - strengthOf(state, b));
    if (atCapital) used.add(atCapital.id);
    else {
      const guard = nearest(
        movers.filter((m) => byLand(world, m.at, capital.position)),
        capital.position,
      );
      if (guard) send(guard, { kind: 'march', to: capital.position });
    }
  }

  for (const siege of sorted(state.sieges)) {
    const city = state.cities[siege.city];
    if (!city || city.owner !== faction) continue;
    const besiegers = siege.besiegers.flatMap((id) => state.armies[id] ?? []);
    const needed = RELIEF_ODDS * besiegers.reduce((sum, army) => sum + strengthOf(state, army), 0);
    const near = movers
      .filter(
        (m) =>
          !used.has(m.army.id) &&
          distance(m.at, city.position) <= RELIEF_KM &&
          byLand(world, m.at, city.position),
      )
      .sort((a, b) => distance(a.at, city.position) - distance(b.at, city.position));
    const relief: Mover[] = [];
    let gathered = 0;
    for (const mover of near) {
      if (gathered >= needed) break;
      relief.push(mover);
      gathered += mover.strength;
    }
    if (gathered < needed) continue;
    for (const mover of relief) send(mover, { kind: 'march', to: city.position });
  }

  const targets = targetsOf(state, faction, enemies);
  const needed = new Map<CityId, number>(
    targets.map((city) => [
      city.id,
      ATTACK_ODDS * strengthNear(state, hostile, city.position, DEFENDER_KM),
    ]),
  );
  const assigned = new Map<CityId, number>();
  for (const army of own) {
    if (army.activity.kind !== 'besieging') continue;
    const city = state.sieges[army.activity.siege]?.city;
    if (city) assigned.set(city, (assigned.get(city) ?? 0) + strengthOf(state, army));
  }

  const feasible = (city: CityView, mover: Mover) =>
    (assigned.get(city.id) ?? 0) + mover.strength >= (needed.get(city.id) ?? 0);

  const keptTarget = (mover: Mover) => {
    const heading = destinationOf(mover.army);
    return heading && targets.find((city) => distance(city.position, heading) <= SAME_POINT_KM);
  };

  /**
   * The nearest target, from the strongest army left, that the armies left can beat
   * together, and the armies nearest that army that suffice for it.
   */
  const groupFor = (rest: readonly Mover[]) => {
    const [lead] = rest;
    if (!lead) return undefined;
    const byDistance = [...targets].sort(
      (a, b) => distance(lead.at, a.position) - distance(lead.at, b.position),
    );
    for (const city of byDistance) {
      if (!context.router.reaches(lead.at, city)) continue;
      const near = rest
        .filter((m) => context.router.reaches(m.at, city))
        .sort((a, b) => distance(a.at, lead.at) - distance(b.at, lead.at));
      const members: Mover[] = [];
      let strength = assigned.get(city.id) ?? 0;
      for (const mover of near) {
        if (strength >= (needed.get(city.id) ?? 0)) break;
        members.push(mover);
        strength += mover.strength;
      }
      if (members.length > 1 && strength >= (needed.get(city.id) ?? 0)) return { city, members };
    }
    return undefined;
  };

  const free = movers
    .filter((m) => !used.has(m.army.id))
    .sort((a, b) => b.strength - a.strength || (a.army.id < b.army.id ? -1 : 1));
  const left: Mover[] = [];
  for (const mover of free) {
    if (mover.army.activity.kind === 'idle' && meanMorale(state, mover.army) < MARCH_MORALE)
      continue;
    if (mover.army.activity.kind === 'idle' && awaitsRecruits(state, faction, mover.at)) continue;
    const kept = keptTarget(mover);
    if (kept && feasible(kept, mover)) {
      assigned.set(kept.id, (assigned.get(kept.id) ?? 0) + mover.strength);
      used.add(mover.army.id);
      continue;
    }
    let best: { city: CityView; cost: number; step: Step } | undefined;
    const byDistance = targets
      .map((city) => ({ city, km: distance(mover.at, city.position) }))
      .sort((a, b) => a.km - b.km);
    for (const { city, km } of byDistance) {
      // No route is shorter than the straight line, so no later city can be cheaper.
      if (best && km >= best.cost) break;
      if (!feasible(city, mover)) continue;
      const route = context.router.routeTo(mover.at, city, best?.cost);
      if (route) best = { city, cost: route.cost, step: route.step };
    }
    if (best) {
      assigned.set(best.city.id, (assigned.get(best.city.id) ?? 0) + mover.strength);
      send(mover, best.step);
    } else left.push(mover);
  }

  // Armies too weak alone that already march on one target together keep their course.
  const heading = new Map<CityId, Mover[]>();
  for (const mover of left) {
    const kept = keptTarget(mover);
    if (kept) heading.set(kept.id, [...(heading.get(kept.id) ?? []), mover]);
  }
  for (const [city, group] of heading) {
    const together = group.reduce((sum, m) => sum + m.strength, assigned.get(city) ?? 0);
    if (together < (needed.get(city) ?? 0)) continue;
    assigned.set(city, together);
    for (const mover of group) used.add(mover.army.id);
  }

  let rest = left.filter((m) => !used.has(m.army.id));
  const meeting = muster?.position;
  while (rest.length > 1) {
    const group = groupFor(rest);
    if (!group) break;
    const assembled =
      group.members.every((m) => m.army.activity.kind === 'idle') &&
      group.members.every((m) => distance(m.at, group.members[0]?.at ?? m.at) <= RALLY_DISTANCE);
    for (const mover of group.members) {
      const route = assembled && context.router.routeTo(mover.at, group.city);
      if (route) send(mover, route.step);
      else {
        const to = meeting ?? (group.members[0] as Mover).at;
        if (distance(mover.at, to) <= RALLY_DISTANCE) used.add(mover.army.id);
        else if (byLand(world, mover.at, to)) send(mover, { kind: 'march', to });
        else used.add(mover.army.id);
      }
    }
    if (assembled) {
      assigned.set(
        group.city.id,
        group.members.reduce((sum, m) => sum + m.strength, assigned.get(group.city.id) ?? 0),
      );
    }
    rest = rest.filter((m) => !used.has(m.army.id));
  }

  for (const mover of rest) {
    if (
      targets.length > 0 &&
      muster &&
      distance(mover.at, muster.position) > RALLY_DISTANCE &&
      byLand(world, mover.at, muster.position)
    ) {
      send(mover, { kind: 'march', to: muster.position });
    }
  }
  return orders;
}

/** An army standing at a city of its owner, as a minor's defenders do, threatens no capital. */
function atOwnCity(state: State, army: ArmyView): boolean {
  const at = positionOf(army);
  return (
    !!at &&
    army.activity.kind !== 'marching' &&
    Object.values(state.cities).some(
      (city) => city.owner === army.owner && distance(city.position, at) <= RALLY_DISTANCE,
    )
  );
}

function destinationOf(army: ArmyView): MapPoint | undefined {
  const { activity } = army;
  return activity.kind === 'marching'
    ? activity.waypoints[activity.waypoints.length - 1]
    : undefined;
}

function marchingTo(army: ArmyView, point: MapPoint): boolean {
  const last = destinationOf(army);
  return !!last && distance(last, point) <= SAME_POINT_KM;
}

function nearest(movers: readonly Mover[], point: MapPoint): Mover | undefined {
  let best: Mover | undefined;
  for (const mover of movers) {
    if (!best || distance(mover.at, point) < distance(best.at, point)) best = mover;
  }
  return best;
}

/** Whether recruits muster within RALLY_WAIT_DAYS at a city of the faction where the army stands. */
function awaitsRecruits(state: State, faction: FactionId, at: MapPoint): boolean {
  return Object.values(state.cities).some(
    (city) =>
      city.owner === faction &&
      distance(city.position, at) <= RALLY_DISTANCE &&
      city.recruits.some((recruit) => recruit.readyOn - state.day <= RALLY_WAIT_DAYS),
  );
}
