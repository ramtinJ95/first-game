import type { ArmyId, BattleId, CityId, ProvinceId } from '../sim/ids.ts';
import type { GameMap, Ring } from '../sim/map.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { mapToScreen, screenToMap, type Camera, type Size } from './camera.ts';
import type { Box } from './labels.ts';
import { BANNER_HIT, BATTLE_HIT_RADIUS, type DrawnArmy, type DrawnBattle } from './markers.ts';

export type Pick =
  | { kind: 'province'; province: ProvinceId }
  | { kind: 'army'; army: ArmyId }
  | { kind: 'battle'; battle: BattleId };

/** A city as the map draws it: its symbol and, while it is shown, its name, in screen pixels. */
export interface DrawnCity {
  readonly id: CityId;
  readonly symbol: Box;
  readonly label: Box | undefined;
}

/** How far from a city's symbol or name a click still means that city, in screen pixels. */
export const CITY_HIT_MARGIN = 10;

function gap(box: Box, { x, y }: MapPoint): number {
  return Math.hypot(
    Math.max(box.left - x, 0, x - box.right),
    Math.max(box.top - y, 0, y - box.bottom),
  );
}

function nearest(
  cities: readonly DrawnCity[],
  screen: MapPoint,
  boxOf: (city: DrawnCity) => Box | undefined,
): CityId | undefined {
  let best: { id: CityId; gap: number; centre: number } | undefined;
  for (const city of cities) {
    const box = boxOf(city);
    if (!box) continue;
    const near = gap(box, screen);
    if (near > CITY_HIT_MARGIN) continue;
    const centre = Math.hypot(
      screen.x - (box.left + box.right) / 2,
      screen.y - (box.top + box.bottom) / 2,
    );
    if (!best || near < best.gap || (near === best.gap && centre < best.centre)) {
      best = { id: city.id, gap: near, centre };
    }
  }
  return best?.id;
}

/**
 * The city whose symbol is under `screen` or within CITY_HIT_MARGIN of it, and failing
 * that, the city whose name is. A name can end beside another city's symbol, and the
 * symbol is what a player aims at. Among symbols that overlap, the one centred nearer wins.
 */
export function cityAt(cities: readonly DrawnCity[], screen: MapPoint): CityId | undefined {
  return (
    nearest(cities, screen, (city) => city.symbol) ?? nearest(cities, screen, (city) => city.label)
  );
}

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

/** A drawn figure or ship that a click selects its army by, in screen px. */
export interface FigureHit {
  readonly army?: ArmyId;
  readonly hit?: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

/**
 * What a click at `screen` points at. A figure wins over a banner, which wins over a
 * battle marker, which wins over the land under it. Among figures or banners, the one
 * drawn last, which is on top, wins.
 */
export function pickAt(
  map: GameMap,
  camera: Camera,
  viewport: Size,
  armies: readonly DrawnArmy[],
  screen: MapPoint,
  battles: readonly DrawnBattle[] = [],
  figures: readonly FigureHit[] = [],
): Pick | undefined {
  for (let i = figures.length - 1; i >= 0; i--) {
    const { army, hit } = figures[i] as FigureHit;
    if (
      army &&
      hit &&
      screen.x >= hit.left &&
      screen.x <= hit.right &&
      screen.y >= hit.top &&
      screen.y <= hit.bottom
    ) {
      return { kind: 'army', army };
    }
  }
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
  for (const battle of battles) {
    const at = mapToScreen(camera, viewport, battle.position);
    if (Math.hypot(screen.x - at.x, screen.y - at.y) <= BATTLE_HIT_RADIUS) {
      return { kind: 'battle', battle: battle.id };
    }
  }
  const province = provinceAt(map, screenToMap(camera, viewport, screen));
  return province && { kind: 'province', province };
}
