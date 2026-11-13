import type { Army } from './state/army.ts';
import type { MapPoint } from './state/map-point.ts';
import { distance, findPath, surfaceAt } from './world/find-path.ts';
import type { World } from './world/world.ts';

/** How far an army marches in a day. Troop speeds come later. */
export const MARCH_KM_PER_DAY = 25;
/** How far a convoy of transports sails in a day. */
export const CONVOY_KM_PER_DAY = 20;
/** How far a column of refugees walks in a day. */
export const REFUGEE_KM_PER_DAY = 12;
/**
 * No march takes longer than this. Between cities within the AI's war reach, every march
 * that no crossing by sea beats takes at most 65 days, and the walks round a sea take 100
 * or more, so the bound falls in that gap.
 */
export const MAX_MARCH_DAYS = 90;

/** The days an army takes to walk the waypoints from the point. */
export function marchDays(from: MapPoint, waypoints: readonly MapPoint[]): number {
  let km = 0;
  let at = from;
  for (const point of waypoints) {
    km += distance(at, point);
    at = point;
  }
  return Math.ceil(km / MARCH_KM_PER_DAY);
}

/** The land path from one point to another, or the reason no army can walk it. */
export function landPath(world: World, from: MapPoint, to: MapPoint): MapPoint[] | string {
  const where = `${to.x}, ${to.y}`;
  const under = surfaceAt(world.mesh, to);
  if (under === 'offMap') return `destination ${where} is off the map`;
  if (under === 'sea') return `destination ${where} is in the sea`;
  if (surfaceAt(world.mesh, from) !== 'land')
    return `the start ${from.x}, ${from.y} is not on land`;
  return findPath(world.mesh, from, to, 'land') ?? `no land route reaches ${where}`;
}

/** The land path of a march from one point to another, or why no army may march it. */
export function marchPath(world: World, from: MapPoint, to: MapPoint): MapPoint[] | string {
  const path = landPath(world, from, to);
  if (typeof path === 'string') return path;
  const days = marchDays(from, path);
  if (days > MAX_MARCH_DAYS) {
    return `the march to ${to.x}, ${to.y} takes ${days} days, more than the ${MAX_MARCH_DAYS} a march may take`;
  }
  return path;
}

/**
 * Sets the army marching from the point to the destination along a land path no longer
 * than MAX_MARCH_DAYS, or returns why it cannot and leaves the army alone. Nothing else
 * starts a march, so every marching army has a path.
 */
export function startMarch(
  world: World,
  army: Army,
  from: MapPoint,
  to: MapPoint,
): string | undefined {
  const path = marchPath(world, from, to);
  if (typeof path === 'string') return path;
  army.activity = { kind: 'marching', position: { x: from.x, y: from.y }, waypoints: path };
  return undefined;
}

/** Why an army cannot set out now, or undefined when it is idle or already marching. */
export function busyReason(army: Army): string | undefined {
  const { activity } = army;
  switch (activity.kind) {
    case 'idle':
    case 'marching':
      return undefined;
    case 'retreating':
      return `army ${army.id} is retreating and takes no orders until it arrives`;
    case 'inBattle':
      return `army ${army.id} is in battle ${activity.battle} and must retreat first`;
    case 'besieging':
      return `army ${army.id} is besieging and must lift siege ${activity.siege} first`;
    case 'embarked':
      return `army ${army.id} is at sea in convoy ${activity.convoy}`;
  }
}

/**
 * Moves a point along its waypoints by a day's distance, dropping each waypoint it
 * reaches. It returns the new position.
 */
export function advanceAlong(position: MapPoint, waypoints: MapPoint[], km: number): MapPoint {
  let at = position;
  let left = km;
  while (waypoints.length > 0) {
    const target = waypoints[0] as MapPoint;
    const gap = distance(at, target);
    if (gap > left) {
      const share = left / gap;
      return { x: at.x + (target.x - at.x) * share, y: at.y + (target.y - at.y) * share };
    }
    left -= gap;
    at = target;
    waypoints.shift();
  }
  return { x: at.x, y: at.y };
}
