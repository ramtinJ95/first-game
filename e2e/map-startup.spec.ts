import { expect, test } from '@playwright/test';
import { openGame, pause } from './support.ts';
import { MAP_BATCH_TEXTURES } from '../src/render/batch-limits.ts';

test('the software renderer uses bounded texture batches and still draws the map', async ({
  page,
}) => {
  await openGame(page);
  await pause(page);
  const canvas = page.locator('canvas[data-renderer]');
  expect(Number(await canvas.getAttribute('data-batch-textures'))).toBe(MAP_BATCH_TEXTURES);
  await expect(canvas).toHaveAttribute('data-terrain', 'ready');
  const measures = await page.evaluate(() =>
    performance.getEntriesByType('measure').map((entry) => entry.name),
  );
  expect(measures).toContain('startup:wash-rasterise');
  expect(measures).toContain('startup:ground-tint');
  expect(measures).toContain('startup:terrain');
  await expect(canvas).toHaveAttribute('data-drawn-frames', /^[1-9]\d*$/);
});
