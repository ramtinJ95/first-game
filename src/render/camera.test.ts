import { describe, expect, it } from 'vitest';
import {
  clampCamera,
  fitCamera,
  mapToScreen,
  MAX_SCALE,
  panBy,
  screenToMap,
  visibleRect,
  zoomAt,
  type Camera,
  type Size,
} from './camera.ts';

const MAP: Size = { width: 7628.2, height: 4550 };
const VIEWPORTS: Size[] = [
  { width: 1280, height: 720 },
  { width: 800, height: 1200 },
  { width: 375, height: 667 },
];

function expectInsideMap(camera: Camera, viewport: Size) {
  const view = visibleRect(camera, viewport);
  const eps = 1e-6;
  if (view.right - view.left < MAP.width) {
    expect(view.left).toBeGreaterThanOrEqual(-eps);
    expect(view.right).toBeLessThanOrEqual(MAP.width + eps);
  } else {
    expect((view.left + view.right) / 2).toBeCloseTo(MAP.width / 2);
  }
  if (view.bottom - view.top < MAP.height) {
    expect(view.top).toBeGreaterThanOrEqual(-eps);
    expect(view.bottom).toBeLessThanOrEqual(MAP.height + eps);
  } else {
    expect((view.top + view.bottom) / 2).toBeCloseTo(MAP.height / 2);
  }
}

describe('camera', () => {
  it('shows the whole map at the widest zoom, touching two opposite edges', () => {
    for (const viewport of VIEWPORTS) {
      const view = visibleRect(fitCamera(viewport, MAP), viewport);
      expect(view.left).toBeLessThanOrEqual(1e-6);
      expect(view.top).toBeLessThanOrEqual(1e-6);
      expect(view.right).toBeGreaterThanOrEqual(MAP.width - 1e-6);
      expect(view.bottom).toBeGreaterThanOrEqual(MAP.height - 1e-6);
      const fitsWidth = Math.abs(view.right - view.left - MAP.width) < 1e-6;
      const fitsHeight = Math.abs(view.bottom - view.top - MAP.height) < 1e-6;
      expect(fitsWidth || fitsHeight).toBe(true);
    }
  });

  it('keeps the view inside the map at every zoom, wherever it is asked to look', () => {
    const asks = [-5000, 0, 1200, 3800, 7628, 12000];
    for (const viewport of VIEWPORTS) {
      for (let scale = 0.01; scale <= 10; scale *= 1.3) {
        for (const x of asks) {
          for (const y of asks) {
            expectInsideMap(clampCamera({ centre: { x, y }, scale }, viewport, MAP), viewport);
          }
        }
      }
    }
  });

  it('cannot zoom out past the whole map or in past the closest zoom', () => {
    const viewport = VIEWPORTS[0] as Size;
    const fit = fitCamera(viewport, MAP);
    const centre = { x: 640, y: 360 };
    expect(zoomAt(fit, centre, 0.1, viewport, MAP).scale).toBeCloseTo(fit.scale);
    expect(zoomAt(fit, centre, 1000, viewport, MAP).scale).toBe(MAX_SCALE);
  });

  it('keeps the map point under the cursor under the cursor during a zoom', () => {
    const viewport = VIEWPORTS[0] as Size;
    let camera: Camera = { centre: { x: 3000, y: 2400 }, scale: 0.5 };
    const cursor = { x: 900, y: 250 };
    const anchor = screenToMap(camera, viewport, cursor);
    for (const factor of [1.2, 1.5, 2, 1.1, 0.8, 0.9, 1.3]) {
      camera = zoomAt(camera, cursor, factor, viewport, MAP);
      const under = mapToScreen(camera, viewport, anchor);
      expect(under.x).toBeCloseTo(cursor.x, 6);
      expect(under.y).toBeCloseTo(cursor.y, 6);
    }
    expect(camera.scale).toBeCloseTo(0.5 * 1.2 * 1.5 * 2 * 1.1 * 0.8 * 0.9 * 1.3);
  });

  it('moves the map with the drag and stops at the map edge', () => {
    const viewport = VIEWPORTS[0] as Size;
    const camera: Camera = { centre: { x: 3000, y: 2400 }, scale: 1 };
    const moved = panBy(camera, 100, -50, viewport, MAP);
    expect(moved.centre).toEqual({ x: 2900, y: 2450 });
    const far = panBy(camera, 100_000, 100_000, viewport, MAP);
    expect(visibleRect(far, viewport).left).toBeCloseTo(0);
    expect(visibleRect(far, viewport).top).toBeCloseTo(0);
  });

  it('maps a screen point to the map and back', () => {
    const viewport = VIEWPORTS[1] as Size;
    const camera: Camera = { centre: { x: 2511, y: 2335 }, scale: 2.5 };
    const point = { x: 123, y: 987 };
    const back = mapToScreen(camera, viewport, screenToMap(camera, viewport, point));
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
    expect(screenToMap(camera, viewport, { x: 400, y: 600 })).toEqual({ x: 2511, y: 2335 });
  });
});
