import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { LAYERS } from '../src/render/renderer.ts';
import { camera, openGame, pause, untilDrawn } from './support.ts';

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

test('a long pan at the closest zoom draws the water lines and ink that a zoom there draws', async ({
  page,
}, testInfo) => {
  const hide = LAYERS.filter(({ name }) => name !== 'riversAndCoast' && name !== 'sea')
    .map(({ name }) => name)
    .join(',');
  await openGame(page, { query: `swell=off&hide=${hide}` });
  await pause(page);
  const canvas = page.locator('canvas[data-renderer]');
  const blocks = async () => {
    const shot = PNG.sync.read(await canvas.screenshot());
    const means: number[] = [];
    for (let by = 0; by + 32 <= shot.height; by += 32)
      for (let bx = 0; bx + 32 <= shot.width; bx += 32) {
        let sum = 0;
        for (let y = by; y < by + 32; y++)
          for (let x = bx; x < bx + 32; x++) {
            const i = (y * shot.width + x) * 4;
            sum += (shot.data[i] ?? 0) + (shot.data[i + 1] ?? 0) + (shot.data[i + 2] ?? 0);
          }
        means.push(sum / (32 * 32 * 3));
      }
    return { means, shot };
  };
  const view = camera(page);
  await view.jumpTo({ x: 3540, y: 2989 }, 4);
  await expect(canvas).toHaveAttribute('data-zoom', '4.0000');
  // Three views' width of pan leaves the strokes drawn for the first view behind.
  for (let i = 0; i < 3; i++) await view.drag({ x: 840, y: 360 }, { x: 440, y: 360 });
  const panned = await blocks();
  await page.mouse.move(640, 360);
  // Beyond the restroke ratio and back strokes everything again for this very view.
  await page.mouse.wheel(0, -Math.log(3 / 4) / 0.002);
  await expect(canvas).toHaveAttribute('data-zoom', '3.0000');
  await page.mouse.wheel(0, -Math.log(4 / 3) / 0.002);
  await expect(canvas).toHaveAttribute('data-zoom', '4.0000');
  await untilDrawn(page);
  const zoomed = await blocks();
  const worst = Math.max(...zoomed.means.map((m, i) => Math.abs(m - (panned.means[i] ?? 0))));
  if (worst >= 6) {
    await testInfo.attach('panned', {
      body: PNG.sync.write(panned.shot),
      contentType: 'image/png',
    });
    await testInfo.attach('zoomed', {
      body: PNG.sync.write(zoomed.shot),
      contentType: 'image/png',
    });
  }
  expect(worst).toBeLessThan(6);
});
