import type { CityId, FactionId } from '../ids.ts';
import { AT_PORT_KM } from '../orders/embark.ts';
import type { MapPoint } from '../state/map-point.ts';
import { connected, distance, findPath } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import { byLand, sorted, type CityView, type State } from './situation.ts';
import { SEA_KM_FACTOR } from './thresholds.ts';

/** The next order on the way to a city: march to a point, or sail from the port the army stands at. */
export type Step = { kind: 'march'; to: MapPoint } | { kind: 'embark'; to: CityId };

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
  /** The port the embark order would sail from, for an army at this point. */
  portAt(from: MapPoint): CityView | undefined;
}

export function createRouter(state: State, world: World, faction: FactionId): Router {
  const ports = sorted(state.cities).filter((city) => world.harbours.has(city.id));
  const ownPorts = ports.filter((city) => city.owner === faction);
  const landings = new Map<CityId, CityView | undefined>();

  const harbour = (city: CityView) => world.harbours.get(city.id) as MapPoint;

  /** The port where an army bound for the city lands: the city itself, or the port nearest it by land. */
  function landingFor(target: CityView): CityView | undefined {
    if (landings.has(target.id)) return landings.get(target.id);
    let best: CityView | undefined;
    if (world.harbours.has(target.id)) best = target;
    else {
      for (const port of ports) {
        if (
          best &&
          distance(port.position, target.position) >= distance(best.position, target.position)
        )
          continue;
        if (byLand(world, harbour(port), target.position)) best = port;
      }
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

  const roads = new Map<string, number>();
  /** The length of the land path, which only the chosen few routes pay to find. */
  function roadKm(from: MapPoint, to: MapPoint): number {
    const key = `${from.x},${from.y};${to.x},${to.y}`;
    let km = roads.get(key);
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
      }
      roads.set(key, km);
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
    if (byLand(world, from, target.position)) {
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
      const cost = distance(harbour(here), landAt) * SEA_KM_FACTOR + ashore;
      found.push({ bound: cost, price: () => cost, step: { kind: 'embark', to: landing.id } });
      return found;
    }
    for (const port of ownPorts) {
      if (port.id === landing.id || !byLand(world, from, port.position)) continue;
      if (!connected(world.mesh, harbour(port), landAt, 'sea')) continue;
      const voyage = distance(harbour(port), landAt) * SEA_KM_FACTOR + ashore;
      found.push({
        bound: distance(from, port.position) + voyage,
        price: () => roadKm(from, port.position) + voyage,
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
    return options(from, target).length > 0;
  }

  return { routeTo, reaches, portAt };
}
