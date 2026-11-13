import { FATE_DAYS } from '../cities.ts';
import type { ArmyId, CityId, FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import type { MapPoint } from '../state/map-point.ts';
import { RALLY_DISTANCE } from '../systems/economy.ts';
import { BLOCKADE_ODDS, defendersAt, SALLY_SHARE, SIEGE_DISTANCE } from '../systems/sieges.ts';
import { MARCH_KM_PER_DAY, marchDays, MAX_MARCH_DAYS } from '../march.ts';
import { distance } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import type { Router, Step } from './routes.ts';
import {
  byLand,
  canFight,
  enemyArmies,
  formationsOf,
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
  GARRISON_ODDS,
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

/**
 * Halts every army of the faction on a march longer than MAX_MARCH_DAYS, which only a save
 * from before the limit holds. A later order of the same day may send it on a march the
 * rules allow, and otherwise it stands where it is.
 */
export function endOverlongMarches({ state, faction }: Context): Order[] {
  return sorted(state.armies)
    .filter((army) => army.owner === faction && overlong(army))
    .map((army) => ({ kind: 'halt', faction, army: army.id }));
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
    if (record.stores.gold < reserveOf(state, faction, 'gold')) {
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
    if (!city || !stormers.some((army) => canFight(state, army)) || defendersAt(state, city)) {
      continue;
    }
    const { chance, loss, men } = stormOdds(state, city, stormers);
    if (chance >= STORM_MIN_CHANCE && loss <= STORM_MAX_LOSS * men) {
      orders.push({ kind: 'storm', faction, city: city.id });
    }
  }
  return orders;
}

/** What an army or a group brings to a target: its strength in battle and its men for the blockade. */
interface Force {
  strength: number;
  men: number;
}

interface Mover extends Force {
  army: ArmyView;
  at: MapPoint;
}

const NO_FORCE: Force = { strength: 0, men: 0 };

function joined(a: Force, b: Force): Force {
  return { strength: a.strength + b.strength, men: a.men + b.men };
}

function menOfArmy(state: State, army: ArmyView): number {
  return formationsOf(state, army).reduce((sum, f) => sum + f.men, 0);
}

/**
 * Moves the faction's armies. First its weakest army at the capital stays there, or the
 * nearest army returns to it, while an enemy army that is not standing at one of its own
 * cities is within CAPITAL_GUARD_KM of it. Then armies relieve each besieged city
 * they are strong enough to relieve, and armies leave for the muster city from each
 * siege whose besiegers are too few to hold the blockade, before the garrison's sallies
 * wear them down, unless armies marching there bring it up to the blockade in time. The rest go on the offence, each target needing at least
 * GARRISON_ODDS times its garrison: an army that marches on
 * a target it is still strong enough for keeps its course, and the others take the
 * cheapest such target by road and sea. Armies too weak alone form groups that can win
 * together: a group that stands assembled marches on its target at once and keeps to its
 * route, port and sea included, and the others gather at the muster city first. The rest wait at the muster city.
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
    return [
      {
        army,
        at: activity.position,
        strength: strengthOf(state, army),
        men: menOfArmy(state, army),
      },
    ];
  });

  const send = (mover: Mover, step: Step) => {
    used.add(mover.army.id);
    if (step.kind === 'embark') {
      orders.push({ kind: 'embark', faction, army: mover.army.id, to: step.to });
    } else if (!marchingTo(mover.army, step.to)) {
      orders.push({ kind: 'moveArmy', faction, army: mover.army.id, to: step.to });
    }
  };
  /** Sends the mover on its way to the city by road or sea, and says whether a way exists. */
  const headFor = (mover: Mover, city: CityView): boolean => {
    const heading = destinationOf(mover.army);
    // An army marching to a port of its own to sail for the city is on the first leg of its
    // way. The road from that port is the same every day, so this costs no new search.
    const onFirstLeg =
      !!heading &&
      !!context.router.portAt(heading) &&
      context.router.routeTo(heading, city)?.step.kind === 'embark';
    if (marchingTo(mover.army, city.position) || onFirstLeg) {
      used.add(mover.army.id);
      return true;
    }
    const route = context.router.routeTo(mover.at, city);
    if (route) send(mover, route.step);
    return route !== undefined;
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
      const guards = movers
        .filter((m) => context.router.reaches(m.at, capital))
        .sort((a, b) => distance(a.at, capital.position) - distance(b.at, capital.position));
      guards.some((guard) => headFor(guard, capital));
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
      const onTheWay = marchingTo(mover.army, city.position);
      if (!onTheWay && !context.router.marches(mover.at, city.position)) continue;
      relief.push(mover);
      gathered += mover.strength;
    }
    if (gathered < needed) continue;
    for (const mover of relief) send(mover, { kind: 'march', to: city.position });
  }

  for (const siege of sorted(state.sieges)) {
    const city = state.cities[siege.city];
    const besiegers = siege.besiegers.flatMap((id) => state.armies[id] ?? []);
    if (!city || !besiegers.some((army) => army.owner === faction)) continue;
    const men = besiegers.reduce((sum, army) => sum + menOfArmy(state, army), 0);
    if (men >= BLOCKADE_ODDS * city.garrison || !muster) continue;
    const reinforcements = reinforcementsInTime(state, faction, city, men);
    if (reinforcements) {
      for (const army of reinforcements) used.add(army.id);
      continue;
    }
    for (const army of besiegers) {
      const at = positionOf(army);
      if (army.owner !== faction || !at) continue;
      const step = context.router.routeTo(at, muster)?.step;
      if (step?.kind !== 'march') continue;
      used.add(army.id);
      orders.push({ kind: 'moveArmy', faction, army: army.id, to: step.to });
    }
  }

  const targets = targetsOf(state, faction, enemies);
  const needed = new Map<CityId, Force>(
    targets.map((city) => [
      city.id,
      {
        strength: ATTACK_ODDS * strengthNear(state, hostile, city.position, DEFENDER_KM),
        men: GARRISON_ODDS * city.garrison,
      },
    ]),
  );
  const assigned = new Map<CityId, Force>();
  /** The men sent at each city and their distance from it, so a later army knows who is there before it. */
  const arrivals = new Map<CityId, { km: number; men: number }[]>();
  const assign = (city: CityId, force: Force, km = 0) => {
    assigned.set(city, joined(assigned.get(city) ?? NO_FORCE, force));
    arrivals.set(city, [...(arrivals.get(city) ?? []), { km, men: force.men }]);
  };
  for (const army of own) {
    if (army.activity.kind !== 'besieging') continue;
    const city = state.sieges[army.activity.siege]?.city;
    if (city) assign(city, { strength: strengthOf(state, army), men: menOfArmy(state, army) });
  }
  const suffices = (city: CityId, force: Force) => {
    const need = needed.get(city) ?? NO_FORCE;
    return force.strength >= need.strength && force.men >= need.men;
  };

  /**
   * The armies sent at the city suffice together, and the men there by the time this army
   * arrives hold the blockade, so it does not start a siege that sallies wear down while
   * the rest are still far off.
   */
  const feasible = (city: CityView, mover: Mover) => {
    if (!suffices(city.id, joined(assigned.get(city.id) ?? NO_FORCE, mover))) return false;
    const km = distance(mover.at, city.position);
    const first = (arrivals.get(city.id) ?? [])
      .filter((sent) => sent.km <= km)
      .reduce((sum, sent) => sum + sent.men, mover.men);
    return first >= BLOCKADE_ODDS * city.garrison;
  };
  const sendAt = (city: CityView, mover: Mover) =>
    assign(city.id, mover, distance(mover.at, city.position));

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
      let force = assigned.get(city.id) ?? NO_FORCE;
      for (const mover of near) {
        if (suffices(city.id, force)) break;
        members.push(mover);
        force = joined(force, mover);
      }
      if (members.length > 1 && suffices(city.id, force)) return { city, members };
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
      sendAt(kept, mover);
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
      sendAt(best.city, mover);
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
    const together = group.reduce<Force>(joined, assigned.get(city) ?? NO_FORCE);
    if (!suffices(city, together)) continue;
    assigned.set(city, together);
    for (const mover of group) used.add(mover.army.id);
  }

  let rest = left.filter((m) => !used.has(m.army.id));
  const meeting = muster?.position;
  while (rest.length > 1) {
    const group = groupFor(rest);
    if (!group) break;
    // A group already on its way, such as one marching to its port to embark, keeps going.
    // A route costs a path search, so it is priced only for a member that is marching.
    const onTheWay = group.members.every((m) => {
      if (!destinationOf(m.army)) return false;
      const step = context.router.routeTo(m.at, group.city)?.step;
      return step?.kind === 'march' && marchingTo(m.army, step.to);
    });
    const assembled =
      onTheWay ||
      (group.members.every((m) => m.army.activity.kind === 'idle') &&
        group.members.every((m) => distance(m.at, group.members[0]?.at ?? m.at) <= RALLY_DISTANCE));
    for (const mover of group.members) {
      const route = assembled && context.router.routeTo(mover.at, group.city);
      if (route) send(mover, route.step);
      else {
        const to = meeting ?? (group.members[0] as Mover).at;
        if (distance(mover.at, to) <= RALLY_DISTANCE) used.add(mover.army.id);
        else if (muster) {
          if (!headFor(mover, muster)) used.add(mover.army.id);
        } else if (context.router.marches(mover.at, to)) send(mover, { kind: 'march', to });
        else used.add(mover.army.id);
      }
    }
    if (assembled) {
      for (const mover of group.members) assign(group.city.id, mover);
    }
    rest = rest.filter((m) => !used.has(m.army.id));
  }

  for (const mover of rest) {
    if (targets.length > 0 && muster && distance(mover.at, muster.position) > RALLY_DISTANCE) {
      headFor(mover, muster);
    }
  }
  return orders;
}

