import type { MapPoint } from '../state/map-point.ts';
import { distance, locate } from './find-path.ts';
import type { NavMesh } from './mesh.ts';
import type { World } from './world.ts';

const regions = new WeakMap<NavMesh, Map<string, Uint8Array>>();
const REGIONS_KEPT = 512;
const EDGE_KM = 1e-6;

/**
 * A path no longer than `within` cannot leave the circle of that radius about its
 * destination. Reject disconnected land inside that circle before pricing a road
 * all the way round a sea. Triangle boxes deliberately overestimate the region:
 * false means impossible, true still needs the ordinary path and length check.
 * Cache fixed city/port destinations, never a moving army's current position.
 */
export function mayWalkWithin(
  mesh: NavMesh,
  from: MapPoint,
  to: MapPoint,
  within: number,
): boolean {
  if (!Number.isFinite(within) || within < 0) throw new RangeError('invalid land reach');
  if (distance(from, to) > within + EDGE_KM) return false;
  const a = locate(mesh, from, 'land');
  const b = locate(mesh, to, 'land');
  if (a < 0 || b < 0 || mesh.component[a] !== mesh.component[b]) return false;
  let cache = regions.get(mesh);
  if (!cache) {
    cache = new Map();
    regions.set(mesh, cache);
  }
  const key = `${to.x},${to.y}:${within}`;
  let region = cache.get(key);
  if (!region) {
    region = new Uint8Array(mesh.surface.length);
    const queue = [b];
    region[b] = 1;
    const radius2 = (within + EDGE_KM) ** 2;
    for (let i = 0; i < queue.length; i++) {
      const triangle = queue[i] as number;
      for (let k = 0; k < 3; k++) {
        const edge = 3 * triangle + k;
        const twin = mesh.halfedges[edge] as number;
        const neighbour = Math.floor(twin / 3);
        if (twin < 0 || mesh.walls[edge] || region[neighbour] || mesh.surface[neighbour] !== 1)
          continue;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let j = 0; j < 3; j++) {
          const vertex = mesh.triangles[3 * neighbour + j] as number;
          const x = mesh.points[2 * vertex] as number;
          const y = mesh.points[2 * vertex + 1] as number;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        const dx = Math.max(minX - to.x, 0, to.x - maxX);
        const dy = Math.max(minY - to.y, 0, to.y - maxY);
        if (dx * dx + dy * dy <= radius2) {
          region[neighbour] = 1;
          queue.push(neighbour);
        } else region[neighbour] = 2;
      }
    }
    if (cache.size >= REGIONS_KEPT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, region);
  }
  return region[a] === 1;
}

const cityless = new WeakMap<World, ReadonlyMap<number, number>>();

/**
 * The area in km² of the land the point stands on when no city stands on that land, else
 * undefined. An army reaches land only by marching on it or by landing at a city's harbour,
 * so no army ever reaches such land, though a province outline may hold it.
 */
export function citylessLandKm2(world: World, point: MapPoint): number | undefined {
  const triangle = locate(world.mesh, point, 'land');
  if (triangle < 0) return undefined;
  let areas = cityless.get(world);
  if (!areas) {
    areas = citylessAreas(world);
    cityless.set(world, areas);
  }
  return areas.get(world.mesh.component[triangle] as number);
}

function citylessAreas(world: World): ReadonlyMap<number, number> {
  const { mesh } = world;
  const withCity = new Set<number>();
  for (const province of world.map.provinces) {
    const at = locate(mesh, { x: province.city[0], y: province.city[1] }, 'land');
    if (at >= 0) withCity.add(mesh.component[at] as number);
  }
  const areas = new Map<number, number>();
  const { points, triangles } = mesh;
  for (let t = 0; t < mesh.surface.length; t++) {
    const component = mesh.component[t] as number;
    if (mesh.surface[t] !== 1 || withCity.has(component)) continue;
    const [a, b, c] = [0, 1, 2].map((k) => triangles[3 * t + k] as number) as [
      number,
      number,
      number,
    ];
    const ax = points[2 * a] as number;
    const ay = points[2 * a + 1] as number;
    const area =
      Math.abs(
        ((points[2 * b] as number) - ax) * ((points[2 * c + 1] as number) - ay) -
          ((points[2 * c] as number) - ax) * ((points[2 * b + 1] as number) - ay),
      ) / 2;
    areas.set(component, (areas.get(component) ?? 0) + area);
  }
  return areas;
}
