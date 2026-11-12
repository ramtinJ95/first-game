import type { ArmyId, ProvinceId } from '../sim/ids.ts';
import type { GameMap, Ring } from '../sim/map.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { mapToScreen, screenToMap, type Camera, type Size } from './camera.ts';
import { BANNER_HIT, type DrawnArmy } from './markers.ts';

export type Pick = { kind: 'province'; province: ProvinceId } | { kind: 'army'; army: ArmyId };

function insideRing(ring: Ring, { x, y }: MapPoint): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The province whose land holds `point`, in map km, or nothing at sea. */
export function provinceAt(map: GameMap, point: MapPoint): ProvinceId | undefined {
  for (const province of map.provinces) {
    for (const [outer, ...holes] of province.outline) {
      if (outer && insideRing(outer, point) && !holes.some((hole) => insideRing(hole, point))) {
        return province.id;
      }
    }
  }
  return undefined;
}

/**
 * What a click at `screen` points at. A banner wins over the land under it, and the
 * banner drawn last, which is on top, wins over the others.
 */
export function pickAt(
  map: GameMap,
  camera: Camera,
  viewport: Size,
  armies: readonly DrawnArmy[],
  screen: MapPoint,
): Pick | undefined {
  for (let i = armies.length - 1; i >= 0; i--) {
    const army = armies[i] as DrawnArmy;
    const foot = mapToScreen(camera, viewport, army.position);
    const dx = screen.x - foot.x;
    const dy = screen.y - foot.y;
    if (
      dx >= BANNER_HIT.left &&
      dx <= BANNER_HIT.right &&
      dy >= BANNER_HIT.top &&
      dy <= BANNER_HIT.bottom
    ) {
      return { kind: 'army', army: army.id };
    }
  }
  const province = provinceAt(map, screenToMap(camera, viewport, screen));
  return province && { kind: 'province', province };
}
