import type { CityId } from '../ids.ts';
import type { GameMap } from '../map.ts';
import type { MapPoint } from '../state/map-point.ts';
import { distance, locate } from './find-path.ts';
import { buildNavMesh, surfaceCode, type NavMesh } from './mesh.ts';

/**
 * Everything the rules know about the map. It is built once from the map, never
 * saved, and never changed during play. Every order handler and system receives it.
 */
export interface World {
  readonly map: GameMap;
  readonly mesh: NavMesh;
  /** The sea point nearest each port city, where its convoys leave and land. */
  readonly harbours: ReadonlyMap<CityId, MapPoint>;
}

export function buildWorld(map: GameMap): World {
  const mesh = buildNavMesh(map);
  const harbours = new Map<CityId, MapPoint>();
  for (const province of map.provinces) {
    if (!province.port) continue;
    const harbour = nearestSea(mesh, { x: province.city[0], y: province.city[1] });
    if (harbour) harbours.set(province.id as string as CityId, harbour);
  }
  return Object.freeze({ map, mesh, harbours });
}

/**
 * The point of open sea nearest the point, on the sea of the given component when one is
 * given. For a point on land it lies on the coast.
 */
export function nearestSea(
  mesh: NavMesh,
  from: MapPoint,
  component?: number,
): MapPoint | undefined {
  const { triangles, points } = mesh;
  const sea = surfaceCode('sea');
  let best: MapPoint | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let t = 0; t < triangles.length / 3; t += 1) {
    if (mesh.surface[t] !== sea) continue;
    if (component !== undefined && mesh.component[t] !== component) continue;
    for (let k = 0; k < 3; k += 1) {
      const a = triangles[3 * t + k] as number;
      const b = triangles[3 * t + ((k + 1) % 3)] as number;
      const point = closestOnSegment(
        from,
        { x: points[2 * a] as number, y: points[2 * a + 1] as number },
        { x: points[2 * b] as number, y: points[2 * b + 1] as number },
      );
      const d = distance(from, point);
      if (d < bestDistance && locate(mesh, point, 'sea') >= 0) {
        bestDistance = d;
        best = point;
      }
    }
  }
  return best;
}

function closestOnSegment(p: MapPoint, a: MapPoint, b: MapPoint): MapPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return { x: a.x + dx * t, y: a.y + dy * t };
}
