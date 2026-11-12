import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const map = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../data/map/map.json'), 'utf8'),
) as { version: number; provinces: unknown[] };

test('the skeleton renders the map and the time controls without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  await expect(page.getByTestId('time-controls-day')).toHaveText(/^Day \d+$/);
  await expect(page.getByTestId('time-controls-realm')).toHaveText(
    `Rome · ${map.provinces.length} provinces`,
  );
  expect(errors).toEqual([]);
});

test('a map that fails to parse stops the page with the parse error on screen', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/map*.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 99 }) }),
  );

  await page.goto('/');

  await expect(page.getByRole('alert')).toHaveText(
    `The game cannot start. map.version: expected ${map.version}`,
  );
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByTestId('time-controls')).toHaveCount(0);
  expect(errors).toEqual([expect.stringContaining(`map.version: expected ${map.version}`)]);
});