/**
 * The faction's armies marching to the city, soonest first, that bring the siege up to
 * the blockade before the garrison's sallies have cut down half of the men there now, or
 * undefined when they do not.
 */
function reinforcementsInTime(
  state: State,
  faction: FactionId,
  city: CityView,
  men: number,
): ArmyView[] | undefined {
  const coming: { army: ArmyView; days: number; men: number }[] = [];
  for (const army of sorted(state.armies)) {
    const { activity } = army;
    if (army.owner !== faction || activity.kind !== 'marching') continue;
    if (!marchingTo(army, city.position)) continue;
    let km = 0;
    let from = activity.position;
    for (const point of activity.waypoints) {
      km += distance(from, point);
      from = point;
    }
    coming.push({ army, days: Math.ceil(km / MARCH_KM_PER_DAY), men: menOfArmy(state, army) });
  }
  coming.sort((a, b) => a.days - b.days || (a.army.id < b.army.id ? -1 : 1));
  const sally = Math.ceil(city.garrison * SALLY_SHARE);
  const needed: ArmyView[] = [];
  let arrived = 0;
  for (const next of coming) {
    if (next.days * sally > men / 2) return undefined;
    needed.push(next.army);
    arrived += next.men;
    if (men - next.days * sally + arrived >= BLOCKADE_ODDS * city.garrison) return needed;
  }
  return undefined;
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

/** Where the army marches, unless the march is longer than a march may be, as in an old save. */
function destinationOf(army: ArmyView): MapPoint | undefined {
  const { activity } = army;
  if (activity.kind !== 'marching' || overlong(army)) return undefined;
  return activity.waypoints[activity.waypoints.length - 1];
}

function overlong(army: ArmyView): boolean {
  const { activity } = army;
  return (
    activity.kind === 'marching' &&
    marchDays(activity.position, activity.waypoints) > MAX_MARCH_DAYS
  );
}

function marchingTo(army: ArmyView, point: MapPoint): boolean {
  const last = destinationOf(army);
  return !!last && distance(last, point) <= SAME_POINT_KM;
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
