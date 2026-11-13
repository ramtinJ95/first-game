import { expect, test, type Page } from '@playwright/test';
import { fitCamera, wheelFactor, zoomAt } from '../src/render/camera.ts';
import { camera, map, openGame, pause } from './support.ts';

/** Short of the closest zoom, so a notch lost would show and not vanish in the clamp. */
const NOTCHES = 14;

/** The zoom of the frame the map drew last, in px per km. */
const drawnZoom = (page: Page) =>
  page
    .locator('canvas[data-renderer]')
    .getAttribute('data-zoom')
    .then((zoom) => Number(zoom));

test.describe('the wheel', () => {
  test('quick notches over Persia reach the zoom that as many notches one frame apart reach', async ({
    page,
  }) => {
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    await openGame(page);
    await pause(page);
    const persia = camera(page).city('persepolis');
    let expected = fitCamera(viewport, map);
    for (let i = 0; i < NOTCHES; i++) {
      expected = zoomAt(expected, persia, wheelFactor(-100), viewport, map);
    }

    await page.mouse.move(persia.x, persia.y);
    for (let i = 0; i < NOTCHES; i++) await page.mouse.wheel(0, -100);
    await expect.poll(() => drawnZoom(page)).toBeCloseTo(expected.scale, 3);
    const quick = await drawnZoom(page);

    await openGame(page);
    await pause(page);
    await page.mouse.move(persia.x, persia.y);
    let step = fitCamera(viewport, map);
    for (let i = 0; i < NOTCHES; i++) {
      step = zoomAt(step, persia, wheelFactor(-100), viewport, map);
      await page.mouse.wheel(0, -100);
      await expect.poll(() => drawnZoom(page)).toBeCloseTo(step.scale, 3);
    }
    expect(await drawnZoom(page)).toBeCloseTo(quick, 3);
  });
});
