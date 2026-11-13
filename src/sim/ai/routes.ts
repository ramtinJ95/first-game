import type { CityId, FactionId } from '../ids.ts';
import { MARCH_KM_PER_DAY, MAX_MARCH_DAYS } from '../march.ts';
import { AT_PORT_KM } from '../orders/embark.ts';
import type { MapPoint } from '../state/map-point.ts';
import { connected, distance, findPath } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import { byLand, sorted, type CityView, type State } from './situation.ts';
import { SEA_KM_FACTOR } from './thresholds.ts';

/** The next order on the way to a city: march to a point, or sail from the port the army stands at. */
export type Step = { kind: 'march'; to: MapPoint } | { kind: 'embark'; to: CityId };

/** The longest march the rules allow, in km of road. */
const MAX_MARCH_KM = MAX_MARCH_DAYS * MARCH_KM_PER_DAY;

/**
 * The road km between two points, kept for each world from day to day because the land
 * never changes, so an army that stands where no march takes it pays for the search once.
 * Past ROADS_KEPT entries the list starts again.
 */
const roadsOf = new WeakMap<World, Map<string, number>>();
const ROADS_KEPT = 50_000;

export interface Route {
  /** Km along the land path, plus straight km at sea weighted by SEA_KM_FACTOR. */
  cost: number;
  step: Step;
}

/** Finds the cheapest way for a faction's army at a point to reach cities, by land or by sea. */
export interface Router {
  /** The cheapest route costing less than `within`, if any. */
  routeTo(from: MapPoint, target: CityView, within?: number): Route | undefined;
  /** Whether any route joins them, without pricing it. */
  reaches(from: MapPoint, target: CityView): boolean;
  /** Whether an army may march from one point to the other, within MAX_MARCH_DAYS. */
  marches(from: MapPoint, to: MapPoint): boolean;
  /** The port the embark order would sail from, for an army at this point. */
  portAt(from: MapPoint): CityView | undefined;
}

export function createRouter(state: State, world: World, faction: FactionId): Router {
  const ports = sorted(state.cities).filter((city) => world.harbours.has(city.id));
  const ownPorts = ports.filter((city) => city.owner === faction);
  const landings = new Map<CityId, CityView | undefined>();

  const harbour = (city: CityView) => world.harbours.get(city.id) as MapPoint;

  /**
   * The port where an army bound for the city lands: the city itself, or the port nearest
   * it from which the march on to the city is one the rules allow.
   */
  function landingFor(target: CityView): CityView | undefined {
    if (landings.has(target.id)) return landings.get(target.id);
    let best: CityView | undefined;
    if (world.harbours.has(target.id)) best = target;
    else {
      const near = ports
        .filter((port) => distance(harbour(port), target.position) <= MAX_MARCH_KM)
        .sort(
          (a, b) => distance(a.position, target.position) - distance(b.position, target.position),
        );
      best = near.find(
        (port) =>
          byLand(world, harbour(port), target.position) &&
          roadKm(harbour(port), target.position) < Number.POSITIVE_INFINITY,
      );
    }
    landings.set(target.id, best);
    return best;
  }

  function portAt(from: MapPoint): CityView | undefined {
    let best: CityView | undefined;
    let bestAway = Number.POSITIVE_INFINITY;
    for (const port of ownPorts) {
      const away = Math.min(distance(from, port.position), distance(from, harbour(port)));
      if (away <= AT_PORT_KM && away < bestAway) {
        best = port;
        bestAway = away;
      }
    }
    return best;
  }

  let roads = roadsOf.get(world);
  if (!roads || roads.size > ROADS_KEPT) {
    roads = new Map();
    roadsOf.set(world, roads);
  }
  const known = roads;
  /**
   * The length of the land path, which only the chosen few routes pay to find. A path
   * longer than a march may be costs infinity, so no route takes it.
   */
  function roadKm(from: MapPoint, to: MapPoint): number {
    const key = `${from.x},${from.y};${to.x},${to.y}`;
    let km = known.get(key);
    if (km === undefined) {
      const path = findPath(world.mesh, from, to, 'land');
      km = Number.POSITIVE_INFINITY;
      if (path) {
        km = 0;
        let at = from;
        for (const point of path) {
          km += distance(at, point);
          at = point;
        }
        if (km > MAX_MARCH_KM) km = Number.POSITIVE_INFINITY;
      }
      known.set(key, km);
    }
    return km;
  }

  interface Option {
    /** No route is shorter than this, so an option whose bound is above the best is skipped unpriced. */
    bound: number;
    price: () => number;
    step: Step;
  }

  function options(from: MapPoint, target: CityView): Option[] {
    const found: Option[] = [];
    if (distance(from, target.position) <= MAX_MARCH_KM && byLand(world, from, target.position)) {
      found.push({
        bound: distance(from, target.position),
        price: () => roadKm(from, target.position),
        step: { kind: 'march', to: target.position },
      });
    }
    const landing = landingFor(target);
    if (!landing) return found;
    const landAt = harbour(landing);
    const ashore = distance(landAt, target.position);
    const here = portAt(from);
    if (here && here.id !== landing.id && connected(world.mesh, harbour(here), landAt, 'sea')) {
      const voyage = distance(harbour(here), landAt) * SEA_KM_FACTOR;
      found.push({
        bound: voyage + ashore,
        price: () => voyage + ashore,
        step: { kind: 'embark', to: landing.id },
      });
      return found;
    }
    for (const port of ownPorts) {
      if (port.id === landing.id || distance(from, port.position) > MAX_MARCH_KM) continue;
      if (!byLand(world, from, port.position)) continue;
      if (!connected(world.mesh, harbour(port), landAt, 'sea')) continue;
      const voyage = distance(harbour(port), landAt) * SEA_KM_FACTOR;
      found.push({
        bound: distance(from, port.position) + voyage + ashore,
        price: () => roadKm(from, port.position) + voyage + ashore,
        step: { kind: 'march', to: port.position },
      });
    }
    return found;
  }

  function routeTo(from: MapPoint, target: CityView, within = Number.POSITIVE_INFINITY) {
    let best: Route | undefined;
    for (const option of options(from, target).sort((a, b) => a.bound - b.bound)) {
      if (option.bound >= (best?.cost ?? within)) break;
      const cost = option.price();
      if (cost < (best?.cost ?? within)) best = { cost, step: option.step };
    }
    return best;
  }

  function reaches(from: MapPoint, target: CityView): boolean {
    const walk =
      distance(from, target.position) <= MAX_MARCH_KM && byLand(world, from, target.position);
    return walk || options(from, target).length > 0;
  }

  function marches(from: MapPoint, to: MapPoint): boolean {
    return (
      distance(from, to) <= MAX_MARCH_KM &&
      byLand(world, from, to) &&
      roadKm(from, to) <= MAX_MARCH_KM
    );
  }

  return { routeTo, reaches, marches, portAt };
}
