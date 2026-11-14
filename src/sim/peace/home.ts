import type { DeepReadonly } from '../deep-readonly.ts';
import type { CityId, FactionId } from '../ids.ts';
import { marchPath, startMarch } from '../march.ts';
import { embark, embarkationAt } from '../orders/embark.ts';
import type { Army } from '../state/army.ts';
import type { City } from '../state/city.ts';
import type { Convoy } from '../state/convoy.ts';
import type { GameState } from '../state/game-state.ts';
import type { MapPoint } from '../state/map-point.ts';
import { connected, distance, findPath, locate } from '../world/find-path.ts';
import { nearestSea, type World } from '../world/world.ts';

/** The cities a land march home is tried to, nearest first. Farther ones are beyond a march. */
const HOME_TRIES = 4;

function citiesOf(state: DeepReadonly<GameState>, owner: FactionId): DeepReadonly<City>[] {
  return Object.keys(state.cities)
    .sort()
    .flatMap((id) => {
      const city = state.cities[id as CityId];
      return city && city.owner === owner ? [city] : [];
    });
}

/** The owner of the city nearest the point: whose land the point lies on, as provinces are drawn. */
export function landOwnerAt(state: DeepReadonly<GameState>, at: MapPoint): FactionId | undefined {
  let best: DeepReadonly<City> | undefined;
  for (const id of Object.keys(state.cities).sort()) {
    const city = state.cities[id as CityId];
    if (city && (!best || distance(city.position, at) < distance(best.position, at))) best = city;
  }
  return best?.owner;
}

/** The ports tried for a crossing home, nearest the owner's cities first. Farther ones are a longer way. */
const LANDING_TRIES = 6;

/**
 * Sends an idle or marching army home: by land to the nearest city of its owner a march
 * reaches, else by sea from the shore it stands on, to its owner's port nearest it or, when
 * its owner holds no port on that sea, to the port from which a march reaches the owner's
 * nearest city, else to the nearest shore of such a port's sea, where it takes ship next.
 */
export function sendHome(state: GameState, world: World, army: Army): void {
  const { activity } = army;
  if (activity.kind !== 'idle' && activity.kind !== 'marching') return;
  const at = activity.position;
  const own = citiesOf(state, army.owner).sort(
    (a, b) => distance(a.position, at) - distance(b.position, at),
  );
  for (const city of own.slice(0, HOME_TRIES)) {
    if (startMarch(world, army, at, city.position) === undefined) return;
  }
  const landings = landingsHome(state, world, army.owner, own);
  for (const { port, then } of landings) {
    const harbour = world.harbours.get(port.id) as MapPoint;
    if (!embarkationAt(state, world, army.owner, at, harbour)) continue;
    const order = {
      kind: 'embark',
      faction: army.owner,
      army: army.id,
      to: port.id,
      ...(then && { then }),
    } as const;
    if (embark(state, order, world) === undefined) return;
  }
  for (const { port } of landings) {
    const harbour = world.harbours.get(port.id) as MapPoint;
    const sea = world.mesh.component[locate(world.mesh, harbour, 'sea')];
    const shore = sea === undefined ? undefined : nearestSea(world.mesh, at, sea);
    if (shore && typeof marchPath(world, at, shore) !== 'string') {
      startMarch(world, army, at, shore);
      return;
    }
  }
  if (activity.kind === 'marching') army.activity = { kind: 'idle', position: at };
}

/**
 * The ports an army of the owner may land at to reach home: the owner's own, and then the
 * others nearest its cities from whose harbour a march reaches one, with that city as `then`.
 */
function landingsHome(
  state: GameState,
  world: World,
  owner: FactionId,
  own: readonly DeepReadonly<City>[],
): { port: DeepReadonly<City>; then?: MapPoint }[] {
  const ports = own.filter((city) => world.harbours.has(city.id)).map((port) => ({ port }));
  const nearestOwn = (point: MapPoint) =>
    [...own].sort((a, b) => distance(a.position, point) - distance(b.position, point))[0];
  const foreign = Object.keys(state.cities)
    .sort()
    .flatMap((id) => {
      const port = state.cities[id as CityId];
      const harbour = port && world.harbours.get(port.id);
      const home = harbour && nearestOwn(harbour);
      return port && harbour && home && port.owner !== owner
        ? [{ port, home, km: distance(harbour, home.position) }]
        : [];
    })
    .sort((a, b) => a.km - b.km)
    .slice(0, LANDING_TRIES)
    .flatMap(({ port, home }) => {
      const harbour = world.harbours.get(port.id) as MapPoint;
      return typeof marchPath(world, harbour, home.position) === 'string'
        ? []
        : [{ port, then: { x: home.position.x, y: home.position.y } }];
    });
  return [...ports, ...foreign];
}

/**
 * Turns a convoy bound for the other side's land to its owner's harbour nearest it on the
 * same sea, and lands its armies there. A convoy with no such harbour sails on.
 */
export function sailHome(state: GameState, world: World, convoy: Convoy): void {
  const ports = citiesOf(state, convoy.owner)
    .flatMap((city) => {
      const harbour = world.harbours.get(city.id);
      return harbour && connected(world.mesh, convoy.position, harbour, 'sea') ? [harbour] : [];
    })
    .sort((a, b) => distance(a, convoy.position) - distance(b, convoy.position));
  for (const harbour of ports) {
    const path = findPath(world.mesh, convoy.position, harbour, 'sea');
    if (!path || path.length === 0) continue;
    convoy.waypoints = path;
    for (const id of convoy.armies) {
      const army = state.armies[id];
      if (army?.activity.kind === 'embarked') {
        army.activity = { kind: 'embarked', convoy: convoy.id };
      }
    }
    return;
  }
}
