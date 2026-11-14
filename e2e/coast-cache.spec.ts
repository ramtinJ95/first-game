import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { LAYERS } from '../src/render/renderer.ts';
import { camera, openGame, pause } from './support.ts';

test('a restored WebGL context redraws cached coast ink without a camera move', async ({
  page,
}, testInfo) => {
  const hide = LAYERS.filter(({ name }) => name !== 'riversAndCoast')
    .map(({ name }) => name)
    .join(',');
  await openGame(page, { query: `swell=off&hide=${hide}` });
  await pause(page);
  await camera(page).jumpTo({ x: 4053, y: 3616 }, 4);
  const canvas = page.locator('canvas[data-renderer]');
  await expect(canvas).toHaveAttribute('data-zoom', '4.0000');
  await expect(canvas).toHaveAttribute('data-terrain', 'ready');
  // A covered pan reuses a texture with a different fractional pixel origin.
  // Finish with a zoom-only rebuild so restoration compares the same raster origin.
  const view = page.viewportSize();
  if (!view) throw new Error('no viewport');
  await page.mouse.move(view.width / 2, view.height / 2);
  await page.mouse.wheel(0, -Math.log(3.9 / 4) / 0.002);
  await expect(canvas).toHaveAttribute('data-zoom', '3.9000');
  await page.mouse.wheel(0, -Math.log(4 / 3.9) / 0.002);
  await expect(canvas).toHaveAttribute('data-zoom', '4.0000');
  const beforeShot = await canvas.screenshot();
  const before = PNG.sync.read(beforeShot);
  expect(new Set(before.data).size).toBeGreaterThan(10);
  const frames = Number(await canvas.getAttribute('data-drawn-frames'));
  await canvas.evaluate(
    (element) =>
      new Promise<void>((done) => {
        const gl = (element as HTMLCanvasElement).getContext('webgl2');
        const extension = gl?.getExtension('WEBGL_lose_context');
        if (!extension) throw new Error('WebGL context-loss extension unavailable');
        element.addEventListener('webglcontextrestored', () => done(), { once: true });
        element.addEventListener(
          'webglcontextlost',
          () => requestAnimationFrame(() => extension.restoreContext()),
          { once: true },
        );
        extension.loseContext();
      }),
  );
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-drawn-frames')))
    .toBeGreaterThan(frames);
  const afterShot = await canvas.screenshot();
  const after = PNG.sync.read(afterShot);
  if (!after.data.equals(before.data)) {
    await testInfo.attach('before', { body: beforeShot, contentType: 'image/png' });
    await testInfo.attach('after', { body: afterShot, contentType: 'image/png' });
  }
  expect(after.data.equals(before.data)).toBe(true);
});
