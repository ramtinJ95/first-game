import { expect, test, type Page } from '@playwright/test';
import { clampCamera, fitCamera, screenToMap } from '../src/render/camera.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import { surfaceAt } from '../src/sim/world/find-path.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { map, openGame, pause, untilDrawn } from './support.ts';

const world = buildWorld(map);
const FIRST = { width: 1280, height: 720 };

/** A surface whose every point within `km` is the same, so a drawing off by a little still reads it. */
function deepSurface(point: MapPoint, km: number) {
  const surface = surfaceAt(world.mesh, point);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const around = { x: point.x + Math.cos(a) * km, y: point.y + Math.sin(a) * km };
    if (surfaceAt(world.mesh, around) !== surface) return undefined;
  }
  return surface === 'offMap' ? undefined : surface;
}

/** Screen points, after the resize, that lie deep at sea or deep inland. */
function probes(size: { width: number; height: number }) {
  const camera = clampCamera(fitCamera(FIRST, map), size, map);
  const found: { at: MapPoint; surface: 'land' | 'sea' }[] = [];
  for (let gy = 1; gy < 8; gy++) {
    for (let gx = 1; gx < 12; gx++) {
      const at = { x: (gx / 12) * size.width, y: (gy / 8) * size.height };
      const surface = deepSurface(screenToMap(camera, size, at), 60);
      if (surface) found.push({ at, surface });
    }
  }
  return { camera, found };
}

/** The mean colour of a 5 px square at each screen point of the page. */
async function colours(page: Page, points: readonly MapPoint[]) {
  const png = await page.screenshot();
  return page.evaluate(
    async ({ data, points }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${data}`)).blob(),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) return [];
      context.drawImage(bitmap, 0, 0);
      return points.map(({ x, y }) => {
        if (!(document.elementFromPoint(x, y) instanceof HTMLCanvasElement)) return null;
        const pixels = context.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data;
        const sum = [0, 0, 0];
        for (let i = 0; i < pixels.length; i += 4) {
          for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + (pixels[i + k] ?? 0);
        }
        return sum.map((v) => v / 25);
      });
    },
    { data: png.toString('base64'), points },
  );
}

/**
 * The sea is a grey green, greener than red with green and blue close. Paper, desert,
 * and every owner's wash, Macedon's blue and Persia's green among them, are not.
 */
const looksLike = ([r = 0, g = 0, b = 0]: number[]) =>
  g - r > 8 && Math.abs(g - b) < 16 ? 'sea' : 'land';

test.use({ viewport: FIRST });

for (const size of [
  { width: 1600, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`after a resize to ${size.width} px the sea and the land are drawn where the map has them`, async ({
    page,
  }) => {
    await openGame(page, { query: 'hide=fog,labels,settlements,markers' });
    await pause(page);
    // The fault showed only once the cached textures had been drawn into at the first size.
    await untilDrawn(page);
    await page.locator('canvas[data-terrain="ready"]').waitFor();
    await page.setViewportSize(size);
    const { found } = probes(size);
    expect(found.filter((p) => p.surface === 'sea').length).toBeGreaterThan(3);
    expect(found.filter((p) => p.surface === 'land').length).toBeGreaterThan(3);
    await expect
      .poll(async () => {
        const seen = await colours(
          page,
          found.map((p) => p.at),
        );
        return found
          .filter((p, i) => {
            const colour = seen[i];
            return colour && looksLike(colour) !== p.surface;
          })
          .map((p) => p.at);
      })
      .toEqual([]);
  });
}
