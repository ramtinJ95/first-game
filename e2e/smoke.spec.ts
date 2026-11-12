import { expect, test } from '@playwright/test';

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
  expect(errors).toEqual([]);
});
