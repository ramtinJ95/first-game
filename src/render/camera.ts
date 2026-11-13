import type { MapPoint } from '../sim/state/map-point.ts';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** What the screen shows: the map point at the centre of the view, and pixels per km. */
export interface Camera {
  readonly centre: MapPoint;
  readonly scale: number;
}

/** The closest zoom: 4 px per km, so a 1280 px wide view spans 320 km. */
export const MAX_SCALE = 4;

/** The widest zoom fits the whole map in the view. */
export function minScale(viewport: Size, map: Size): number {
  return Math.min(viewport.width / map.width, viewport.height / map.height);
}

function clampScale(scale: number, viewport: Size, map: Size): number {
  const lowest = minScale(viewport, map);
  return Math.min(Math.max(scale, lowest), Math.max(MAX_SCALE, lowest));
}

export function fitCamera(viewport: Size, map: Size): Camera {
  return { centre: { x: map.width / 2, y: map.height / 2 }, scale: minScale(viewport, map) };
}

/**
 * Keeps the scale between the widest and the closest zoom, and keeps the view inside
 * the map. On an axis where the view is wider than the map, the map sits in the middle.
 */
export function clampCamera(camera: Camera, viewport: Size, map: Size): Camera {
  const scale = clampScale(camera.scale, viewport, map);
  const axis = (centre: number, view: number, extent: number) => {
    const half = view / scale / 2;
    if (half * 2 >= extent) return extent / 2;
    return Math.min(Math.max(centre, half), extent - half);
  };
  return {
    scale,
    centre: {
      x: axis(camera.centre.x, viewport.width, map.width),
      y: axis(camera.centre.y, viewport.height, map.height),
    },
  };
}

export function screenToMap(camera: Camera, viewport: Size, point: MapPoint): MapPoint {
  return {
    x: camera.centre.x + (point.x - viewport.width / 2) / camera.scale,
    y: camera.centre.y + (point.y - viewport.height / 2) / camera.scale,
  };
}

export function mapToScreen(camera: Camera, viewport: Size, point: MapPoint): MapPoint {
  return {
    x: (point.x - camera.centre.x) * camera.scale + viewport.width / 2,
    y: (point.y - camera.centre.y) * camera.scale + viewport.height / 2,
  };
}

/** The visible part of the map plane, in km. */
export function visibleRect(camera: Camera, viewport: Size) {
  const topLeft = screenToMap(camera, viewport, { x: 0, y: 0 });
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: topLeft.x + viewport.width / camera.scale,
    bottom: topLeft.y + viewport.height / camera.scale,
  };
}

/** Moves the map with a drag of `dx`, `dy` screen pixels. */
export function panBy(camera: Camera, dx: number, dy: number, viewport: Size, map: Size): Camera {
  const centre = { x: camera.centre.x - dx / camera.scale, y: camera.centre.y - dy / camera.scale };
  return clampCamera({ centre, scale: camera.scale }, viewport, map);
}

/** Zooms by `factor` and keeps the map point under `cursor` under it. */
export function zoomAt(
  camera: Camera,
  cursor: MapPoint,
  factor: number,
  viewport: Size,
  map: Size,
): Camera {
  const anchor = screenToMap(camera, viewport, cursor);
  const scale = clampScale(camera.scale * factor, viewport, map);
  const centre = {
    x: anchor.x - (cursor.x - viewport.width / 2) / scale,
    y: anchor.y - (cursor.y - viewport.height / 2) / scale,
  };
  return clampCamera({ centre, scale }, viewport, map);
}

/** One wheel notch of 100 px zooms by about 22 %. */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.002);
}

/**
 * City, town, and village symbols grow from the base size at 0.6 px per km to this
 * factor at the closest zoom, so a close view shows a town beside men 54 px tall and
 * not a speck. One factor for all keeps a city larger than a town and a town than a village.
 */
const SYMBOL_GROWTH = { from: 0.6, perDoubling: 0.55, most: 2.5 } as const;

/** How much a city, town, or village symbol is enlarged at a zoom. */
export function symbolGrowth(scale: number): number {
  const { from, perDoubling, most } = SYMBOL_GROWTH;
  return Math.min(most, Math.max(1, 1 + perDoubling * Math.log2(scale / from)));
}
